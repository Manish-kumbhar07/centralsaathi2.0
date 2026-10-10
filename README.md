# CentralSaathi

### Mumbai Local Train Route and Station Connectivity Analyzer

CentralSaathi is a commuter-intelligence platform for the **Central Line of the Mumbai Suburban Railway** (CSMT to Kasara / Karjat). It helps daily commuters plan routes, understand how stations connect to each other, and keep track of delays and disruptions, all in one place.

---

## 1. About the Project

Mumbai's local trains carry millions of people every day, but route planning is still confusing. Commuters have to juggle slow vs. fast trains, junction changes (Dadar, Kurla, Thane, Kalyan), mega blocks, and last-minute delays. CentralSaathi brings that into one tool.

The project models the Central Line as a **network of stations (nodes) and rail connections (edges)**. On top of that network it provides route finding, timetable lookup, fare calculation, live-train simulation and commuter analytics.

### Key Features

| Feature | What it does |
|---|---|
| Route and connectivity planner | Finds routes between any two stations, including slow/fast options and interchange junctions |
| Station connectivity data | Station coordinates, distances, platforms, junctions and interchange links (Harbour, Outstation) |
| Timetable engine | Looks up trains, stopping patterns, and first/last train timings from the official timetable |
| Live train tracking | Interpolated GPS position, speed, and delay status for active trains |
| Fare calculator | Fare estimate between stations |
| Station facilities | Lifts, escalators, medical rooms, ATVM kiosks, water points, platform layout |
| Disruption and crowd reports | Commuters can post and verify live reports; mega block and advisory alerts |
| Analytics dashboard | Punctuality, delay distribution and crowd statistics (Pandas / NumPy) |
| Advisory scraper | Pulls railway notices and bulletins for the alerts feed |
| AI assistant | Server-side Gemini endpoint (`/api/ai/ask`) for commuter questions |

### Tech Stack

- **Frontend:** HTML5, CSS, JavaScript (`index.html`, `app.js`), SVG/JPG assets
- **Backend:** Python 3.10+, Flask, SQLite, Pandas, NumPy, Requests, BeautifulSoup4
- **Server:** Node.js + Express (`server.js`), Python engines, Vercel / Procfile deployment
- **Data:** SQLite databases, JSON station/connection data, official timetable JSON

---

## 2. Team and Responsibilities

| Area | Owner(s) | Description |
|---|---|---|
| **Backend** | Manish, Jayesh | Core Python logic: timetable engine, analytics, database layer, scrapers |
| **API** | Manish | REST endpoints and API gateway |
| **Server** | Jayesh, Arnav | Server runtime, live tracking engines, deployment config |
| **Data** | Viraj,Arnav| Station/connection datasets, timetable data, databases, importer and validator |
| **Frontend** | Manish | User interface, client-side logic, and assets |

---

## 3. File-wise Ownership

### Backend: Manish and Jayesh

| File | Purpose |
|---|---|
| `backend/__init__.py` | Backend package init |
| `backend/database.py` | SQLite module for stations, trains, crowd reports, alerts |
| `backend/timetable_engine.py` | Timetable lookup, route validation, train sequence matching |
| `backend/analytics_engine.py` | Pandas/NumPy statistics and visualization data |
| `backend/railway_analytics.py` | Advanced commuter analytics engine |
| `backend/scrapers.py` | Requests + BeautifulSoup advisory/notice scraping |
| `backend/railway_scraper.py` | Official railway scraper module |
| `central_saathi.py` | Standalone pure-Python app with CLI mode |
| `app.py` (root) | Streamlit analytics application |
| `central_saathi_project/` | Django project scaffold |

### API: Manish

| File | Purpose |
|---|---|
| `backend/app.py` | Flask REST API gateway (`/api/health`, `/api/stations`, `/api/route`, `/api/trains/*`, `/api/fare`, `/api/disruptions/*`, `/api/analytics*`, `/api/scrape/*`) |
| `api/index.js` | Serverless API entry point (exports the Express app) |
| `vercel.json` | API routing and rewrites for Vercel |

