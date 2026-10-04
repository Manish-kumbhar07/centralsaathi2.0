#!/usr/bin/env python3
"""
CentralSaathi SQLite Database Module
File: backend/database.py

Manages relational database storage for stations, connections, train schedules,
crowd reports, alerts, and scraped railway advisories using sqlite3 and pandas.
"""

import os
import json
import sqlite3
import logging
from typing import List, Dict, Any, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Database")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "railway.db")
DATA_DIR = os.path.join(ROOT_DIR, "server", "data")
STATIONS_JSON = os.path.join(ROOT_DIR, "data", "central_line_stations.json")
if not os.path.exists(STATIONS_JSON):
    STATIONS_JSON = os.path.join(ROOT_DIR, "central_saathi", "data", "central_line_stations.json")
CONNECTIONS_JSON = os.path.join(ROOT_DIR, "data", "central_line_connections.json")
if not os.path.exists(CONNECTIONS_JSON):
    CONNECTIONS_JSON = os.path.join(ROOT_DIR, "central_saathi", "data", "central_line_connections.json")
OFFICIAL_DATA_JSON = os.path.join(DATA_DIR, "official_timetable_data.json")

def get_connection() -> sqlite3.Connection:
    """Returns a connection to the SQLite database with row factory enabled."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes tables and seeds initial data from official railway datasets."""
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Stations table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stations (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        marathi_name TEXT,
        lat REAL,
        lng REAL,
        dist_km REAL,
        is_fast INTEGER DEFAULT 0,
        platforms INTEGER DEFAULT 2,
        is_junction INTEGER DEFAULT 0,
        interchange TEXT
    )
    """)

    # 2. Connections table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_code TEXT NOT NULL,
        to_code TEXT NOT NULL,
        dist_km REAL,
        slow_mins INTEGER,
        fast_mins INTEGER,
        tracks TEXT
    )
    """)

    # 3. Trains table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trains (
        train_number TEXT PRIMARY KEY,
        train_name TEXT,
        train_type TEXT,
        source_code TEXT,
        dest_code TEXT,
        departure_time TEXT,
        arrival_time TEXT,
        duration_mins INTEGER,
        is_fast INTEGER DEFAULT 0,
        is_ac INTEGER DEFAULT 0,
        cars INTEGER DEFAULT 12,
        line TEXT DEFAULT 'Main Line',
        frequency TEXT DEFAULT 'Daily'
    )
    """)

    # 4. Train Stops table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS train_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        train_number TEXT NOT NULL,
        station_code TEXT NOT NULL,
        station_name TEXT NOT NULL,
        stop_sequence INTEGER NOT NULL,
        arrival_time TEXT,
        departure_time TEXT,
        dist_km REAL,
        platform TEXT,
        is_fast INTEGER DEFAULT 0,
        FOREIGN KEY (train_number) REFERENCES trains (train_number)
    )
    """)

    # 5. Crowd Reports table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS crowd_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_code TEXT NOT NULL,
        station_name TEXT NOT NULL,
        crowd_level TEXT NOT NULL,
        direction TEXT NOT NULL,
        delay_observed_minutes INTEGER DEFAULT 0,
        comment TEXT,
        reported_at TEXT NOT NULL,
        verified_count INTEGER DEFAULT 1
    )
    """)

    # 6. Disruptions & Mega Blocks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS disruptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        line TEXT,
        severity TEXT,
        delay_minutes INTEGER DEFAULT 0,
        cause TEXT,
        description TEXT,
        affected_from_code TEXT,
        affected_to_code TEXT,
        published_at TEXT
    )
    """)

    # 7. Scraped Advisories table (Requests & BeautifulSoup & Selenium storage)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scraped_advisories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source_url TEXT,
        published_date TEXT,
        summary TEXT,
        category TEXT,
        scraper_tool TEXT,
        raw_html_snippet TEXT,
        scraped_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)

    conn.commit()

    # Seed data if tables are empty
    cursor.execute("SELECT COUNT(*) FROM stations")
    if cursor.fetchone()[0] == 0:
        seed_stations(cursor)

    cursor.execute("SELECT COUNT(*) FROM connections")
    if cursor.fetchone()[0] == 0:
        seed_connections(cursor)

    cursor.execute("SELECT COUNT(*) FROM trains")
    if cursor.fetchone()[0] == 0:
        seed_trains_and_stops(cursor)

    cursor.execute("SELECT COUNT(*) FROM crowd_reports")
    if cursor.fetchone()[0] == 0:
        seed_initial_crowd_reports(cursor)

    cursor.execute("SELECT COUNT(*) FROM disruptions")
    if cursor.fetchone()[0] == 0:
        seed_disruptions(cursor)

    conn.commit()
    conn.close()
    logger.info("Railway SQLite Database initialized and seeded successfully.")

