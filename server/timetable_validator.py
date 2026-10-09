#!/usr/bin/env python3
"""
CentralSaathi Authoritative Timetable Validator
Module: server/timetable_validator.py

Strict validation rules for Central Railway (CR) / Indian Railways timetable data:
- Duplicate trains
- Duplicate station stops
- Invalid station names/codes
- Incorrect station sequence
- Impossible arrival/departure times (non-24h, arrival > departure, backward travel)
- Missing timetable information
- Invalid timetable versions

Data Policy: Never silently import invalid data.
"""

import re
import sys
import json
import os
from datetime import datetime
from typing import Dict, List, Set, Any, Tuple, Optional

class TimetableValidationError(Exception):
    """Raised when timetable data fails strict railway validation rules."""
    def __init__(self, message: str, errors: Optional[List[str]] = None):
        super().__init__(message)
        self.errors = errors or [message]

TIME_REGEX = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

VALID_TRAIN_TYPES = {"SLOW", "FAST", "AC", "AC_FAST", "AC_SLOW", "SEMI_FAST", "HARBOUR_SLOW", "TRANS_HARBOUR"}
VALID_DIRECTIONS = {"UP", "DOWN"}
VALID_SERVICE_DAYS = {"DAILY", "MON_SAT", "SUN_ONLY", "MON_FRI", "WEEKDAYS"}

def parse_time_mins(t_str: str) -> int:
    """Parses 'HH:MM' into minutes from midnight (0..1439)."""
    if not t_str or not isinstance(t_str, str):
        raise ValueError(f"Invalid time string: {t_str}")
    m = TIME_REGEX.match(t_str.strip())
    if not m:
        raise ValueError(f"Time '{t_str}' is not in valid 24-hr HH:MM format (00:00 - 23:59)")
    h, mins = int(m.group(1)), int(m.group(2))
    return h * 60 + mins

def validate_timetable_version(ver: Dict[str, Any]) -> List[str]:
    """Validates timetable version metadata."""
    errors = []
    if not ver.get("version"):
        errors.append("Timetable version string is required.")
    eff_from = ver.get("effective_from")
    if not eff_from:
        errors.append("effective_from date is required.")
    else:
        try:
            datetime.strptime(str(eff_from).strip(), "%Y-%m-%d")
        except ValueError:
            errors.append(f"effective_from '{eff_from}' must be a valid date in YYYY-MM-DD format.")

    source = ver.get("source")
    if not source or not any(k in str(source).lower() for k in ["central railway", "indian railways", "cr", "wtt"]):
        errors.append(f"Timetable source '{source}' must indicate official Central Railway/Indian Railways origin.")
    return errors

def validate_station(stn: Dict[str, Any], seen_codes: Set[str]) -> List[str]:
    """Validates station code, coordinates, and sequence attributes."""
    errors = []
    code = (stn.get("code") or stn.get("station_code") or "").strip().upper()
    if not code:
        errors.append("Station record missing station_code.")
        return errors

    if not code.isalnum():
        errors.append(f"Station code '{code}' must be alphanumeric.")

    if code in seen_codes:
        errors.append(f"Duplicate station code '{code}' detected in master station registry.")
    seen_codes.add(code)

    name = stn.get("name") or stn.get("station_name")
    if not name:
        errors.append(f"Station '{code}' missing official station_name.")

    lat = stn.get("lat") or stn.get("latitude")
    lng = stn.get("lng") or stn.get("longitude")
    if lat is not None and lng is not None:
        try:
            lat_f, lng_f = float(lat), float(lng)
            if not (-90 <= lat_f <= 90) or not (-180 <= lng_f <= 180):
                errors.append(f"Station '{code}' coordinates ({lat_f}, {lng_f}) are outside valid latitude/longitude ranges.")
            elif not (18.5 <= lat_f <= 20.5) or not (72.5 <= lng_f <= 74.0):
                errors.append(f"Station '{code}' coordinates ({lat_f}, {lng_f}) fall outside Mumbai metropolitan railway bounds.")
        except (ValueError, TypeError):
            errors.append(f"Station '{code}' coordinates invalid numeric format.")

    return errors

