#!/usr/bin/env python3
"""
CentralSaathi Real-Time Train Telemetry & GPS Tracking Simulation Engine
Simulates Central Railway Division GPS telemetry, block section signaling, 
instantaneous train speed, and delay status (On Time, Delayed by 5m, Cancelled).
"""

import sys
import os
import json
import argparse
import random
from datetime import datetime, timezone, timedelta

def get_ist_now():
    utc_now = datetime.now(timezone.utc)
    ist_now = utc_now + timedelta(hours=5, minutes=30)
    return ist_now

# Realistic Central Railway corridor track segments and signaling blocks
CORRIDOR_SECTIONS = [
    {"section": "CSMT Outer - Byculla Up Fast", "lat": 18.9620, "lng": 72.8390, "speed": 62, "signal": "PROCEED_GREEN"},
    {"section": "Byculla - Dadar Central Track 4", "lat": 18.9980, "lng": 72.8420, "speed": 68, "signal": "PROCEED_GREEN"},
    {"section": "Dadar Approach Interlocking Block", "lat": 19.0178, "lng": 72.8478, "speed": 35, "signal": "CAUTION_YELLOW"},
    {"section": "Matunga - Kurla Junction Crossover", "lat": 19.0450, "lng": 72.8680, "speed": 45, "signal": "CAUTION_YELLOW"},
    {"section": "Kurla - Ghatkopar Main Fast Straight", "lat": 19.0790, "lng": 72.8990, "speed": 72, "signal": "PROCEED_GREEN"},
    {"section": "Ghatkopar - Vikhroli Section #3", "lat": 19.1020, "lng": 72.9150, "speed": 65, "signal": "PROCEED_GREEN"},
    {"section": "Bhandup - Mulund Up Fast Line", "lat": 19.1620, "lng": 72.9480, "speed": 70, "signal": "PROCEED_GREEN"},
    {"section": "Mulund - Thane Creek Bridge Entry", "lat": 19.1820, "lng": 72.9680, "speed": 48, "signal": "PROCEED_GREEN"},
    {"section": "Thane Station Platform 5 Approach", "lat": 19.1865, "lng": 72.9754, "speed": 28, "signal": "CAUTION_YELLOW"},
    {"section": "Kalva - Mumbra Parsik Tunnel Bypass", "lat": 19.1980, "lng": 73.0080, "speed": 58, "signal": "PROCEED_GREEN"},
    {"section": "Diva Jn - Dombivli High-Speed Segment", "lat": 19.2080, "lng": 73.0580, "speed": 75, "signal": "PROCEED_GREEN"},
    {"section": "Dombivli - Thakurli Slow Corridor", "lat": 19.2220, "lng": 73.0920, "speed": 50, "signal": "PROCEED_GREEN"},
    {"section": "Kalyan Yard & Signal Cabin Interlocking", "lat": 19.2364, "lng": 73.1306, "speed": 30, "signal": "CAUTION_YELLOW"}
]

DELAY_REASONS = {
    "ON_TIME": [
        "Running on time as per Central Railway suburban working timetable (WTT). Signals clear.",
        "Cruising along Main Fast alignment on green signals. No suburban congestion reported.",
        "Normal suburban operation. Optimal track clearance between block sections."
    ],
    "DELAYED_5M": [
        "Speed restriction of 30 km/h applied at Kurla Jn interlocking crossover.",
        "Slight headway spacing due to heavy boarding at Dadar Platform 4.",
        "Signal clearance delay of ~4 minutes at Vidyavihar cabin. Resuming normal speed.",
        "Precautionary speed caution over Thane Creek bridge expansion joint."
    ],
    "CANCELLED": [
        "Service cancelled due to urgent overhead wire (OHE) inspection near Matunga.",
        "Service rescheduled due to scheduled rolling-stock maintenance at Kalva Car Shed."
    ]
}

def generate_telemetry_for_train(train_number, query_time_str=None):
    """Generates realistic telemetric GPS packet for a given train."""
    ist_now = get_ist_now()
    time_str = query_time_str or ist_now.strftime("%H:%M:%S")
    
    # Deterministic pseudo-randomness based on train number & minute so pings remain consistent during a minute
    seed_val = (int(str(train_number).replace("#", "").strip() or "95112") * 17) + ist_now.minute
    rng = random.Random(seed_val)
    
    # Status distribution: 75% On Time, 20% Delayed by 5m, 5% Cancelled
    roll = rng.random()
    if roll < 0.75:
        status = "On Time"
        status_code = "ON_TIME"
        delay_minutes = 0
        badge_color = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
        dot_color = "#10b981"
        reason = rng.choice(DELAY_REASONS["ON_TIME"])
    elif roll < 0.95:
        status = "Delayed by 5m"
        status_code = "DELAYED_5M"
        delay_minutes = 5
        badge_color = "bg-amber-500/20 text-amber-300 border-amber-500/40"
        dot_color = "#f59e0b"
        reason = rng.choice(DELAY_REASONS["DELAYED_5M"])
    else:
        status = "Cancelled"
        status_code = "CANCELLED"
        delay_minutes = 999
        badge_color = "bg-rose-500/20 text-rose-300 border-rose-500/40"
        dot_color = "#ef4444"
        reason = rng.choice(DELAY_REASONS["CANCELLED"])

    section_data = rng.choice(CORRIDOR_SECTIONS)
    
    # Small jitter to lat/lng for realistic GPS drift
    jitter_lat = round(section_data["lat"] + (rng.random() - 0.5) * 0.003, 6)
    jitter_lng = round(section_data["lng"] + (rng.random() - 0.5) * 0.003, 6)
    
    if status_code == "CANCELLED":
        speed = 0
    else:
        speed = max(0, section_data["speed"] + rng.randint(-6, 8))

    # Build telemetric ping logs
    ping_logs = []
    for i in range(3, -1, -1):
        past_time = ist_now - timedelta(seconds=i * 12)
        ping_logs.append({
            "timestamp": past_time.strftime("%H:%M:%S"),
            "event": f"GPS Beacon Ping #{4 - i}",
            "speed_kmh": max(0, speed + (i * 2 - 3)),
            "signal": "GREEN" if status_code == "ON_TIME" else "YELLOW"
        })

    return {
        "success": True,
        "train_number": str(train_number),
        "status": status,
        "status_code": status_code,
        "delay_minutes": delay_minutes,
        "badge_color": badge_color,
        "dot_color": dot_color,
        "reason": reason,
        "speed_kmh": speed,
        "section": section_data["section"],
        "signal_aspect": section_data["signal"],
        "gps_coords": {
            "latitude": jitter_lat,
            "longitude": jitter_lng,
            "accuracy_meters": 4.5
        },
        "telemetry_timestamp": time_str,
        "ping_history": ping_logs,
        "data_source": "Central Railway Divisional Control Telemetry Stream (Simulated)"
    }

def main():
    parser = argparse.ArgumentParser(description="Central Railway Live Train Telemetry Engine")
    parser.add_argument("--train", "-t", default="97380", help="Train number (e.g. 97380, 95112)")
    parser.add_argument("--time", help="Time override HH:MM:SS")
    
    args = parser.parse_args()
    data = generate_telemetry_for_train(args.train, args.time)
    print(json.dumps(data, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
