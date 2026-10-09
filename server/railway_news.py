#!/usr/bin/env python3
"""
CentralSaathi Official Railway News & Mega Block Engine
Fetches, categorizes, and filters suburban railway operational notices:
1. Active Disruptions (Highest Priority)
2. Upcoming Mega Blocks (e.g. Sunday maintenance windows)
3. Today's Railway Updates (Augmentations, platform modifications)
4. General Railway News (Official notifications from Central/Western Railway)

Also provides Route Alert checking:
- Checks if a searched journey path intersects with an active Mega Block or disruption
- Generates smart commuter advisory alternatives
"""

import sys
import json
import sqlite3
import os
from contextlib import closing
from datetime import datetime
from railway_db import get_connection

def get_all_railway_updates():
    """Retrieves all active railway alerts sorted by strict operational priority."""
    with closing(get_connection()) as conn:
        rows = conn.execute("""
    SELECT id, title, description, alert_type, line, affected_stations,
           start_time, end_time, severity, impact, advice, source, published_at, is_active
    FROM railway_alerts
    WHERE is_active = 1
        """).fetchall()

    alerts = [dict(r) for r in rows]

    # Priority ranking function:
    # 1. DISRUPTION (Active issues)
    # 2. MEGA_BLOCK (Upcoming Sunday or maintenance blocks)
    # 3. MAINTENANCE (Platform/line night work)
    # 4. TIMETABLE_CHANGE (General notifications)
    type_priority = {
        "DISRUPTION": 1,
        "MEGA_BLOCK": 2,
        "MAINTENANCE": 3,
        "TIMETABLE_CHANGE": 4
    }

    alerts.sort(key=lambda a: (type_priority.get(a["alert_type"], 5), a["start_time"]))

    # Grouping for easy client rendering
    active_disruptions = [a for a in alerts if a["alert_type"] == "DISRUPTION"]
    upcoming_mega_blocks = [a for a in alerts if a["alert_type"] == "MEGA_BLOCK"]
    maintenance_updates = [a for a in alerts if a["alert_type"] == "MAINTENANCE"]
    general_news = [a for a in alerts if a["alert_type"] == "TIMETABLE_CHANGE"]

    return {
        "success": True,
        "total": len(alerts),
        "alerts": alerts,
        "grouped": {
            "active_disruptions": active_disruptions,
            "upcoming_mega_blocks": upcoming_mega_blocks,
            "maintenance_updates": maintenance_updates,
            "general_news": general_news
        },
        "last_updated": datetime.now().strftime("%d %b %Y, %I:%M %p")
    }

def check_route_for_alerts(origin_code, dest_code, travel_date=None):
    """
    Checks if a journey between origin and destination is affected by an active alert or mega block.
    Returns smart alert object if affected.
    """
    with closing(get_connection()) as conn:
        rows = conn.execute("SELECT * FROM railway_alerts WHERE is_active = 1").fetchall()

    origin_code = str(origin_code or "").strip().upper()
    dest_code = str(dest_code or "").strip().upper()

    affected_alerts = []
    for r in rows:
        alert = dict(r)
        stns = [s.strip().upper() for s in alert["affected_stations"].split(",")]
        # Check if origin, destination or the corridor between them touches affected stations
        if origin_code in stns or dest_code in stns:
            affected_alerts.append(alert)
        elif ("TNA" in stns and "KYN" in stns) and (
            (origin_code in ("CSMT", "DR", "CLA", "GC", "TNA") and dest_code in ("KYN", "DI", "THK", "DIVA")) or
            (dest_code in ("CSMT", "DR", "CLA", "GC", "TNA") and origin_code in ("KYN", "DI", "THK", "DIVA"))
        ):
            affected_alerts.append(alert)

    if not affected_alerts:
        return None

    primary_alert = affected_alerts[0]
    return {
        "is_affected": True,
        "title": primary_alert["title"],
        "alert_type": primary_alert["alert_type"],
        "severity": primary_alert["severity"],
        "impact": primary_alert["impact"],
        "advice": primary_alert["advice"],
        "source": primary_alert["source"],
        "start_time": primary_alert["start_time"],
        "end_time": primary_alert["end_time"]
    }

if __name__ == "__main__":
    updates = get_all_railway_updates()
    print(json.dumps(updates, indent=2))
