#!/usr/bin/env python3
"""
CentralSaathi Official Railway Database Engine (SQLite3)
Implements authoritative relational schema for Mumbai Suburban Railway:
- stations
- trains
- train_stops
- timetable_versions
- service_status
- railway_alerts

Data Policy:
- Based on Central Railway Suburban Working Timetables and official announcements.
- Versioned with effective dates and verification timestamps.
- Never fabricates or estimates train timings.
"""

import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "central_saathi.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_database():
    """Initializes schema and tables for Mumbai suburban railway timetable."""
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Stations table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_code TEXT UNIQUE NOT NULL,
        station_name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        marathi_name TEXT,
        door_side TEXT DEFAULT 'Left',
        aliases TEXT NOT NULL, -- comma-separated (e.g. 'TNA,THANE')
        latitude REAL,
        longitude REAL,
        line TEXT NOT NULL, -- 'Central', 'Western', 'Harbour'
        railway_zone TEXT NOT NULL, -- 'CR', 'WR'
        interchange TEXT, -- JSON array of interchange line keys
        platforms TEXT,
        is_fast_stop INTEGER DEFAULT 0,
        dist_from_csmt_km REAL DEFAULT 0.0
    );
    """)

    # 2. Timetable versions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS timetable_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        railway_zone TEXT NOT NULL,
        line TEXT NOT NULL,
        version TEXT NOT NULL,
        effective_from TEXT NOT NULL, -- YYYY-MM-DD
        effective_until TEXT,
        source TEXT NOT NULL,
        source_url TEXT,
        is_active INTEGER DEFAULT 1,
        imported_at TEXT NOT NULL,
        verified_at TEXT NOT NULL
    );
    """)

    # 3. Trains table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        train_number TEXT UNIQUE NOT NULL, -- e.g. '95408'
        train_name TEXT NOT NULL,
        train_type TEXT NOT NULL, -- 'FAST', 'SLOW', 'AC_FAST', 'AC_SLOW'
        line TEXT NOT NULL,
        direction TEXT NOT NULL, -- 'UP' (towards CSMT) or 'DOWN' (towards Kalyan/Kasara/Karjat)
        source_station_code TEXT NOT NULL,
        destination_station_code TEXT NOT NULL,
        service_days TEXT NOT NULL, -- 'DAILY', 'MON_SAT', 'SUN_ONLY'
        cars INTEGER DEFAULT 12, -- 12 or 15
        is_ac INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        special_schedule TEXT,
        timetable_version_id INTEGER,
        FOREIGN KEY (timetable_version_id) REFERENCES timetable_versions(id)
    );
    """)

    # 4. Train Stops table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS train_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        train_id INTEGER NOT NULL,
        station_code TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        arrival_time TEXT NOT NULL, -- HH:MM (24-hr)
        departure_time TEXT NOT NULL, -- HH:MM (24-hr)
        halt_seconds INTEGER DEFAULT 30,
        platform TEXT,
        FOREIGN KEY (train_id) REFERENCES trains(id),
        UNIQUE (train_id, sequence),
        UNIQUE (train_id, station_code)
    );
    """)

    # 5. Service Status table (Live running / delay tracking / cancellation)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS service_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        train_id INTEGER NOT NULL,
        train_number TEXT,
        date TEXT NOT NULL, -- YYYY-MM-DD
        status TEXT NOT NULL, -- 'SCHEDULED', 'LIVE', 'ESTIMATED', 'CANCELLED', 'DISRUPTED'
        delay_minutes INTEGER DEFAULT 0,
        cancellation_reason TEXT,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL,
        FOREIGN KEY (train_id) REFERENCES trains(id)
    );
    """)

    # 6. Railway Notices table (Authoritative railway notices & mega blocks)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS railway_notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notice_text TEXT NOT NULL,
        notice_type TEXT NOT NULL, -- 'MEGA_BLOCK', 'DISRUPTION', 'MAINTENANCE', 'TIMETABLE_CHANGE', 'SPECIAL_SERVICE'
        line TEXT NOT NULL,
        affected_stations TEXT NOT NULL, -- comma-separated station codes e.g. 'TNA,KLVA,MBQ,DIVA,KOPR,DI,THK,KYN'
        affected_train_numbers TEXT,
        effective_from TEXT NOT NULL,
        effective_until TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'INFO', -- 'CRITICAL', 'WARNING', 'INFO'
        impact TEXT,
        advice TEXT,
        source TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        verified_by_gemini INTEGER DEFAULT 0,
        gemini_notes TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # 7. Railway Alerts table (Backwards compatibility with existing alerts)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS railway_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        line TEXT NOT NULL,
        affected_stations TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        severity TEXT NOT NULL,
        impact TEXT NOT NULL,
        advice TEXT NOT NULL,
        source TEXT NOT NULL,
        published_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );
    """)

    # Safe Schema Migrations for existing database
    def add_col_if_missing(table, column, col_type):
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc).lower():
                raise

    add_col_if_missing("stations", "marathi_name", "TEXT")
    add_col_if_missing("stations", "door_side", "TEXT DEFAULT 'Left'")
    add_col_if_missing("trains", "is_active", "INTEGER DEFAULT 1")
    add_col_if_missing("trains", "special_schedule", "TEXT")
    add_col_if_missing("timetable_versions", "is_active", "INTEGER DEFAULT 1")
    add_col_if_missing("service_status", "train_number", "TEXT")

    # Indices for high performance routing
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_train_stops_code ON train_stops(station_code);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_train_stops_train ON train_stops(train_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_trains_dir ON trains(direction, line);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_trains_days ON trains(service_days);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_stations_code ON stations(station_code);")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_database()
    print("Database tables initialized successfully at", DB_PATH)