### Server: Jayesh and Arnav

| File | Purpose |
|---|---|
| `server.js` | Express server: static hosting, API routes, AI endpoint |
| `package.json` | Node dependencies and run scripts |
| `Procfile` | Process definition for deployment |
| `.env.example` | Environment variable template (API keys) |
| `server/live_telemetry.py` | GPS telemetry and train speed/delay simulation |
| `server/live_tracker.py` | Live train position and physics-based speed interpolation |
| `server/live_trains_engine.py` | Live train and NTES-timetable engine |
| `server/train_tracker.py` | Active fleet tracker |
| `server/route_engine.py` | Timetable-based route engine |
| `server/railway_news.py` | Disruptions, mega block and railway news engine |
| `server/station_facilities.py` | Station facilities and platform layout engine |
| `server/railway_db.py` | SQLite relational schema and DB engine |

### Data: Viraj and Arnav

| File | Purpose |
|---|---|
| `data/central_line_stations.json` | Station list with coordinates, distance, platforms, junction/interchange info |
| `data/central_line_connections.json` | Connectivity edges between stations (distance, slow/fast minutes, tracks) |
| `server/data/official_timetable_data.json` | Official Central Railway timetable data |
| `server/data/hero_image_config.json` | Hero image configuration |
| `server/central_saathi.db` | Main SQLite timetable database |
| `backend/railway.db` | Backend SQLite database |
| `server/railway.db` | Server SQLite database |
| `server/timetable_importer.py` | Parses timetables and seeds the database |
| `server/timetable_validator.py` | Validates timetable data (duplicates, stops, sequences) |

### Frontend: Manish

| File | Purpose |
|---|---|
| `index.html` | Main web page and UI structure |
| `app.js` | Client logic: journey planner, live tracking, season pass, alerts |
| `public/assets/` | Logo, hero images, backgrounds, train photos |
| `metadata.json` | App metadata and permissions |

---

## 4. Project Structure

```
centralsaathi2.0/
├── api/                  # API entry point            (Manish)
├── backend/              # Backend logic + Flask API  (Manish, Jayesh)
├── server/               # Server engines             (Jayesh, Arnav)
│   └── data/             # Timetable data             (Viraj,Arnav)
├── data/                 # Station & connection data  (Viraj,Arnav)
├── public/assets/        # Images and SVGs            (Manish)
├── central_saathi_project/  # Django scaffold         (Backend)
├── index.html            # Frontend UI                (Manish)
├── app.js                # Frontend logic             (Manish)
├── server.js             # Express server             (Jayesh, Arnav)
├── app.py                # Streamlit app              (Backend)
├── central_saathi.py     # Standalone Python app      (Backend)
├── package.json
├── Procfile
├── vercel.json
└── .env.example
```

---

## 5. How to Run

### Node server (main app)
```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY if you want the AI assistant
npm start                 # runs node server.js
```

### Flask backend API
```bash
pip install flask flask-cors pandas numpy requests beautifulsoup4
python backend/app.py
```

### Standalone Python version (no dependencies)
```bash
python3 central_saathi.py --serve --port 8080
python3 central_saathi.py --origin TNA --dest CSMT --time 08:30
```

---

## 6. Committing to GitHub

```bash
git add README.md
git commit -m "docs: add project description and team ownership"
git push origin main
```

Suggested commit prefixes so history shows who did what:

- `backend:` for Manish and Jayesh
- `api:` for Manish
- `server:` for Jayesh and Arnav
- `data:` for Viraj and Arnav
- `frontend:` for Manish

---

## 7. Team

| Name | Role |
|---|---|
| Manish | Backend, API, Frontend |
| Jayesh | Backend, Server |
| Arnav | Server , Data |
| Viraj | Data |