def validate_train(train: Dict[str, Any], valid_station_codes: Set[str], seen_numbers: Set[str]) -> List[str]:
    """Validates train record metadata, direction, service days, and endpoints."""
    errors = []
    num = str(train.get("train_number") or "").strip()
    if not num:
        errors.append(f"Train ID {train.get('id')} missing train_number.")
        return errors

    if num in seen_numbers:
        errors.append(f"Duplicate train_number '{num}' detected in timetable dataset.")
    seen_numbers.add(num)

    name = train.get("train_name")
    if not name or not str(name).strip():
        errors.append(f"Train {num} missing train_name.")

    ttype = str(train.get("train_type") or "").strip().upper()
    if ttype not in VALID_TRAIN_TYPES:
        errors.append(f"Train {num} has invalid train_type '{ttype}'. Expected one of {sorted(VALID_TRAIN_TYPES)}.")

    direction = str(train.get("direction") or "").strip().upper()
    if direction not in VALID_DIRECTIONS:
        errors.append(f"Train {num} has invalid direction '{direction}'. Expected UP or DOWN.")

    src = (train.get("source_station_code") or "").strip().upper()
    dst = (train.get("destination_station_code") or "").strip().upper()

    if not src or src not in valid_station_codes:
        errors.append(f"Train {num} source station code '{src}' does not exist in master stations.")
    if not dst or dst not in valid_station_codes:
        errors.append(f"Train {num} destination station code '{dst}' does not exist in master stations.")
    if src == dst:
        errors.append(f"Train {num} source and destination station codes cannot be identical ({src} == {dst}).")

    days = str(train.get("service_days") or "").strip().upper()
    if days not in VALID_SERVICE_DAYS:
        errors.append(f"Train {num} has invalid service_days '{days}'. Expected one of {sorted(VALID_SERVICE_DAYS)}.")

    return errors

def validate_train_stops(train: Dict[str, Any], stops: List[Dict[str, Any]], valid_station_codes: Set[str]) -> List[str]:
    """
    Validates station-by-station arrival/departure times, stop sequence,
    halt feasibility, and non-decreasing temporal progression.
    """
    errors = []
    num = train.get("train_number", "UNKNOWN")
    src = train.get("source_station_code")
    dst = train.get("destination_station_code")

    if not stops or len(stops) < 2:
        errors.append(f"Train {num} has insufficient stops ({len(stops)}). A valid timetable train must have at least 2 stops.")
        return errors

    # Sort stops strictly by sequence
    stops_sorted = sorted(stops, key=lambda s: s.get("sequence", 0))

    # Check first and last stop matches train endpoints
    first_stn = stops_sorted[0].get("station_code")
    last_stn = stops_sorted[-1].get("station_code")
    if first_stn != src:
        errors.append(f"Train {num} first stop '{first_stn}' does not match declared source station '{src}'.")
    if last_stn != dst:
        errors.append(f"Train {num} last stop '{last_stn}' does not match declared destination station '{dst}'.")

    seen_stops_in_train = set()
    prev_seq = 0
    prev_dep_mins = None

    for idx, s in enumerate(stops_sorted):
        seq = s.get("sequence")
        stn_code = (s.get("station_code") or "").strip().upper()

        # 1. Sequence numbering must be strictly increasing
        if seq is None or not isinstance(seq, int) or seq <= prev_seq:
            errors.append(f"Train {num} sequence error at stop {idx+1}: seq={seq} must be greater than previous {prev_seq}.")
        prev_seq = seq or (prev_seq + 1)

        # 2. Station code valid
        if not stn_code or stn_code not in valid_station_codes:
            errors.append(f"Train {num} stop {seq}: station code '{stn_code}' not in valid master stations.")

        # 3. No duplicate stations on the same run
        if stn_code in seen_stops_in_train:
            errors.append(f"Train {num} duplicate halt at station '{stn_code}'.")
        seen_stops_in_train.add(stn_code)

        # 4. Valid 24-hr time formats
        arr_str = s.get("arrival_time")
        dep_str = s.get("departure_time")

        try:
            arr_mins = parse_time_mins(arr_str)
        except ValueError as ve:
            errors.append(f"Train {num} stop {stn_code} arrival time: {ve}")
            continue

        try:
            dep_mins = parse_time_mins(dep_str)
        except ValueError as ve:
            errors.append(f"Train {num} stop {stn_code} departure time: {ve}")
            continue

        # 5. Station halt logic: arrival cannot be later than departure at same station
        # (allowing for same-minute halt, which is standard for fast Mumbai halts)
        if arr_mins > dep_mins:
            # Handle possible midnight rollover (e.g. 23:59 arrival, 00:01 departure)
            if not (arr_mins >= 1430 and dep_mins <= 30):
                errors.append(f"Train {num} stop {stn_code}: arrival time ({arr_str}) cannot be later than departure time ({dep_str}).")

        # 6. Inter-station progression: departure from previous stop must be <= arrival at current stop
        if prev_dep_mins is not None:
            diff = arr_mins - prev_dep_mins
            # Handle midnight wrap (e.g. 23:55 to 00:05 is +10 mins, diff is -1430)
            if diff < 0:
                diff += 1440

            if diff < 0 or diff > 180:
                errors.append(
                    f"Train {num}: impossible travel duration ({diff} mins) between stops {stops_sorted[idx-1].get('station_code')} ({stops_sorted[idx-1].get('departure_time')}) "
                    f"and {stn_code} ({arr_str})."
                )

        prev_dep_mins = dep_mins

    return errors