def seed_stations(cursor: sqlite3.Cursor):
    """Seeds all 55 station records from official dataset."""
    if os.path.exists(OFFICIAL_DATA_JSON):
        with open(OFFICIAL_DATA_JSON, "r", encoding="utf-8") as f:
            raw_stations = json.load(f).get("stations", [])
        
        marathi_names = {
            "CSMT": "छत्रपती शिवाजी महाराज टर्मिनस", "MSD": "मशीद", "SNRD": "सँडहर्स्ट रोड",
            "BY": "भायखळा", "CHG": "चिंचपोकळी", "CRD": "करी रोड", "PR": "परेल",
            "DR": "दादर", "MTN": "माटुंगा", "SIN": "सायन", "CLA": "कुर्ला",
            "VVH": "विद्याविहार", "VV": "विद्याविहार", "GC": "घाटकोपर", "VK": "विक्रोळी",
            "KJRD": "कांजूरमार्ग", "KJMG": "कांजूरमार्ग", "BND": "भांडुप", "NHU": "नाहूर",
            "MLND": "मुलुंड", "TNA": "ठाणे", "KLVA": "कळवा", "MBQ": "मुंब्रा",
            "DIVA": "दिवा", "KOPR": "कोपर", "DI": "डोंबिवली", "THK": "ठाकुर्ली",
            "KYN": "कल्याण", "SHAD": "शहाड", "ABY": "अंबिवली", "TLA": "टिटवाळा",
            "KDV": "खडवली", "VSD": "वाशिंद", "ASO": "आसनगाव", "ATG": "आटगाव",
            "THS": "थानसित", "KE": "खर्डी", "OMB": "उंबरमाळी", "KSRA": "कसारा",
            "VLDI": "विठ्ठलवाडी", "ULNR": "उल्हासनगर", "ABH": "अंबरनाथ", "BUD": "बदलापूर",
            "VGI": "वांगणी", "SHLU": "शेलू", "NRL": "नेरळ", "BVS": "भिवपुरी रोड",
            "KJT": "कर्जत", "PDI": "पळसदरी", "KLY": "केळवली", "DLV": "डोळवली",
            "LWJ": "लौजी", "KHPI": "खोपोली", "MMCT": "मुंबई सेंट्रल", "CCG": "चर्चगेट",
            "ADH": "अंधेरी", "VSH": "वाशी"
        }

        for s in raw_stations:
            code = s.get("station_code", "").upper()
            name = s.get("station_name", "")
            lat = float(s.get("latitude", 0.0))
            lng = float(s.get("longitude", 0.0))
            dist_km = float(s.get("dist_from_csmt_km", 0.0))
            is_fast = int(s.get("is_fast_stop", 0))
            
            raw_pf = str(s.get("platforms", "2"))
            try:
                digits = "".join([c for c in raw_pf if c.isdigit()])
                pf_count = int(digits[-1]) if digits else 2
            except:
                pf_count = 2

            interchange_raw = s.get("interchange", "[]")
            if isinstance(interchange_raw, str):
                try:
                    interchange_list = json.loads(interchange_raw)
                except:
                    interchange_list = [interchange_raw]
            else:
                interchange_list = interchange_raw

            is_junction = 1 if len(interchange_list) > 0 or code in ["CSMT", "DR", "CLA", "TNA", "DIVA", "KYN", "KJT", "KSRA"] else 0
            m_name = marathi_names.get(code, name)

            cursor.execute("""
            INSERT OR REPLACE INTO stations (code, name, marathi_name, lat, lng, dist_km, is_fast, platforms, is_junction, interchange)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                code, name, m_name, lat, lng, dist_km, is_fast, pf_count, is_junction, json.dumps(interchange_list)
            ))
    elif os.path.exists(STATIONS_JSON):
        with open(STATIONS_JSON, "r", encoding="utf-8") as f:
            stations = json.load(f)
        for s in stations:
            interchange_str = json.dumps(s.get("interchange", []))
            raw_pf = str(s.get("platforms", "2"))
            try:
                pf_count = int("".join([c for c in raw_pf if c.isdigit()]) or "2")
            except Exception:
                pf_count = 2

            cursor.execute("""
            INSERT OR REPLACE INTO stations (code, name, marathi_name, lat, lng, dist_km, is_fast, platforms, is_junction, interchange)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                s.get("code", "").upper(),
                s.get("name", ""),
                s.get("marathi_name", ""),
                float(s.get("lat", 0.0)),
                float(s.get("lng", 0.0)),
                float(s.get("dist_km", 0.0)),
                1 if s.get("is_fast") else 0,
                pf_count,
                1 if s.get("is_junction") else 0,
                interchange_str
            ))

