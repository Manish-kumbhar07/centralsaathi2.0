"""
CentralSaathi - Central Line Mumbai Local Travel Analyzer
Main Streamlit Application (app.py)
Run with: streamlit run app.py
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, time
import sqlite3
from database import init_db, get_db_connection, insert_report, get_recent_reports, upvote_report, get_active_disruptions
from analytics import generate_crowd_heatmap, get_delay_distribution, get_station_punctuality_df
from engine import analyze_commuter_journey, STATION_DATA
from scraper import fetch_central_railway_advisories

# Streamlit Page Setup
st.set_page_config(
    page_title="CentralSaathi - Central Line Travel Analyzer",
    page_icon="🚆",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for Authentic Central Railway Commuter Theme
st.markdown("""
<style>
    .main-header { font-size: 2.3rem; font-weight: 800; color: #b91c1c; margin-bottom: 0px; }
    .sub-header { color: #4b5563; font-size: 0.95rem; margin-bottom: 20px; }
    .station-badge { background-color: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 6px; font-weight: 600; font-size: 0.85rem; }
    .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; }
    .card-recommendation { background: #eff6ff; border-left: 6px solid #2563eb; padding: 18px; border-radius: 8px; margin-bottom: 20px; }
    .card-alert { background: #fef2f2; border-left: 6px solid #dc2626; padding: 18px; border-radius: 8px; margin-bottom: 20px; }
</style>
""", unsafe_allow_html=True)

# Initialize SQLite database
init_db()

# Core Station list
CORE_STATION_CODES = list(STATION_DATA.keys())
STATION_NAMES = [f"{v['name']} ({k})" for k, v in STATION_DATA.items()]

# Top Header
st.markdown('<div class="main-header">🚆 CentralSaathi (सेंट्रल साथी)</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Central Railway Mumbai Local Train Commuter Intelligence, Delay Analyzer & Crowd Advisor</div>', unsafe_allow_html=True)

# Live Scraped News Ticker
bulletins = fetch_central_railway_advisories()
if bulletins:
    st.info(f"📢 **Central Railway Live Bulletin:** {bulletins[0]}")

# Sidebar Controls
st.sidebar.header("🗺️ Journey Planner")
src_choice = st.sidebar.selectbox("Source Station", STATION_NAMES, index=13) # Dombivli default
dst_choice = st.sidebar.selectbox("Destination Station", STATION_NAMES, index=0) # CSMT default

src_code = src_choice.split("(")[-1].replace(")", "").strip()
dst_code = dst_choice.split("(")[-1].replace(")", "").strip()

dep_time = st.sidebar.time_input("Departure Time", time(8, 15))
train_pref = st.sidebar.radio("Train Preference", ["Fast & Slow Locals", "Fast Trains Only", "AC Local Only"])

simulate_disruption = st.sidebar.checkbox("⚠️ Simulate Diva Point Signal Failure", value=True)

st.sidebar.divider()
st.sidebar.markdown("### ⚡ Central Railway Quick Presets")
if st.sidebar.button("🌅 Morning Peak: Dombivli ➔ CSMT (08:15)"):
    src_code, dst_code = "DI", "CSMT"
    st.rerun()
if st.sidebar.button("🌆 Evening Peak: CSMT ➔ Kalyan (18:15)"):
    src_code, dst_code = "CSMT", "KYN"
    st.rerun()

# Tabs
tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "🎯 Smart Situational Advisor",
    "📊 Train Options & Head-to-Head",
    "🗺️ Interactive Corridor Map",
    "👥 Commuter Crowdsourcing",
    "📈 Analytics & SQLite Database"
])

# Evaluate journey via Python engine
disruptions = [{"title": "Diva Curve Point Snag", "description": "15km/h speed restriction on UP fast"}] if simulate_disruption else []
analysis = analyze_commuter_journey(src_code, dst_code, dep_time.strftime("%H:%M"), disruptions)

# TAB 1: Smart Advisor
with tab1:
    rec = analysis["recommendation"]
    is_alert = rec["color"] == "red"
    
    st.markdown(f"""
    <div class="{ 'card-alert' if is_alert else 'card-recommendation' }">
        <span style="font-size: 0.75rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; color: {'#991b1b' if is_alert else '#1d4ed8'};">
            {rec['tag']} • CONFIDENCE: {rec['confidence']}%
        </span>
        <h3 style="margin: 6px 0 10px 0; color: {'#7f1d1d' if is_alert else '#1e3a8a'};">{rec['headline']}</h3>
        <p style="font-size: 0.95rem; line-height: 1.6; color: #1e293b; margin-bottom: 12px;">{rec['explanation']}</p>
        <div style="font-size: 0.85rem; font-weight: 600; color: #0f172a;">
            💡 Recommended Action: <span style="background: white; padding: 3px 8px; border-radius: 4px; border: 1px solid #cbd5e1;">{rec['preferred_train']}</span>
        </div>
    </div>
    """, unsafe_allow_html=True)
    
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Corridor Distance", f"{analysis['distance_km']:.1f} km")
    with col2:
        st.metric("Fast Local Travel Time", f"{analysis['fast_option']['duration_min']} min", f"+{analysis['fast_option']['delay_min']}m delay", delta_color="inverse")
    with col3:
        st.metric("Slow Local Travel Time", f"{analysis['slow_option']['duration_min']} min", f"+{analysis['slow_option']['delay_min']}m delay", delta_color="inverse")
    with col4:
        st.metric("Punctuality Index", f"{analysis['fast_option']['reliability']}%")

# TAB 2: Train Options
with tab2:
    st.subheader("🚆 Real-Time Train Comparison")
    
    col_f, col_s = st.columns(2)
    with col_f:
        st.markdown(f"### ⚡ Fast Local Service")
        st.write(f"**Total Estimated Time:** {analysis['fast_option']['duration_min']} minutes")
        st.write(f"**Scheduled Runtime:** {analysis['fast_option']['scheduled_min']} min (+{analysis['fast_option']['delay_min']} min active delay)")
        st.write(f"**Crowd Pressure:** {analysis['fast_option']['crowd']}")
        st.write(f"**Reliability Score:** {analysis['fast_option']['reliability']}%")
        st.info("Stops only at: Kalyan, Dombivli, Diva, Thane, Mulund, Ghatkopar, Kurla, Dadar, Byculla, CSMT")
        
    with col_s:
        st.markdown(f"### 🐢 Slow Local Service")
        st.write(f"**Total Estimated Time:** {analysis['slow_option']['duration_min']} minutes")
        st.write(f"**Scheduled Runtime:** {analysis['slow_option']['scheduled_min']} min (+{analysis['slow_option']['delay_min']} min active delay)")
        st.write(f"**Crowd Pressure:** {analysis['slow_option']['crowd']}")
        st.write(f"**Reliability Score:** {analysis['slow_option']['reliability']}%")
        st.success("All stations stop. Unaffected by Fast Track bunching over Diva curve.")

# TAB 3: Interactive Corridor Map
with tab3:
    st.subheader("🗺️ Central Railway Corridor Map (CSMT ➔ Kalyan)")
    st.markdown("Visual representation of the 54 km corridor showing track alignments and fast stops.")
    
    stn_df = pd.DataFrame([
        {"Station": k, "Name": v["name"], "Distance_km": v["dist"], "Fast_Stop": "⚡ Fast Stop" if v["fast"] else "Slow Stop"}
        for k, v in STATION_DATA.items() if v["branch"] == "main"
    ])
    st.dataframe(stn_df, use_container_width=True)

# TAB 4: Commuter Crowdsourcing
with tab4:
    st.subheader("👥 Ground-Truth Commuter Reports")
    
    with st.expander("➕ Submit Ground-Truth Report", expanded=False):
        rep_station = st.selectbox("Station", [s["name"] for s in STATION_DATA.values()])
        rep_dir = st.radio("Direction", ["UP (Towards CSMT)", "DOWN (Towards Kalyan/Kasara/Karjat)"], horizontal=True)
        rep_crowd = st.select_slider("Crowd Density", ["Light (<50%)", "Moderate", "Heavy", "Super Dense Crush Load (90%+)"])
        rep_delay = st.number_input("Observed Delay (Minutes)", min_value=0, max_value=90, value=5)
        rep_issue = st.selectbox("Issue Category", ["Normal Running", "Overcrowding", "Signal Failure", "Train Stalled", "Track Caution", "Waterlogging"])
        rep_comment = st.text_input("Comment / Platform Advice", "PF 5 footbridge is congested. Use middle bridge.")
        
        if st.button("🚀 Broadcast Report"):
            insert_report(rep_station, "UP" if "UP" in rep_dir else "DOWN", rep_crowd, rep_delay, rep_issue, rep_comment)
            st.success("Report broadcasted and saved to SQLite database!")
            st.rerun()
            
    # Display recent reports
    reports = get_recent_reports(10)
    for r in reports:
        st.markdown(f"**📍 {r['station']}** ({r['direction']}) - *{r['issue_type']}* | Delay: **+{r['delay_min']}m** | Crowd: **{r['crowd']}**")
        st.caption(f"💬 \"{r['comment']}\" — {r['created_at']} | 👍 {r['upvotes']} upvotes")
        st.divider()

# TAB 5: Analytics & SQLite DB
with tab5:
    st.subheader("📈 Central Line Commuter Analytics (Pandas & Plotly)")
    
    col_a1, col_a2 = st.columns(2)
    with col_a1:
        st.markdown("#### 24-Hour Passenger Crush Density Heatmap")
        fig_heat = generate_crowd_heatmap()
        st.plotly_chart(fig_heat, use_container_width=True)
    with col_a2:
        st.markdown("#### Root Cause Breakdown of Delays")
        fig_pie = get_delay_distribution()
        st.plotly_chart(fig_pie, use_container_width=True)
        
    st.markdown("#### Station Punctuality Index (Pandas)")
    st.dataframe(get_station_punctuality_df(), use_container_width=True)
    
    st.divider()
    st.subheader("🗄️ SQLite Database Browser (`centralsaathi.db`)")
    conn = get_db_connection()
    c_reports = pd.read_sql_query("SELECT * FROM commuter_reports ORDER BY id DESC LIMIT 5", conn)
    st.write("Recent rows from `commuter_reports`:")
    st.dataframe(c_reports, use_container_width=True)
    conn.close()