def validate_dataset(data: Dict[str, Any]) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Performs comprehensive, zero-compromise validation over an entire railway timetable dataset.
    Returns (is_valid, all_errors, summary_stats).
    """
    all_errors: List[str] = []
    if not isinstance(data, dict):
        return False, ["Dataset root must be a JSON object."], {
            "is_valid": False, "total_stations": 0, "total_trains": 0,
            "total_stops": 0, "total_versions": 0, "errors_count": 1
        }

    # 1. Validate Timetable Versions
    versions = data.get("timetable_versions", [])
    if not versions:
        all_errors.append("No timetable_versions found in dataset. Timetable must be versioned.")
    else:
        for v in versions:
            all_errors.extend(validate_timetable_version(v))

    # 2. Validate Stations
    stations = data.get("stations", [])
    if not stations:
        all_errors.append("No stations found in dataset. Stations table cannot be empty.")
    valid_station_codes: Set[str] = set()
    for s in stations:
        all_errors.extend(validate_station(s, valid_station_codes))

    # 3. Validate Trains & Stops
    trains = data.get("trains", [])
    raw_stops = data.get("train_stops", [])

    if not trains:
        all_errors.append("No trains found in dataset.")

    stops_by_train: Dict[Any, List[Dict[str, Any]]] = {}
    for st in raw_stops:
        tid = st.get("train_id")
        stops_by_train.setdefault(tid, []).append(st)

    seen_train_numbers: Set[str] = set()
    for t in trains:
        tid = t.get("id")
        tnum = t.get("train_number")
        train_errs = validate_train(t, valid_station_codes, seen_train_numbers)
        all_errors.extend(train_errs)

        t_stops = t.get("stops") or stops_by_train.get(tid) or stops_by_train.get(tnum) or []
        stops_errs = validate_train_stops(t, t_stops, valid_station_codes)
        all_errors.extend(stops_errs)

    is_valid = len(all_errors) == 0
    stats = {
        "is_valid": is_valid,
        "total_stations": len(stations),
        "total_trains": len(trains),
        "total_stops": len(raw_stops),
        "total_versions": len(versions),
        "errors_count": len(all_errors)
    }

    return is_valid, all_errors, stats

def run_validation(file_path: Optional[str] = None, raise_on_error: bool = True) -> Dict[str, Any]:
    """Loads timetable file and executes validation."""
    target_path = file_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "official_timetable_data.json")
    if not os.path.exists(target_path):
        alt = os.path.join(os.getcwd(), "server", "data", "official_timetable_data.json")
        if os.path.exists(alt):
            target_path = alt
        else:
            raise FileNotFoundError(f"Timetable data file not found at {target_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    is_valid, errors, stats = validate_dataset(data)
    if not is_valid and raise_on_error:
        error_msg = f"Timetable dataset failed validation with {len(errors)} errors:\n" + "\n".join(errors[:10])
        if len(errors) > 10:
            error_msg += f"\n... and {len(errors) - 10} more errors."
        raise TimetableValidationError(error_msg, errors)

    return {
        "status": "PASSED" if is_valid else "FAILED",
        "file_path": target_path,
        "stats": stats,
        "errors": errors
    }

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CentralSaathi Timetable Validator")
    parser.add_argument("--file", "-f", default=None, help="Path to timetable JSON file")
    args = parser.parse_args()

    try:
        res = run_validation(args.file, raise_on_error=False)
        print(json.dumps(res, indent=2))
        if res["status"] != "PASSED":
            sys.exit(1)
    except Exception as e:
        print(f"Validation Error: {e}", file=sys.stderr)
        sys.exit(1)