def seed_connections(cursor: sqlite3.Cursor):
    """Seeds station track connections."""
    if os.path.exists(CONNECTIONS_JSON):
        with open(CONNECTIONS_JSON, "r", encoding="utf-8") as f:
            connections = json.load(f)
        for c in connections:
            tracks_str = json.dumps(c.get("tracks", []))
            cursor.execute("""
            INSERT INTO connections (from_code, to_code, dist_km, slow_mins, fast_mins, tracks)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                c.get("from", "").upper(),
                c.get("to", "").upper(),
                float(c.get("dist_km", 0.0)),
                int(c.get("slow_mins", 0)),
                int(c.get("fast_mins")) if c.get("fast_mins") is not None else None,
                tracks_str
            ))

def seed_trains_and_stops(cursor: sqlite3.Cursor):
    """Seeds train schedules and stops from official timetable JSON."""
    if not os.path.exists(OFFICIAL_DATA_JSON):
        return

    with open(OFFICIAL_DATA_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    trains = data.get("trains", [])
    stops = data.get("train_stops", [])

    for t in trains:
        train_num = str(t.get("train_number", "")).strip()
        cursor.execute("""
        INSERT OR REPLACE INTO trains (train_number, train_name, train_type, source_code, dest_code, departure_time, arrival_time, duration_mins, is_fast, is_ac, cars, line, frequency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            train_num,
            t.get("train_name", ""),
            t.get("train_type", "Slow"),
            t.get("source_code", "").upper(),
            t.get("dest_code", "").upper(),
            t.get("departure_time", ""),
            t.get("arrival_time", ""),
            int(t.get("duration_mins", 0)),
            1 if t.get("is_fast") else 0,
            1 if t.get("is_ac") else 0,
            int(t.get("cars", 12)),
            t.get("line", "Main Line"),
            t.get("frequency", "Daily")
        ))

    for s in stops:
        cursor.execute("""
        INSERT INTO train_stops (train_number, station_code, station_name, stop_sequence, arrival_time, departure_time, dist_km, platform, is_fast)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            str(s.get("train_number", "")).strip(),
            s.get("station_code", "").upper(),
            s.get("station_name", ""),
            int(s.get("stop_sequence", 0)),
            s.get("arrival_time", ""),
            s.get("departure_time", ""),
            float(s.get("dist_km", 0.0)),
            s.get("platform", "PF 1"),
            1 if s.get("is_fast") else 0
        ))

def seed_initial_crowd_reports(cursor: sqlite3.Cursor):
    """Seeds realistic commuter crowd observations."""
    initial_reports = [
        ("DR", "Dadar", "HIGH", "UP_CSMT", 8, "Heavy morning rush on Platform 3 for UP fast trains", "2026-10-01T08:15:00Z", 14),
        ("TNA", "Thane", "SUPER_DENSE", "UP_CSMT", 10, "Peak rush on Platform 1 and 2, AC locals heavily occupied", "2026-10-01T08:30:00Z", 22),
        ("GC", "Ghatkopar", "HIGH", "UP_CSMT", 4, "Metro Line 1 interchange bridge crowd moderate", "2026-10-01T08:45:00Z", 8),
        ("KYN", "Kalyan", "HIGH", "UP_CSMT", 6, "Platform 4 crowded for CSMT fast departure", "2026-10-01T09:00:00Z", 17),
        ("CLA", "Kurla", "MEDIUM", "DOWN_KYN", 3, "Harbour line interchange platform running smooth", "2026-10-01T09:10:00Z", 5)
    ]
    cursor.executemany("""
    INSERT INTO crowd_reports (station_code, station_name, crowd_level, direction, delay_observed_minutes, comment, reported_at, verified_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, initial_reports)

def seed_disruptions(cursor: sqlite3.Cursor):
    """Seeds active disruptions and mega blocks."""
    disruptions = [
        (
            "Special Maintenance Mega Block: Matunga to Mulund",
            "Central Railway Main Line",
            "MODERATE",
            12,
            "OHE Catenary Wire Testing & Track Packing",
            "Slow corridor services operating on Down Fast line between Matunga and Mulund stations. Suburban trains running 10-15 minutes behind schedule.",
            "MTN",
            "MLND",
            "2026-10-01T06:00:00Z"
        ),
        (
            "Points & Signal Interlocking Work at Diva Junction",
            "Fast Corridor (CSMT - Kalyan)",
            "MINOR",
            5,
            "Electronic Interlocking Upgrade",
            "Speed restriction of 30 km/h applied on Platform 5 approach at Diva Jn. Minor regulation of Down trains.",
            "DIVA",
            "DIVA",
            "2026-10-01T07:30:00Z"
        )
    ]
    cursor.executemany("""
    INSERT INTO disruptions (title, line, severity, delay_minutes, cause, description, affected_from_code, affected_to_code, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, disruptions)

# Auto-initialize database when module is imported
init_db()
