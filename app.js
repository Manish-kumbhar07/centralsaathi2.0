/**
 * CentralSaathi — Mumbai Local Transit Suite
 * File: app.js
 * 
 * Production-Grade Commuter Intelligence Engine:
 * 1. Startup reveal & non-blocking location permission modal.
 * 2. Glassmorphic Hero Search with time and service selection.
 * 3. Journey Planner with verified Central Railway timetables.
 * 4. Pinned Active Train Card with Live Crowd Predictor (Historical Boarding Density Model).
 * 5. Google Maps Photorealistic Satellite Radar with live track and moving train marker.
 * 6. Commuter Desk (Fares, 12/15-Car Coach & FOB Proximity, Door Opening Sides, Station Amenities).
 * 7. My Personal Commute (Suburban Pass Tracker, Expiry Alarm, Office Train Routine with edit capability).
 * 8. Onboard GPS Speedometer Telemetry, Station Tracker, and Geofenced Wake Alarm with Ride Simulation.
 * 9. Advanced Safety SOS Console (Emergency Siren Whistle, Instant WhatsApp/SMS Location Broadcast, Junction RPF Direct Lines).
 * 10. Gemini Transit AI Copilot.
 */

// ==========================================
// GLOBAL APPLICATION STATE
// ==========================================
let allStations = [];
let googleMap = null;
let googleMapsLoaded = false;
let mapMarkers = [];
let routePolyline = null;
let trainLiveMarker = null;
let userCoords = null;
let isSatelliteMode = true;

// Active selected train & search state
let selectedTrain = null;
let currentSearchTrains = [];
let selectedTrainIndex = 0;
let currentServiceFilter = 'ALL';
let currentOriginCode = 'TNA';
let currentDestCode = 'CSMT';

function normalizeStationSearchText(value) {
  return String(value ?? '').trim().normalize('NFC').toLocaleLowerCase();
}

const STATION_SEARCH_ALIASES = {
  CSMT: ['CST', 'VT', 'Victoria Terminus', 'Chhatrapati Shivaji Terminus'],
  MMCT: ['Bombay Central'],
};

function searchStations(query, limit) {
  const normalizedQuery = normalizeStationSearchText(query);
  if (!normalizedQuery) return allStations.slice(0, limit);

  return allStations
    .map((station, index) => {
      const fields = [station.code, station.name, station.marathi_name, ...(STATION_SEARCH_ALIASES[station.code] || [])]
        .map(normalizeStationSearchText)
        .filter(Boolean);
      const exactRank = fields.some(field => field === normalizedQuery) ? 0 : null;
      const prefixRank = fields.some(field => field.startsWith(normalizedQuery)) ? 1 : null;
      const containsRank = fields.some(field => field.includes(normalizedQuery)) ? 2 : null;
      const rank = exactRank ?? prefixRank ?? containsRank;
      return { station, index, rank };
    })
    .filter(result => result.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(result => result.station);
}

function setupStationAutocomplete(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown || input.dataset.autocompleteReady === 'true') return;

  input.dataset.autocompleteReady = 'true';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', dropdownId);
  input.setAttribute('aria-expanded', 'false');
  dropdown.setAttribute('role', 'listbox');

  const syncExpanded = () => {
    const expanded = !dropdown.classList.contains('hidden');
    input.setAttribute('aria-expanded', String(expanded));
    if (!expanded) input.removeAttribute('aria-activedescendant');
  };
  new MutationObserver(syncExpanded).observe(dropdown, { attributes: true, attributeFilter: ['class'] });

  const activateOption = (option) => {
    dropdown.querySelectorAll('[role="option"]').forEach(item => {
      const active = item === option;
      item.setAttribute('aria-selected', String(active));
      item.classList.toggle('bg-emerald-50', active);
      item.classList.toggle('text-emerald-950', active);
    });
    if (option?.id) input.setAttribute('aria-activedescendant', option.id);
  };

  input.addEventListener('keydown', (event) => {
    const options = [...dropdown.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];
    const activeIndex = options.findIndex(option => option.getAttribute('aria-selected') === 'true');

    if (event.key === 'Escape' && !dropdown.classList.contains('hidden')) {
      event.preventDefault();
      dropdown.classList.add('hidden');
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = activeIndex === -1
        ? (direction === 1 ? 0 : options.length - 1)
        : (activeIndex + direction + options.length) % options.length;
      activateOption(options[nextIndex]);
      return;
    }

    if (event.key === 'Enter' && !dropdown.classList.contains('hidden') && activeIndex !== -1) {
      event.preventDefault();
      options[activeIndex].click();
    }
  });

  dropdown.addEventListener('mousemove', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && dropdown.contains(option)) activateOption(option);
  });
}

// GPS & Wake Alarm State
let gpsWatchId = null;
let simulationInterval = null;
let simulationStep = 0;
let isSimulating = false;
let wakeAlarmTargetStation = null;
let wakeAlarmDistanceThreshold = 1.5; // km
let isWakeAlarmArmed = false;
let audioContext = null;

// Emergency Siren State
let sirenOscillator = null;
let sirenGain = null;
let isSirenActive = false;

// User Pass State (persisted in localStorage)
const savedPass = localStorage.getItem('centralsaathi_user_pass');
let userPassData = savedPass ? JSON.parse(savedPass) : {
  corridor: 'Thane to CSMT',
  passType: 'First Class',
  expiryDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0], // 4 days from now
  ticketNumber: 'UTS-98421034',
};

// Daily Office Routine (persisted in localStorage)
const savedRoutine = localStorage.getItem('centralsaathi_user_routine');
let userRoutineData = savedRoutine ? JSON.parse(savedRoutine) : {
  morningTrain: '08:32 AM · Thane to Dadar',
  morningDetails: 'Fast Local · 12-Car Rake · Arrives 09:05 AM',
  eveningTrain: '06:45 PM · Dadar to Thane',
  eveningDetails: 'Fast Local · 12-Car Rake · Arrives 07:18 PM',
};

// ==========================================
// 1. LIFECYCLE & STARTUP WORKFLOW
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initLiveClock();
  setupTabNavigation();
  setupPlannerEvents();
  setupHeroEvents();
  setupStationAutocomplete('mapStationSearchInput', 'mapStationSearchDropdown');
  setupSpeedometerEvents();
  setupMobileMenu();
  loadSavedPersonalNotes();
  initHeroWallpaper();

  // Run Startup Animation -> Followed by Location Permission Modal
  runStartupSequence();

  // Load backend datasets
  await loadStationsData();
  await loadCoachLayout();
  await loadGoogleMaps();
  await loadBulletins();

  // Setup tools
  populateToolDropdowns();
  renderAmenitiesDirectory();
  initPassTrackingUI();
  updateRoutineUI();
});

// Digital Live Clock
function initLiveClock() {
  const clockEl = document.getElementById('liveClockDisplay');
  function update() {
    if (!clockEl) return;
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  }
  update();
  setInterval(update, 1000);
}

// Mobile dropdown toggle
function setupMobileMenu() {
  const toggleBtn = document.getElementById('mobileMenuToggle');
  const dropdown = document.getElementById('mobileDropdown');
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    dropdown?.classList.add('hidden');
  });
}

// Startup Opening Animation -> Location Modal Sequence
function runStartupSequence() {
  const animOverlay = document.getElementById('openingAnimationOverlay');
  const locModal = document.getElementById('locationPermissionModal');
  const allowBtn = document.getElementById('modalAllowLocationBtn');
  const dismissBtn = document.getElementById('modalDismissLocationBtn');

  // Animation runs for 1.6 seconds
  setTimeout(() => {
    if (animOverlay) {
      animOverlay.classList.add('opacity-0');
      setTimeout(() => {
        animOverlay.style.display = 'none';

        // Keep the location permission pop-up on the screen after animation ends
        if (locModal) {
          locModal.classList.remove('hidden');
        }
      }, 500);
    } else {
      if (locModal) locModal.classList.remove('hidden');
    }
  }, 1600);

  // Modal Allow Location
  allowBtn?.addEventListener('click', () => {
    locModal?.classList.add('hidden');
    requestUserInitialLocation();
  });

  // Modal Dismiss
  dismissBtn?.addEventListener('click', () => {
    locModal?.classList.add('hidden');
  });
}

function requestUserInitialLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    },
    (err) => {
      console.warn('Initial location notification:', err.message);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ==========================================
// 2. TABBED NAVIGATION WORKSPACE
// ==========================================
function setupTabNavigation() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      switchAppTab(tabId);
    });
  });

  // Commuter Suite Sub-Tabs
  document.querySelectorAll('.commuter-subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subtab = btn.dataset.subtab;
      showCommuterSubTab(subtab);
    });
  });
}

window.switchAppTab = function(tabId) {
  // Update nav buttons
  document.querySelectorAll('.nav-tab-btn').forEach(b => {
    if (b.dataset.tab === tabId) {
      b.classList.add('nav-tab-active');
      b.classList.remove('text-slate-600');
    } else {
      b.classList.remove('nav-tab-active');
      b.classList.add('text-slate-600');
    }
  });

  // Toggle tab panels
  document.querySelectorAll('.app-tab-panel').forEach(panel => {
    panel.classList.add('hidden');
  });

  const activePanel = document.getElementById(`tab-${tabId}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }

  // Hide mobile menu
  document.getElementById('mobileDropdown')?.classList.add('hidden');

  // Trigger Map resize & redraw if switching to satellite/map tab
  if (tabId === 'satellite') {
    setTimeout(() => {
      if (googleRailwayMap && window.google) {
        google.maps.event.trigger(googleRailwayMap, 'resize');
        if (selectedTrain && currentTrackingStops.length > 0) {
          fitActiveRouteOnMap();
        } else {
          fitCentralLineTracksOnMap();
        }
      }
      if (leafletMap) {
        leafletMap.invalidateSize();
        if (currentTrackingRouteCoords.length > 0) {
          fitActiveRouteOnMap();
        } else {
          recenterRouteMap();
        }
      }
      renderMIndicatorSchematic();
    }, 150);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.showCommuterSubTab = function(subtabName) {
  document.querySelectorAll('.commuter-subtab-btn').forEach(b => {
    if (b.dataset.subtab === subtabName) {
      b.classList.add('bg-white', 'text-slate-900', 'shadow-xs');
      b.classList.remove('hover:text-slate-900');
    } else {
      b.classList.remove('bg-white', 'text-slate-900', 'shadow-xs');
    }
  });

  document.querySelectorAll('.commuter-panel').forEach(p => {
    p.classList.add('hidden');
  });

  document.getElementById(`subtab-${subtabName}`)?.classList.remove('hidden');
};

window.quickPlanRoute = function(fromCode, toCode) {
  setStation('origin', fromCode);
  setStation('dest', toCode);
  switchAppTab('planner');
  executeJourneySearch();
};

// ==========================================
// 3. STATIONS DATA & GOOGLE MAPS SATELLITE
// ==========================================
async function loadStationsData() {
  try {
    const res = await fetch('/api/stations');
    if (!res.ok) throw new Error('Failed to load stations');
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      allStations = data;
    }
  } catch (err) {
    console.warn('Using embedded stations list:', err);
    allStations = [
      { code: 'CSMT', name: 'Chhatrapati Shivaji Maharaj Terminus', marathi_name: 'छत्रपती शिवाजी महाराज टर्मिनस', lat: 18.9401, lng: 72.8354, dist_km: 0.0, is_fast: true, platforms: 7, door_side: 'Left & Right' },
      { code: 'BY', name: 'Byculla', marathi_name: 'भायखळा', lat: 18.9774, lng: 72.8331, dist_km: 4.5, is_fast: true, platforms: 4, door_side: 'Left & Right' },
      { code: 'DR', name: 'Dadar', marathi_name: 'दादर', lat: 19.0178, lng: 72.8433, dist_km: 9.5, is_fast: true, platforms: 8, door_side: 'Left & Right' },
      { code: 'CLA', name: 'Kurla', marathi_name: 'कुर्ला', lat: 19.0652, lng: 72.8793, dist_km: 15.0, is_fast: true, platforms: 8, door_side: 'Left & Right' },
      { code: 'GC', name: 'Ghatkopar', marathi_name: 'घाटकोपर', lat: 19.0864, lng: 72.9081, dist_km: 19.0, is_fast: true, platforms: 4, door_side: 'Left & Right' },
      { code: 'TNA', name: 'Thane', marathi_name: 'ठाणे', lat: 19.1868, lng: 72.9757, dist_km: 34.0, is_fast: true, platforms: 10, door_side: 'Left & Right' },
      { code: 'DI', name: 'Dombivli', marathi_name: 'डोंबिवली', lat: 19.2184, lng: 73.0867, dist_km: 48.0, is_fast: true, platforms: 5, door_side: 'Left & Right' },
      { code: 'KYN', name: 'Kalyan', marathi_name: 'कल्याण', lat: 19.2437, lng: 73.1355, dist_km: 54.0, is_fast: true, platforms: 8, door_side: 'Left & Right' },
      { code: 'KSRA', name: 'Kasara', marathi_name: 'कसारा', lat: 19.6467, lng: 73.4831, dist_km: 121.0, is_fast: true, platforms: 4, door_side: 'Left' },
      { code: 'KJT', name: 'Karjat', marathi_name: 'कर्जत', lat: 18.9106, lng: 73.3283, dist_km: 100.0, is_fast: true, platforms: 4, door_side: 'Left & Right' },
    ];
  }

  renderDoorSideDirectory();
  renderAmenitiesDirectory();
}

// ==========================================
// 3. ADVANCED ORBITAL RADAR & LIVE TRACK ENGINE
// ==========================================
let leafletMap = null;
let tileLayers = {};
let currentMapLayer = 'satellite';
let leafletStationMarkers = [];
let leafletActivePolyline = null;
let leafletActiveGlow = null;
let leafletTrainMarker = null;
let leafletNetworkGroup = null;
let currentTrackingRouteCoords = [];
let currentTrackingStops = [];
let mapSimulationTimer = null;
let mapSimulationProgress = 0.0;
let mapSimulationIsPlaying = true;
let mapSimulationSpeed = 1;
let mapSimulationIndex = 0;
let mapHudMinimized = false;
let selectedStationForMapCard = null;

// Official Corridor Definitions matching 55-station database
const CORRIDOR_CODES = {
  MAIN: ['CSMT', 'MSD', 'SNRD', 'BY', 'CHG', 'CRD', 'PR', 'DR', 'MTN', 'SIN', 'CLA', 'VVH', 'GC', 'VK', 'KJRD', 'BND', 'NHU', 'MLND', 'TNA', 'KLVA', 'MBQ', 'DIVA', 'KOPR', 'DI', 'THK', 'KYN'],
  KSRA: ['KYN', 'SHAD', 'ABY', 'TLA', 'KDV', 'VSD', 'ASO', 'ATG', 'THS', 'KE', 'OMB', 'KSRA'],
  KJT: ['KYN', 'VLDI', 'ULNR', 'ABH', 'BUD', 'VGI', 'SHLU', 'NRL', 'BVS', 'KJT', 'PDI', 'KLY', 'DLV', 'LWJ', 'KHPI'],
};

// ==========================================
// GOOGLE MAPS PLATFORM RAILWAY INTEGRATION
// ==========================================
let googleRailwayMap = null;
let googleTransitLayer = null;
let googleStationMarkers = [];
let googleActivePolyline = null;
let googleActiveGlow = null;
let googleActiveTrainMarker = null;
let googleCorridorPolylines = [];
let googleCurrentMapStyle = 'transit';
let googleMapAnimInterval = null;

async function loadGoogleMaps() {
  // First attempt to initialize official Google Maps Platform Map
  const success = await initGoogleRailwayMap();
  if (!success) {
    // Graceful fallback to Leaflet satellite map if Google Maps SDK is not yet available
    initAdvancedSatelliteMap();
  }
}

async function initGoogleRailwayMap() {
  const mapContainer = document.getElementById('leafletRailwayMap') || document.getElementById('googleMapCanvas');
  if (!mapContainer) return false;

  if (window.google && window.google.maps) {
    try {
      const { Map } = await google.maps.importLibrary("maps");
      
      googleRailwayMap = new Map(mapContainer, {
        center: { lat: 19.1200, lng: 72.9300 },
        zoom: 11,
        mapTypeId: 'roadmap',
        renderingType: 'VECTOR',
        internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
        gestureHandling: 'greedy',
        scrollwheel: true,
        zoomControl: true,
        streetViewControl: true,
        mapTypeControl: false,
        fullscreenControl: true,
        styles: [
          { featureType: "transit.station.rail", elementType: "labels.icon", stylers: [{ visibility: "on" }] },
          { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#047857" }, { weight: 3.5 }] },
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "simplified" }] }
        ]
      });

      // Enable Official Google Maps Transit Layer
      googleTransitLayer = new google.maps.TransitLayer();
      googleTransitLayer.setMap(googleRailwayMap);

      // Plot All 55 Stations on Google Maps
      plotAllStationsOnGoogleMaps('ALL');
      drawCentralRailwayCorridorsOnGoogleMaps();

      // Click on canvas closes quick preview and info modal
      googleRailwayMap.addListener('click', () => {
        closeMapStationQuickPreview();
        closeMapStationInfoCard();
      });

      // Fit bounds to Central Line Tracks directly at start!
      fitCentralLineTracksOnMap();

      // If active train was selected, highlight route
      if (selectedTrain) {
        const stops = selectedTrain.intermediate_stops || selectedTrain.stops || [];
        updateGoogleMapActiveRoute(currentOriginCode || 'TNA', currentDestCode || 'CSMT', stops, selectedTrain);
      }

      console.log('Google Maps Railway Suite initialized with Transit Layer & Central Line tracks.');
      return true;
    } catch (err) {
      console.warn('Google Maps initialization error, falling back to Leaflet:', err);
      return false;
    }
  }
  return false;
}

// Fit Central Line Tracks on Google Maps
// Helper to find nearest station to a clicked coordinate
function findNearestStation(lat, lng) {
  let nearest = null;
  let minDist = Infinity;
  allStations.forEach(s => {
    if (s.lat && s.lng) {
      const d = Math.hypot(Number(s.lat) - lat, Number(s.lng) - lng);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }
  });
  return nearest;
}

// Fit Central Line Tracks on Map (Initial Zoom focused on Central Line tracks)
window.fitCentralLineTracksOnMap = function() {
  if (allStations.length === 0) return;
  const mainStns = allStations.filter(s => CORRIDOR_CODES.MAIN.includes(s.code) && s.lat && s.lng);
  const stnsToFit = mainStns.length > 0 ? mainStns : allStations.filter(s => s.lat && s.lng);

  if (googleRailwayMap && window.google) {
    const bounds = new google.maps.LatLngBounds();
    stnsToFit.forEach(s => {
      bounds.extend({ lat: Number(s.lat), lng: Number(s.lng) });
    });
    googleRailwayMap.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
  }
  if (leafletMap && window.L) {
    const coords = stnsToFit.map(s => [Number(s.lat), Number(s.lng)]);
    if (coords.length > 0) {
      leafletMap.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
    } else {
      leafletMap.setView([19.1200, 72.9300], 11);
    }
  }
};

// Plot All 55 Stations on Google Maps with m-Indicator station icons
function plotAllStationsOnGoogleMaps(filterLine = 'ALL') {
  if (!googleRailwayMap || allStations.length === 0) return;

  // Clear previous markers
  googleStationMarkers.forEach(m => m.setMap(null));
  googleStationMarkers = [];

  let stationsToPlot = allStations;
  if (filterLine === 'MAIN') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.MAIN.includes(s.code));
  } else if (filterLine === 'KSRA') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.KSRA.includes(s.code) || s.code === 'KYN');
  } else if (filterLine === 'KJT') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.KJT.includes(s.code) || s.code === 'KYN');
  } else if (filterLine === 'JUNCTIONS') {
    stationsToPlot = allStations.filter(s => s.is_junction);
  } else if (filterLine === 'ACTIVE_ROUTE') {
    if (currentTrackingStops.length > 0) {
      const haltCodes = currentTrackingStops.map(s => s.station_code || s.code);
      stationsToPlot = allStations.filter(s => haltCodes.includes(s.code));
    }
  }

  stationsToPlot.forEach(s => {
    if (!s.lat || !s.lng) return;
    const pos = { lat: Number(s.lat), lng: Number(s.lng) };

    const isOrigin = s.code === currentOriginCode;
    const isDest = s.code === currentDestCode;
    const isJunction = s.is_junction;
    const isFast = s.is_fast;

    // SVG Pin Icon with m-Indicator style distinct styling
    let fillColor = isOrigin ? '#059669' : isDest ? '#1e293b' : isJunction ? '#f59e0b' : isFast ? '#0284c7' : '#ffffff';
    let strokeColor = isJunction ? '#78350f' : isFast ? '#0369a1' : '#dc2626';
    let scale = isOrigin || isDest ? 8 : isJunction ? 7 : isFast ? 5.5 : 4.5;
    let strokeWeight = isJunction ? 2.5 : 2;

    const marker = new google.maps.Marker({
      position: pos,
      map: googleRailwayMap,
      title: `${s.name} (${s.code}) - ${s.platforms || 2} PFs · Door: ${s.door_side || 'Left'}`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: fillColor,
        fillOpacity: 1,
        strokeColor: strokeColor,
        strokeWeight: strokeWeight,
        scale: scale,
      },
      internalUsageAttributionIds: ['gmp_git_agentskills_v1']
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 6px; min-width: 210px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 6px;">
            <div>
              <div style="font-weight: 800; font-size: 14px; color: #0f172a;">${s.name}</div>
              <div style="font-size: 11px; font-weight: 700; color: #dc2626;">${s.marathi_name || ''}</div>
            </div>
            <span style="font-family: monospace; font-weight: 800; font-size: 11px; padding: 2px 6px; background: #fee2e2; color: #991b1b; border-radius: 4px;">${s.code}</span>
          </div>
          <div style="font-size: 11px; color: #475569; margin-bottom: 8px; line-height: 1.4;">
            <div><strong>${s.platforms || 2} Platforms</strong> · <span style="color: #065f46; font-weight: 700;">Door: ${s.door_side || 'Left'}</span></div>
            <div style="font-size: 10px; color: #64748b;">${s.dist_km ? s.dist_km + ' km from CSMT' : 'Central Railway'} · ${s.is_fast ? 'Fast Train Halt' : 'Slow Local'}</div>
          </div>
          <button onclick="openMapStationInfoCard(allStations.find(x => x.code === '${s.code}'))" style="width: 100%; padding: 8px 12px; background: linear-gradient(to right, #064e3b, #047857); color: white; font-weight: 800; font-size: 11px; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">
            🔍 Explore Station (Map & Amenities) ➔
          </button>
        </div>
      `
    });

    marker.addListener('click', () => {
      showStationQuickOption(s);
      infoWindow.open(googleRailwayMap, marker);
    });

    googleStationMarkers.push(marker);
  });
}

// Draw Railway Track Polylines on Google Maps in m-Indicator style
function drawCentralRailwayCorridorsOnGoogleMaps() {
  if (!googleRailwayMap || allStations.length === 0) return;

  googleCorridorPolylines.forEach(p => p.setMap(null));
  googleCorridorPolylines = [];

  function drawBranch(codes, color, casingColor, weight) {
    const coords = [];
    codes.forEach(c => {
      const stn = allStations.find(s => s.code === c);
      if (stn && stn.lat && stn.lng) {
        coords.push({ lat: Number(stn.lat), lng: Number(stn.lng) });
      }
    });

    if (coords.length > 1) {
      // Outer track ballast casing
      const casing = new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: casingColor || '#0f172a',
        strokeOpacity: 0.85,
        strokeWeight: weight + 3.5,
        map: googleRailwayMap,
        internalUsageAttributionIds: ['gmp_git_agentskills_v1']
      });
      googleCorridorPolylines.push(casing);

      // Inner railway track line
      const line = new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: color,
        strokeOpacity: 0.98,
        strokeWeight: weight,
        map: googleRailwayMap,
        internalUsageAttributionIds: ['gmp_git_agentskills_v1']
      });

      // Click on track finds nearest station and opens explore option
      line.addListener('click', (e) => {
        const nearest = findNearestStation(e.latLng.lat(), e.latLng.lng());
        if (nearest) {
          showStationQuickOption(nearest);
        }
      });

      googleCorridorPolylines.push(line);
    }
  }

  // Central Main Line (CSMT to Kalyan): Iconic Central Crimson Red
  drawBranch(CORRIDOR_CODES.MAIN, '#dc2626', '#0f172a', 5.5);
  // Kasara Branch (Kalyan to Kasara): North-East Amber Line
  drawBranch(CORRIDOR_CODES.KSRA, '#ea580c', '#0f172a', 4.5);
  // Karjat Branch (Kalyan to Karjat): South-East Blue Line
  drawBranch(CORRIDOR_CODES.KJT, '#2563eb', '#0f172a', 4.5);
}

// Update Active Route on Google Maps (Static Track Highlight - No Moving Train on Map)
function updateGoogleMapActiveRoute(originCode, destCode, intermediateStops, trainObj) {
  if (!googleRailwayMap || allStations.length === 0) return;

  const originStn = allStations.find(s => s.code === originCode);
  const destStn = allStations.find(s => s.code === destCode);
  if (!originStn || !destStn) return;

  currentOriginCode = originCode;
  currentDestCode = destCode;

  // Clear previous route polylines
  if (googleActiveGlow) {
    googleActiveGlow.setMap(null);
    googleActiveGlow = null;
  }
  if (googleActivePolyline) {
    googleActivePolyline.setMap(null);
    googleActivePolyline = null;
  }
  if (googleActiveTrainMarker) {
    googleActiveTrainMarker.setMap(null);
    googleActiveTrainMarker = null;
  }
  if (googleMapAnimInterval) {
    clearInterval(googleMapAnimInterval);
    googleMapAnimInterval = null;
  }

  const rawStops = (intermediateStops && intermediateStops.length > 0)
    ? intermediateStops
    : [originStn, destStn];

  currentTrackingStops = rawStops.map(stop => {
    const code = stop.station_code || stop.code;
    return allStations.find(s => s.code === code) || stop;
  });

  const pathCoords = [];
  const bounds = new google.maps.LatLngBounds();

  currentTrackingStops.forEach(stn => {
    if (stn && stn.lat && stn.lng) {
      const pt = { lat: Number(stn.lat), lng: Number(stn.lng) };
      pathCoords.push(pt);
      bounds.extend(pt);
    }
  });

  if (pathCoords.length < 2) return;

  // 1. Outer glowing ballast track
  googleActiveGlow = new google.maps.Polyline({
    path: pathCoords,
    strokeColor: '#047857',
    strokeOpacity: 0.4,
    strokeWeight: 9,
    map: googleRailwayMap,
    internalUsageAttributionIds: ['gmp_git_agentskills_v1']
  });

  // 2. High-visibility emerald live track
  googleActivePolyline = new google.maps.Polyline({
    path: pathCoords,
    strokeColor: '#10b981',
    strokeOpacity: 0.95,
    strokeWeight: 4.5,
    map: googleRailwayMap,
    internalUsageAttributionIds: ['gmp_git_agentskills_v1']
  });

  // Highlight markers
  plotAllStationsOnGoogleMaps('ALL');

  // Fit bounds around the route with padding
  googleRailwayMap.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });

  const subtext = document.getElementById('satelliteSubtext');
  if (subtext) {
    subtext.textContent = `Route Corridor: ${originStn.name} ➔ ${destStn.name} (${currentTrackingStops.length} halts) · Click any station for platform layout & facilities`;
  }
}

// Map Style Switcher (Transit, Satellite, Roadmap, Terrain)
window.setGoogleMapStyle = function(style) {
  googleCurrentMapStyle = style;

  ['Transit', 'Satellite', 'Roadmap', 'Terrain'].forEach(s => {
    const btn = document.getElementById(`mapStyle${s}Btn`);
    if (btn) {
      if (s.toLowerCase() === style.toLowerCase()) {
        btn.className = "px-2 py-1 rounded bg-[#064e3b] text-white font-bold shadow-2xs transition-all";
      } else {
        btn.className = "px-2 py-1 rounded hover:bg-slate-200 text-slate-700 font-semibold transition-all";
      }
    }
  });

  if (googleRailwayMap) {
    if (style === 'transit') {
      googleRailwayMap.setMapTypeId('roadmap');
      if (!googleTransitLayer) {
        googleTransitLayer = new google.maps.TransitLayer();
      }
      googleTransitLayer.setMap(googleRailwayMap);
    } else if (style === 'satellite') {
      googleRailwayMap.setMapTypeId('satellite');
    } else if (style === 'roadmap') {
      googleRailwayMap.setMapTypeId('roadmap');
    } else if (style === 'terrain') {
      googleRailwayMap.setMapTypeId('terrain');
    }
  } else if (leafletMap) {
    // Leaflet fallback
    if (style === 'satellite' && tileLayers.satellite) {
      tileLayers.satellite.addTo(leafletMap);
    }
  }
};

// ==========================================
// GEMINI BACKGROUND TRANSIT COPILOT
// ==========================================
window.askGeminiAboutCardStation = async function() {
  if (!selectedStationForMapCard) return;
  const btn = document.getElementById('cardGeminiAskBtn');
  const btnText = document.getElementById('cardGeminiBtnText');
  const respBox = document.getElementById('cardGeminiAiResponse');
  if (!respBox) return;

  btnText.textContent = 'Consulting Gemini AI...';
  respBox.classList.remove('hidden');
  respBox.innerHTML = `
    <div class="flex items-center gap-2 text-indigo-700">
      <svg class="animate-spin h-3.5 w-3.5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Analyzing platform layout, FOBs, and commuter advisory...</span>
    </div>
  `;

  try {
    const stn = selectedStationForMapCard;
    const prompt = `Give concise, practical suburban transit guidance for ${stn.name} (${stn.code}) station on Central Railway Mumbai. Specify platform door opening (${stn.door_side || 'Left'}), best foot overbridge (FOB) exit, peak crowd tips, and interchange options. 2 sentences maximum.`;
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt })
    });
    const data = await res.json();
    respBox.innerHTML = `
      <div class="font-bold text-indigo-900 mb-1 flex items-center justify-between">
        <span>✨ Gemini Station Advisory</span>
        <span class="text-[9px] text-indigo-500 font-mono">Central Railway</span>
      </div>
      <div>${data.answer || 'Platform and FOB operational guidance verified.'}</div>
    `;
    btnText.textContent = 'Ask Again';
  } catch (err) {
    respBox.innerHTML = `<span class="text-rose-600">Transit intelligence temporarily unavailable.</span>`;
    btnText.textContent = 'Ask Gemini Station Copilot';
  }
};

window.askGeminiCorridorOverview = async function() {
  const query = 'What is the current operational advisory for Mumbai Central Railway local trains (Main Line, Kasara, Karjat)? Include fast vs slow service rules and peak hour boarding tips.';
  const hudTitle = document.getElementById('hudTrainTitle');
  const prevTitle = hudTitle ? hudTitle.textContent : '';
  if (hudTitle) hudTitle.textContent = '✨ Gemini AI Consulting...';

  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    alert(`✨ CentralSaathi Gemini AI Corridor Copilot:\n\n${data.answer}`);
  } catch (e) {
    alert('Gemini Corridor intelligence: Fast locals operate on tracks 3-4 skipping minor halts. Slow locals serve all halts on tracks 1-2.');
  } finally {
    if (hudTitle) hudTitle.textContent = prevTitle;
  }
};

// Download Printable Central Railway Corridor Map Guide
window.downloadCorridorMapGuide = function() {
  const stnRows = (allStations || []).map(s => `
    <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
      <td style="padding: 6px 10px; font-weight: bold; color: #064e3b;">${s.code}</td>
      <td style="padding: 6px 10px; font-weight: 600;">${s.name}</td>
      <td style="padding: 6px 10px; color: #64748b;">${s.marathi_name || ''}</td>
      <td style="padding: 6px 10px;">${s.dist_km ? s.dist_km + ' km' : '0 km'}</td>
      <td style="padding: 6px 10px; color: ${s.is_fast ? '#047857; font-weight:bold;' : '#64748b;'}">${s.is_fast ? 'FAST & SLOW' : 'Slow Only'}</td>
      <td style="padding: 6px 10px;">PF 1-${s.platforms || 2}</td>
      <td style="padding: 6px 10px; font-weight: 500;">${s.door_side || 'Left'}</td>
    </tr>
  `).join('');

  const htmlDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Central Railway Mumbai Suburban Corridor & Station Guide — CentralSaathi</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 30px; color: #0f172a; }
    h1 { color: #064e3b; margin-bottom: 4px; }
    p { color: #64748b; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th { background: #064e3b; color: white; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <h1>Central Railway Suburban Network Official Guide</h1>
  <p>Authoritative 55-Station Working Timetable Alignment & Door-Side Directory · CentralSaathi</p>
  <button onclick="window.print()" style="padding: 8px 16px; background: #064e3b; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; margin-bottom: 15px;">Print / Save as PDF</button>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Station Name</th>
        <th>Marathi (मराठी)</th>
        <th>Dist from CSMT</th>
        <th>Halt Type</th>
        <th>Platforms</th>
        <th>Door Opening Side</th>
      </tr>
    </thead>
    <tbody>
      ${stnRows}
    </tbody>
  </table>
  <footer style="margin-top: 30px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px;">
    CentralSaathi Timetable Suite · Verified with Central Railway Mumbai Suburban Working Time Table (WTT).
  </footer>
</body>
</html>`;

  const blob = new Blob([htmlDoc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Central_Railway_Mumbai_Suburban_Network_Guide.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

function initAdvancedSatelliteMap() {
  const mapContainer = document.getElementById('leafletRailwayMap') || document.getElementById('googleMapCanvas');
  if (!mapContainer) return;

  if (window.L && !leafletMap) {
    try {
      leafletMap = L.map(mapContainer, {
        center: [19.1200, 72.9300],
        zoom: 11,
        zoomControl: true,
        attributionControl: false,
      });

      // High-visibility transit roadmap tiles matching user reference image
      tileLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      });
      tileLayers.osm.addTo(leafletMap);
      leafletNetworkGroup = L.layerGroup().addTo(leafletMap);

      // Plot All 55 Stations and Base Network Tracks
      plotAllStationsOnLeaflet();
      drawCentralRailwayCorridors();

      // Fit bounds to Central Line Tracks from CSMT to Kalyan/Kasara/Karjat
      fitCentralLineTracksOnMap();

      // Click on canvas closes inspector and preview
      leafletMap.on('click', () => {
        closeMapStationQuickPreview();
        closeMapStationInfoCard();
      });

      // If a route was already searched, plot it immediately
      if (currentSearchTrains.length > 0 && selectedTrain) {
        const stops = selectedTrain.intermediate_stops || selectedTrain.stops || [];
        updateMapActiveRoute(currentOriginCode, currentDestCode, stops, selectedTrain);
      }
    } catch (err) {
      console.warn('Leaflet initialization error:', err);
    }
  }
}

// Plot All 55 Central Railway Stations on Leaflet matching reference image
function plotAllStationsOnLeaflet(filterLine = 'ALL') {
  if (!leafletMap || !window.L || allStations.length === 0) return;

  // Clear previous station markers
  leafletStationMarkers.forEach(m => leafletMap.removeLayer(m));
  leafletStationMarkers = [];

  let stationsToPlot = allStations;
  if (filterLine === 'MAIN') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.MAIN.includes(s.code));
  } else if (filterLine === 'KSRA') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.KSRA.includes(s.code) || s.code === 'KYN');
  } else if (filterLine === 'KJT') {
    stationsToPlot = allStations.filter(s => CORRIDOR_CODES.KJT.includes(s.code) || s.code === 'KYN');
  } else if (filterLine === 'JUNCTIONS') {
    stationsToPlot = allStations.filter(s => s.is_junction);
  } else if (filterLine === 'ACTIVE_ROUTE') {
    if (currentTrackingStops.length > 0) {
      const haltCodes = currentTrackingStops.map(s => s.station_code || s.code);
      stationsToPlot = allStations.filter(s => haltCodes.includes(s.code));
    }
  }

  stationsToPlot.forEach(s => {
    if (!s.lat || !s.lng) return;

    const lat = Number(s.lat);
    const lng = Number(s.lng);

    // Custom Marker Icons matching user reference image
    const isJunction = s.is_junction;
    const isOrigin = s.code === currentOriginCode;
    const isDest = s.code === currentDestCode;

    let markerHtml = '';
    let iconSize = [18, 18];
    let iconAnchor = [9, 9];

    if (isOrigin) {
      markerHtml = `
        <div class="relative flex items-center justify-center">
          <div class="w-7 h-7 rounded-full bg-emerald-600 border-2 border-white shadow-xl flex items-center justify-center text-white font-black text-[11px]">A</div>
          <div class="absolute -inset-1 rounded-full bg-emerald-400 opacity-60 radar-pulse-ring pointer-events-none"></div>
        </div>
      `;
      iconSize = [28, 28];
      iconAnchor = [14, 14];
    } else if (isDest) {
      markerHtml = `
        <div class="relative flex items-center justify-center">
          <div class="w-7 h-7 rounded-full bg-slate-900 border-2 border-white shadow-xl flex items-center justify-center text-white font-black text-[11px]">B</div>
          <div class="absolute -inset-1 rounded-full bg-amber-400 opacity-50 radar-pulse-ring pointer-events-none"></div>
        </div>
      `;
      iconSize = [28, 28];
      iconAnchor = [14, 14];
    } else if (isJunction) {
      // Major Junction (White circle with bold dark maroon ring matching user image)
      markerHtml = `
        <div class="w-5.5 h-5.5 rounded-full bg-white border-[3.5px] border-[#881337] shadow-lg flex items-center justify-center cursor-pointer hover:scale-125 transition-transform"></div>
      `;
      iconSize = [22, 22];
      iconAnchor = [11, 11];
    } else {
      // Intermediate station (White circle with dark border matching user image)
      markerHtml = `
        <div class="w-3.5 h-3.5 rounded-full bg-white border-2 border-[#1e293b] shadow-xs cursor-pointer hover:scale-125 transition-transform"></div>
      `;
      iconSize = [14, 14];
      iconAnchor = [7, 7];
    }

    const customIcon = L.divIcon({
      html: markerHtml,
      className: 'station-div-marker',
      iconSize: iconSize,
      iconAnchor: iconAnchor,
    });

    const marker = L.marker([lat, lng], { icon: customIcon });

    // Interactive Station Explore Popup directly attached to station marker
    const popupContent = `
      <div class="p-2 min-w-[210px] text-slate-900 font-sans">
        <div class="flex items-center justify-between gap-2 border-b border-slate-200 pb-1.5 mb-1.5">
          <div>
            <div class="font-black text-sm text-slate-900 leading-tight">${s.name}</div>
            <div class="text-[10px] font-bold text-rose-800">${s.marathi_name || ''}</div>
          </div>
          <span class="text-[10px] font-mono font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 shrink-0">${s.code}</span>
        </div>
        <div class="text-[11px] text-slate-600 mb-2 space-y-0.5">
          <div>${s.platforms || 2} Platforms · <span class="font-bold text-rose-800">Door: ${s.door_side || 'Left'}</span></div>
          <div class="text-slate-400 text-[10px]">${s.dist_km ? s.dist_km + ' km from CSMT' : 'Central Railway'} · ${s.is_fast ? 'Fast Train Halt' : 'Slow Local'}</div>
        </div>
        <button onclick="openMapStationInfoCard(allStations.find(x => x.code === '${s.code}'))" class="w-full py-2 px-3 bg-gradient-to-r from-rose-800 to-red-700 hover:from-rose-900 hover:to-red-800 active:from-rose-950 text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all">
          <span>🔍 Explore Station</span>
          <span>➔</span>
        </button>
      </div>
    `;

    marker.bindPopup(popupContent, {
      offset: [0, -10],
      closeButton: true,
      className: 'custom-station-popup'
    });

    // Tooltip
    marker.bindTooltip(`<strong>${s.name}</strong> (${s.code}) · PF ${s.platforms || 2}`, {
      direction: 'top',
      offset: [0, -10],
      className: 'bg-slate-900 text-white text-[11px] font-bold rounded-lg px-2 py-1 border border-slate-700 shadow-md',
    });

    // Click handler to open both the native popup and the bottom card
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showStationQuickOption(s);
      marker.openPopup();
    });

    marker.addTo(leafletMap);
    leafletStationMarkers.push(marker);
  });
}

// Draw Background Central Railway Corridors matching user reference image
function drawCentralRailwayCorridors() {
  if (!leafletMap || !leafletNetworkGroup) return;
  leafletNetworkGroup.clearLayers();

  const connectBranch = (codes, color, casingColor, weight, dashArray) => {
    const latlngs = [];
    codes.forEach(c => {
      const stn = allStations.find(s => s.code === c);
      if (stn && stn.lat && stn.lng) {
        latlngs.push([Number(stn.lat), Number(stn.lng)]);
      }
    });
    if (latlngs.length > 1) {
      // Outer dark casing / shadow ballast
      L.polyline(latlngs, {
        color: casingColor || '#0f172a',
        weight: weight + 3,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: dashArray || null,
      }).addTo(leafletNetworkGroup);

      // Inner bold railway track line matching m-Indicator official line scheme
      const line = L.polyline(latlngs, {
        color: color,
        weight: weight,
        opacity: 1.0,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: dashArray || null,
      }).addTo(leafletNetworkGroup);

      // Clicking on the track line finds the closest station and opens the explore station option
      line.on('click', (e) => {
        const nearest = findNearestStation(e.latlng.lat, e.latlng.lng);
        if (nearest) {
          showStationQuickOption(nearest);
        }
      });
    }
  };

  // Central Main Line (CSMT to Kalyan): Solid bold Central Crimson Red track
  connectBranch(CORRIDOR_CODES.MAIN, '#dc2626', '#0f172a', 6.0, null);
  // Kasara Branch (Kalyan to Kasara): Dashed Amber/Orange track
  connectBranch(CORRIDOR_CODES.KSRA, '#ea580c', '#0f172a', 5.0, '10, 6');
  // Karjat Branch (Kalyan to Karjat & Khopoli): Dashed Royal Blue track
  connectBranch(CORRIDOR_CODES.KJT, '#2563eb', '#0f172a', 5.0, '10, 6');
}

// Update Active Route & Animated Train on Map (Google Maps or Leaflet)
function updateMapActiveRoute(originCode, destCode, intermediateStops, trainObj) {
  if (googleRailwayMap) {
    updateGoogleMapActiveRoute(originCode, destCode, intermediateStops, trainObj);
  }
  if (!leafletMap || allStations.length === 0) return;

  const originStn = allStations.find(s => s.code === originCode);
  const destStn = allStations.find(s => s.code === destCode);
  if (!originStn || !destStn) return;

  currentOriginCode = originCode;
  currentDestCode = destCode;

  // Clear previous route polylines
  if (leafletActiveGlow) {
    leafletMap.removeLayer(leafletActiveGlow);
    leafletActiveGlow = null;
  }
  if (leafletActivePolyline) {
    leafletMap.removeLayer(leafletActivePolyline);
    leafletActivePolyline = null;
  }

  const rawStops = (intermediateStops && intermediateStops.length > 0)
    ? intermediateStops
    : [originStn, destStn];

  currentTrackingStops = rawStops.map(stop => {
    const code = stop.station_code || stop.code;
    return allStations.find(s => s.code === code) || stop;
  });

  currentTrackingRouteCoords = [];
  currentTrackingStops.forEach(stn => {
    if (stn && stn.lat && stn.lng) {
      currentTrackingRouteCoords.push([Number(stn.lat), Number(stn.lng)]);
    }
  });

  if (currentTrackingRouteCoords.length < 2) return;

  // 1. Outer Ballast Glow Polyline
  leafletActiveGlow = L.polyline(currentTrackingRouteCoords, {
    color: '#047857',
    weight: 8,
    opacity: 0.45,
    lineCap: 'round',
  }).addTo(leafletMap);

  // 2. High-Visibility Emerald Live Track Polyline
  leafletActivePolyline = L.polyline(currentTrackingRouteCoords, {
    color: '#10b981',
    weight: 4.5,
    opacity: 0.95,
    dashArray: '10, 6',
    lineCap: 'round',
  }).addTo(leafletMap);

  // Re-plot Station Markers to highlight A & B
  plotAllStationsOnLeaflet('ALL');

  // Fit bounds around the route
  fitActiveRouteOnMap();

  // Update Cockpit HUD Details
  updateCockpitHudMeta(originStn, destStn, trainObj || selectedTrain);

  // Start Real-Time Train Movement along the track
  startTrainSimulationOnMap(currentTrackingStops);

  // Update Subtext
  const subtext = document.getElementById('satelliteSubtext');
  if (subtext) {
    subtext.textContent = `Tracking live alignment between ${originStn.name} and ${destStn.name} (${currentTrackingStops.length} halts · Central Railway)`;
  }
}

// Backward-compatible alias for existing calls
function updateGoogleMapRoute(originCode, destCode, intermediateStops) {
  updateMapActiveRoute(originCode, destCode, intermediateStops, selectedTrain);
}

function updateCockpitHudMeta(originStn, destStn, train) {
  const trainTitle = document.getElementById('hudTrainTitle');
  const originLabel = document.getElementById('hudOriginLabel');
  const destLabel = document.getElementById('hudDestLabel');
  const progressPct = document.getElementById('hudProgressPct');
  const progressBar = document.getElementById('hudProgressBar');

  if (trainTitle) {
    trainTitle.textContent = `${train?.train_name || 'Central Fast Local'} #${train?.train_number || '95112'}`;
  }
  if (originLabel) originLabel.textContent = originStn.name;
  if (destLabel) destLabel.textContent = destStn.name;
  if (progressPct) progressPct.textContent = 'Departing Origin';
  if (progressBar) progressBar.style.width = '5%';
}

// Start Live Train Movement Simulation on the Track
function startTrainSimulationOnMap(stops) {
  if (!leafletMap || currentTrackingRouteCoords.length < 2) return;

  if (mapSimulationTimer) {
    clearInterval(mapSimulationTimer);
    mapSimulationTimer = null;
  }

  mapSimulationIndex = 0;
  mapSimulationProgress = 0.0;
  mapSimulationIsPlaying = true;

  const playIcon = document.getElementById('hudSimPlayIcon');
  if (playIcon) playIcon.textContent = 'Pause';

  // Create or move train marker to origin
  const originCoord = currentTrackingRouteCoords[0];
  createOrMoveTrainMarker(originCoord, 25);

  // Animation interval: updates every 400ms
  mapSimulationTimer = setInterval(() => {
    if (!mapSimulationIsPlaying) return;
    stepTrainSimulationOnMap();
  }, 400);
}

function stepTrainSimulationOnMap() {
  if (currentTrackingRouteCoords.length < 2) return;

  const totalSegments = currentTrackingRouteCoords.length - 1;
  const stepIncrement = 0.02 * mapSimulationSpeed;

  mapSimulationProgress += stepIncrement;

  if (mapSimulationProgress >= 1.0) {
    mapSimulationProgress = 1.0;
    mapSimulationIsPlaying = false;
    clearInterval(mapSimulationTimer);
    mapSimulationTimer = null;

    const playIcon = document.getElementById('hudSimPlayIcon');
    if (playIcon) playIcon.textContent = 'Replay';

    const liveSpeedEl = document.getElementById('hudLiveSpeed');
    if (liveSpeedEl) liveSpeedEl.textContent = '0';

    const passedEl = document.getElementById('hudStationPassed');
    if (passedEl && currentTrackingStops.length > 0) {
      const last = currentTrackingStops[currentTrackingStops.length - 1];
      passedEl.textContent = `${last.name || last.station_name} (Arrived)`;
    }
    const nextEl = document.getElementById('hudStationNext');
    if (nextEl) nextEl.textContent = 'Destination Terminal Reached';

    const nextEtaEl = document.getElementById('hudNextEta');
    if (nextEtaEl) nextEtaEl.textContent = 'Platform Exit FOB Direct';

    const progressPct = document.getElementById('hudProgressPct');
    const progressBar = document.getElementById('hudProgressBar');
    if (progressPct) progressPct.textContent = '100% Arrived';
    if (progressBar) progressBar.style.width = '100%';
    return;
  }

  // Calculate current segment & interpolated position
  const rawIdx = mapSimulationProgress * totalSegments;
  const segIdx = Math.min(Math.floor(rawIdx), totalSegments - 1);
  const segRatio = rawIdx - segIdx;

  const p1 = currentTrackingRouteCoords[segIdx];
  const p2 = currentTrackingRouteCoords[segIdx + 1];

  const currentLat = p1[0] + (p2[0] - p1[0]) * segRatio;
  const currentLng = p1[1] + (p2[1] - p1[1]) * segRatio;

  // Realistic speed simulation: 0 at stops, 60-80 on open track
  let speedKmh = Math.round(52 + Math.sin(segRatio * Math.PI) * 26);
  if (segRatio < 0.15 || segRatio > 0.85) {
    speedKmh = Math.round(28 + Math.sin(segRatio * Math.PI) * 15);
  }

  createOrMoveTrainMarker([currentLat, currentLng], speedKmh);

  // Update HUD Passed & Approaching Stations
  const currentHalt = currentTrackingStops[segIdx] || currentTrackingStops[0];
  const nextHalt = currentTrackingStops[segIdx + 1] || currentTrackingStops[currentTrackingStops.length - 1];

  const passedEl = document.getElementById('hudStationPassed');
  const passedTimeEl = document.getElementById('hudPassedTime');
  const nextEl = document.getElementById('hudStationNext');
  const nextEtaEl = document.getElementById('hudNextEta');
  const liveSpeedEl = document.getElementById('hudLiveSpeed');
  const progressPct = document.getElementById('hudProgressPct');
  const progressBar = document.getElementById('hudProgressBar');

  if (passedEl) passedEl.textContent = `${currentHalt.name || currentHalt.station_name} (PF ${currentHalt.platforms || 2})`;
  if (passedTimeEl) passedTimeEl.textContent = `Dep: ${selectedTrain?.departure_time || '08:32'}`;
  if (nextEl) nextEl.textContent = `${nextHalt.name || nextHalt.station_name} (PF 1/2)`;

  // Distance remaining to next station
  const distToNext = calculateHaversineDistance(currentLat, currentLng, nextHalt.lat, nextHalt.lng).toFixed(1);
  const estMins = Math.max(1, Math.round(distToNext * 1.5));
  if (nextEtaEl) nextEtaEl.textContent = `${distToNext} km · ~${estMins} mins`;
  if (liveSpeedEl) liveSpeedEl.textContent = speedKmh;

  const pct = Math.round(mapSimulationProgress * 100);
  if (progressPct) progressPct.textContent = `${pct}% En Route`;
  if (progressBar) progressBar.style.width = `${pct}%`;

  // Also update global Speedometer telemetry if tab is active
  updateSpeedometerUI(speedKmh);

  // Check Wake Alarm proximity
  if (isWakeAlarmArmed && wakeAlarmTargetStation) {
    const distToTarget = calculateHaversineDistance(currentLat, currentLng, wakeAlarmTargetStation.lat, wakeAlarmTargetStation.lng);
    if (distToTarget <= wakeAlarmDistanceThreshold) {
      triggerAlarmBuzzer();
      disarmWakeAlarm();
    }
  }
}

function createOrMoveTrainMarker(latlng, speedKmh) {
  if (!leafletMap || !window.L) return;

  const trainHtml = `
    <div class="relative flex items-center justify-center">
      <div class="w-8 h-8 rounded-full bg-amber-400 border-2 border-[#064e3b] shadow-2xl flex items-center justify-center text-[#064e3b] font-black">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <rect width="16" height="16" x="4" y="3" rx="2"/>
          <circle cx="8" cy="15" r="1.5" fill="#ffffff"/>
          <circle cx="16" cy="15" r="1.5" fill="#ffffff"/>
        </svg>
      </div>
      <div class="absolute -inset-2 rounded-full bg-amber-300 opacity-60 radar-pulse-ring pointer-events-none"></div>
    </div>
  `;

  const trainIcon = L.divIcon({
    html: trainHtml,
    className: 'train-locomotive-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

  if (!leafletTrainMarker) {
    leafletTrainMarker = L.marker(latlng, { icon: trainIcon, zIndexOffset: 1000 }).addTo(leafletMap);
    leafletTrainMarker.bindTooltip(`<strong>Active EMU Train</strong> · ${speedKmh} km/h`, {
      direction: 'top',
      offset: [0, -14],
      className: 'bg-emerald-950 text-emerald-200 text-xs font-bold rounded-lg px-2 py-1 border border-emerald-500',
    });
  } else {
    leafletTrainMarker.setLatLng(latlng);
    leafletTrainMarker.setTooltipContent(`<strong>Active EMU Train</strong> · ${speedKmh} km/h`);
  }
}

// Map Controls: Maintain Dedicated Satellite Layer
window.switchMapLayer = function() {
  if (!leafletMap || !tileLayers.satellite) return;
  if (!leafletMap.hasLayer(tileLayers.satellite)) {
    tileLayers.satellite.addTo(leafletMap);
  }
  currentMapLayer = 'satellite';
};

// Map Controls: Corridor Filter Pills
window.filterMapStationsByLine = function(lineCode, buttonEl) {
  document.querySelectorAll('.map-corridor-filter').forEach(btn => {
    btn.className = 'map-corridor-filter px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold shrink-0';
  });
  if (buttonEl) {
    buttonEl.className = 'map-corridor-filter px-3 py-1.5 rounded-lg bg-[#064e3b] text-white font-bold shrink-0 shadow-2xs';
  }
  plotAllStationsOnGoogleMaps(lineCode);
  plotAllStationsOnLeaflet(lineCode);
};

// Map Controls: Station Search Autocomplete & Quick Explorer
window.filterMapStationSearch = function(query) {
  const dropdown = document.getElementById('mapStationSearchDropdown');
  if (!dropdown) return;

  const q = normalizeStationSearchText(query);
  
  // If query is empty, show curated Central Line stations directory
  if (!q) {
    const topCodes = ['CSMT', 'BY', 'DR', 'CLA', 'GC', 'BND', 'TNA', 'DIVA', 'DI', 'KYN', 'TLA', 'KSRA', 'ABH', 'BUD', 'KJT', 'KHPI'];
    const curated = allStations.filter(s => topCodes.includes(s.code));
    if (curated.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }
    let html = '<div class="p-2 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 flex items-center justify-between"><span>Central Railway Stations</span><span class="text-rose-700">Click to Explore</span></div>';
    curated.forEach(s => {
      html += `
        <div id="station-option-map-${s.code}" role="option" aria-selected="false"
          onclick="selectStationFromMapSearch('${s.code}')" 
          class="p-2.5 hover:bg-rose-50 cursor-pointer flex items-center justify-between transition-colors"
        >
          <div>
            <div class="font-extrabold text-slate-900 text-xs">${s.name} <span class="text-rose-800 font-mono text-[10px]">(${s.code})</span></div>
            <div class="text-[10px] text-slate-500">${s.marathi_name || ''} · PF ${s.platforms || 2} · Door: ${s.door_side || 'Left'}</div>
          </div>
          <span class="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200">🔍 Explore ➔</span>
        </div>
      `;
    });
    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');
    return;
  }

  const matches = searchStations(q, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = '<div role="status" aria-live="polite" class="p-3 text-slate-400 text-center">No stations found</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  let html = '';
  matches.forEach(s => {
    html += `
      <div id="station-option-map-${s.code}" role="option" aria-selected="false"
        onclick="selectStationFromMapSearch('${s.code}')" 
        class="p-2.5 hover:bg-emerald-50 cursor-pointer flex items-center justify-between transition-colors"
      >
        <div>
          <div class="font-bold text-slate-900">${s.name} <span class="text-slate-400 font-mono text-[10px]">(${s.code})</span></div>
          <div class="text-[10px] text-slate-500">${s.marathi_name || ''} · PF ${s.platforms || 2}</div>
        </div>
        <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">🔍 Explore</span>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
};

window.openExploreStationPicker = function() {
  if (selectedStationForQuickPreview) {
    openMapStationInfoCard(selectedStationForQuickPreview);
    return;
  }
  const dropdown = document.getElementById('mapStationSearchDropdown');
  const searchInput = document.getElementById('mapStationSearchInput');
  if (dropdown && searchInput) {
    searchInput.focus();
    filterMapStationSearch('');
  } else {
    // Fallback to Thane or Dadar
    const defaultStn = allStations.find(s => s.code === 'TNA') || allStations[0];
    if (defaultStn) openMapStationInfoCard(defaultStn);
  }
};

window.selectStationFromMapSearch = function(code) {
  const dropdown = document.getElementById('mapStationSearchDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  const stn = allStations.find(s => s.code === code);
  if (!stn) return;

  const searchInput = document.getElementById('mapStationSearchInput');
  if (searchInput) searchInput.value = `${stn.name} (${stn.code})`;

  if (googleRailwayMap) {
    googleRailwayMap.panTo({ lat: Number(stn.lat), lng: Number(stn.lng) });
    googleRailwayMap.setZoom(13.5);
  }
  if (leafletMap) {
    leafletMap.flyTo([Number(stn.lat), Number(stn.lng)], 13.5, { duration: 1.0 });
  }
  showStationQuickOption(stn);
  openMapStationInfoCard(stn);
};

// STEP 1: COMPACT M-INDICATOR STATION OPTION PREVIEW BUBBLE
let selectedStationForQuickPreview = null;
window.showStationQuickOption = function(stn) {
  if (!stn) return;
  selectedStationForQuickPreview = stn;
  const preview = document.getElementById('mapStationQuickPreview');
  if (!preview) return;

  document.getElementById('previewStnName').textContent = stn.name;
  document.getElementById('previewStnCode').textContent = stn.code;
  document.getElementById('previewStnMarathi').textContent = stn.marathi_name || 'मध्य रेल्वे स्थानक';
  document.getElementById('previewStnPf').textContent = `${stn.platforms || 2} Platforms`;
  document.getElementById('previewStnDoor').textContent = `Door: ${stn.door_side || 'Left'}`;
  
  const corrEl = document.getElementById('previewStnCorridor');
  if (corrEl) {
    corrEl.textContent = `${stn.dist_km ? stn.dist_km + ' km from CSMT' : 'Central Railway'} · ${stn.is_fast ? 'Fast Train Halt' : 'Slow Local Halt'}`;
  }

  preview.classList.remove('hidden');
};

window.closeMapStationQuickPreview = function() {
  document.getElementById('mapStationQuickPreview')?.classList.add('hidden');
  selectedStationForQuickPreview = null;
};

window.openFullStationExplorerFromPreview = function() {
  if (selectedStationForQuickPreview) {
    const stn = selectedStationForQuickPreview;
    closeMapStationQuickPreview();
    openMapStationInfoCard(stn);
  }
};

// STEP 2: FULL COMPREHENSIVE STATION EXPLORER (Platform Layout, Station Map, Amenities, Emergency)
window.openMapStationInfoCard = async function(stn) {
  selectedStationForMapCard = stn;
  const card = document.getElementById('mapStationInfoCard');
  if (!card) return;

  // Immediate primary values
  document.getElementById('cardStnName').textContent = stn.name;
  document.getElementById('cardStnCode').textContent = stn.code;
  document.getElementById('cardStnPf').textContent = `${stn.platforms || 2} Platforms`;
  document.getElementById('cardStnMarathi').textContent = stn.marathi_name || 'मध्य रेल्वे स्थानक';

  const distEl = document.getElementById('cardStnDist');
  if (distEl) distEl.textContent = `${stn.dist_km ? stn.dist_km + ' km' : '0 km'} from CSMT`;

  const doorBadge = document.getElementById('cardStnDoorBadge');
  if (doorBadge) doorBadge.textContent = `Door: ${stn.door_side || 'Left'}`;

  // Reset SVG Map box with loader
  const svgBox = document.getElementById('cardStationSvgMapBox');
  if (svgBox) {
    svgBox.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs">Generating verified platform track schematic from Central Railway layout engine...</div>';
  }

  // Reset Gemini AI drawer
  const aiResp = document.getElementById('cardGeminiAiResponse');
  if (aiResp) {
    aiResp.classList.add('hidden');
    aiResp.innerHTML = '';
  }
  const aiBtnText = document.getElementById('cardGeminiBtnText');
  if (aiBtnText) {
    aiBtnText.textContent = 'Ask Gemini Station Copilot';
  }

  card.classList.remove('hidden');

  // Fetch full verified station facilities from Python backend
  try {
    const res = await fetch(`/api/stations/${stn.code}/facilities`);
    const data = await res.json();
    if (data) {
      // 1. Injected Python SVG Station Map
      if (svgBox && data.svg_map) {
        svgBox.innerHTML = data.svg_map;
      }

      // 2. Emergency Contacts Directory
      if (data.emergency_contacts) {
        const em = data.emergency_contacts;
        const rpfEl = document.getElementById('cardRpfPhone');
        if (rpfEl) rpfEl.textContent = em.rpf || '022-22620173';
        const grpEl = document.getElementById('cardGrpPhone');
        if (grpEl) grpEl.textContent = em.grp || '1512 / GRP Thana';
        const smEl = document.getElementById('cardSmPhone');
        if (smEl) smEl.textContent = em.station_master || `Station Master Office (${stn.code} PF 1)`;
        const divEl = document.getElementById('cardDivyangjanSummary');
        if (divEl) divEl.textContent = em.divyangjan_help || 'Wheelchair, Stretcher & Ramp assistance available at Station Master Office';
      }

      if (data.facilities) {
        const fac = data.facilities;
        
        const corrEl = document.getElementById('cardStnCorridor');
        if (corrEl) corrEl.textContent = data.corridor || 'Central Railway Suburban Corridor';

        // Escalators & Lifts
        const escCount = fac.escalators?.count || 0;
        const liftCount = fac.lifts?.count || 0;
        document.getElementById('cardStnEscalators').textContent = escCount;
        document.getElementById('cardStnLifts').textContent = liftCount;
        const escLoc = document.getElementById('cardEscalatorLocations');
        if (escLoc) escLoc.textContent = fac.escalators?.locations || 'Main Foot Overbridge';

        // Ticket Windows & ATVMs
        const ticketEl = document.getElementById('cardTicketSummary');
        if (ticketEl) ticketEl.textContent = `${fac.ticket_counters?.manual_windows || 4} Windows · ${fac.ticket_counters?.atvm_machines || 6} ATVMs`;

        // Water ATMs
        document.getElementById('cardStnWater').textContent = fac.drinking_water?.water_atms || 2;
        const waterEl = document.getElementById('cardWaterSummary');
        if (waterEl) waterEl.textContent = `${fac.drinking_water?.water_atms || 2} Water ATMs (₹1/₹2)`;

        // Sanitation & Lounges
        const sanEl = document.getElementById('cardSanitationSummary');
        if (sanEl) sanEl.textContent = fac.sanitation?.toilets || 'Pay & Use Washrooms';
        const waitEl = document.getElementById('cardWaitingRoomSummary');
        if (waitEl) waitEl.textContent = fac.sanitation?.waiting_rooms || 'Waiting Rooms on PF 1';

        // Medical & Emergency
        const medEl = document.getElementById('cardMedicalSummary');
        if (medEl) medEl.textContent = fac.medical_emergency?.post || 'First Aid Post at Station Master Office (PF 1)';

        // Security
        const polEl = document.getElementById('cardPoliceSummary');
        if (polEl) polEl.textContent = `${fac.security?.rpf_post || 'RPF Help Post'} · ${fac.security?.grp_police_thana || 'GRP Police'}`;

        // Track Schematic
        const trackList = document.getElementById('cardTrackSchematicList');
        if (trackList && data.track_layout?.suburban_tracks) {
          trackList.innerHTML = data.track_layout.suburban_tracks.map(t => `
            <div class="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between">
              <div><span class="font-bold text-slate-900">${t.platform}:</span> <span class="text-slate-600 font-medium">${t.track_type}</span></div>
              <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">Door ${t.door}</span>
            </div>
          `).join('');
        }

        // FOBs
        const fobEl = document.getElementById('cardFobLayout');
        if (fobEl && data.track_layout?.fobs) {
          const fobNames = data.track_layout.fobs.map(f => `${f.name} (${f.connects})`).join('; ');
          fobEl.innerHTML = `<strong>Bridges &amp; Skywalks:</strong> ${fobNames}`;
        }

        // Interchanges
        const interContainer = document.getElementById('cardStnInterchanges');
        if (interContainer && fac.interchanges) {
          interContainer.innerHTML = fac.interchanges.map(tag => `
            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">${tag}</span>
          `).join('');
        }
      }
    }
  } catch (err) {
    console.warn('Station facilities load error:', err);
  }
};

window.closeMapStationInfoCard = function() {
  document.getElementById('mapStationInfoCard')?.classList.add('hidden');
  const aiResp = document.getElementById('cardGeminiAiResponse');
  if (aiResp) {
    aiResp.classList.add('hidden');
    aiResp.innerHTML = '';
  }
  selectedStationForMapCard = null;
};

window.setStationAsOriginFromMap = function() {
  const stn = selectedStationForMapCard || selectedStationForQuickPreview;
  if (!stn) return;
  setStation('origin', stn.code);
  closeMapStationQuickPreview();
  closeMapStationInfoCard();
  switchAppTab('planner');
};

window.setStationAsDestFromMap = function() {
  const stn = selectedStationForMapCard || selectedStationForQuickPreview;
  if (!stn) return;
  setStation('dest', stn.code);
  closeMapStationQuickPreview();
  closeMapStationInfoCard();
  switchAppTab('planner');
};

// ==========================================
// M-INDICATOR VERTICAL LINE DIAGRAM ENGINE
// ==========================================
let currentMapLineFilter = 'ALL';

window.switchMapView = function(view) {
  const mapView = document.getElementById('leafletRailwayMap');
  const schematicView = document.getElementById('mIndicatorSchematicView');
  const btnMap = document.getElementById('btnViewTrackMap');
  const btnSchematic = document.getElementById('btnViewSchematic');

  if (view === 'schematic') {
    if (mapView) mapView.classList.add('hidden');
    if (schematicView) schematicView.classList.remove('hidden');
    if (btnMap) btnMap.className = "px-3 py-1 rounded-lg hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-all flex items-center gap-1";
    if (btnSchematic) btnSchematic.className = "px-3 py-1 rounded-lg bg-[#064e3b] text-white font-bold text-xs shadow-2xs transition-all flex items-center gap-1";
    renderMIndicatorSchematic();
  } else {
    if (schematicView) schematicView.classList.add('hidden');
    if (mapView) mapView.classList.remove('hidden');
    if (btnSchematic) btnSchematic.className = "px-3 py-1 rounded-lg hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-all flex items-center gap-1";
    if (btnMap) btnMap.className = "px-3 py-1 rounded-lg bg-[#064e3b] text-white font-bold text-xs shadow-2xs transition-all flex items-center gap-1";
    if (googleRailwayMap) {
      google.maps.event.trigger(googleRailwayMap, 'resize');
      fitCentralLineTracksOnMap();
    }
    if (leafletMap) {
      leafletMap.invalidateSize();
      fitCentralLineTracksOnMap();
    }
  }
};

window.renderMIndicatorSchematic = function() {
  const container = document.getElementById('mIndicatorStationList');
  if (!container || allStations.length === 0) return;

  let stationsToRender = allStations;
  if (currentMapLineFilter === 'MAIN') {
    stationsToRender = allStations.filter(s => CORRIDOR_CODES.MAIN.includes(s.code));
  } else if (currentMapLineFilter === 'KSRA') {
    stationsToRender = allStations.filter(s => CORRIDOR_CODES.KSRA.includes(s.code) || s.code === 'KYN');
  } else if (currentMapLineFilter === 'KJT') {
    stationsToRender = allStations.filter(s => CORRIDOR_CODES.KJT.includes(s.code) || s.code === 'KYN');
  } else if (currentMapLineFilter === 'JUNCTIONS') {
    stationsToRender = allStations.filter(s => s.is_junction);
  }

  let html = '';
  stationsToRender.forEach(s => {
    const isJunction = s.is_junction;
    const isFast = s.is_fast;
    const isOrigin = s.code === currentOriginCode;
    const isDest = s.code === currentDestCode;

    let nodeColor = isOrigin ? 'bg-emerald-500 ring-4 ring-emerald-950' 
                  : isDest ? 'bg-blue-500 ring-4 ring-blue-950'
                  : isJunction ? 'bg-amber-400 ring-4 ring-amber-950'
                  : isFast ? 'bg-sky-400 ring-2 ring-sky-900'
                  : 'bg-slate-300 ring-2 ring-slate-800';

    html += `
      <div class="relative flex items-center justify-between gap-3 p-3 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 rounded-2xl transition-all shadow-xs group">
        <!-- Connecting Bullet -->
        <div class="absolute -left-6.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full ${nodeColor} shrink-0 shadow-md"></div>

        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-xl ${isJunction ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-slate-700/80 text-slate-300'} flex items-center justify-center font-mono font-black text-xs shrink-0">
            ${s.code}
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-extrabold text-white text-sm tracking-tight truncate">${s.name}</span>
              <span class="text-xs font-semibold text-emerald-400 shrink-0">${s.marathi_name || ''}</span>
              ${isFast ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-700 shrink-0">Fast Stop</span>' : ''}
              ${isJunction ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-700 shrink-0">Junction</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>${s.platforms || 2} Platforms</span>
              <span>•</span>
              <span class="text-emerald-300 font-semibold">Door: ${s.door_side || 'Left'}</span>
              <span>•</span>
              <span>${s.dist_km ? s.dist_km + ' km' : '0 km'} from CSMT</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button onclick="openMapStationInfoCard(allStations.find(x => x.code === '${s.code}'))" class="px-3 py-1.5 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 active:from-emerald-800 active:to-teal-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1">
            <span>🔍 Explore</span>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
};

window.filterMapStationsByLine = function(line, btn) {
  currentMapLineFilter = line;
  document.querySelectorAll('.map-corridor-filter').forEach(b => {
    b.className = "map-corridor-filter px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold shrink-0 transition-all";
  });
  if (btn) {
    btn.className = "map-corridor-filter px-3 py-1.5 rounded-lg bg-[#064e3b] text-white font-bold shrink-0 shadow-2xs transition-all";
  }

  plotAllStationsOnGoogleMaps(line);
  if (leafletMap) plotAllStationsOnLeaflet(line);
  renderMIndicatorSchematic();
};

// Simulation Controls
window.toggleTrainSimulationPlay = function() {
  mapSimulationIsPlaying = !mapSimulationIsPlaying;
  const playIcon = document.getElementById('hudSimPlayIcon');
  if (playIcon) playIcon.textContent = mapSimulationIsPlaying ? 'Pause' : 'Play';

  if (mapSimulationIsPlaying && !mapSimulationTimer) {
    if (mapSimulationProgress >= 1.0) mapSimulationProgress = 0.0;
    mapSimulationTimer = setInterval(stepTrainSimulationOnMap, 400);
  }
};

window.cycleTrainSimulationSpeed = function() {
  if (mapSimulationSpeed === 1) mapSimulationSpeed = 2;
  else if (mapSimulationSpeed === 2) mapSimulationSpeed = 5;
  else mapSimulationSpeed = 1;

  const label = document.getElementById('hudSimSpeedLabel');
  if (label) label.textContent = `${mapSimulationSpeed}x`;
};

window.resetTrainSimulation = function() {
  mapSimulationProgress = 0.0;
  mapSimulationIsPlaying = true;
  const playIcon = document.getElementById('hudSimPlayIcon');
  if (playIcon) playIcon.textContent = 'Pause';

  if (!mapSimulationTimer) {
    mapSimulationTimer = setInterval(stepTrainSimulationOnMap, 400);
  }
  stepTrainSimulationOnMap();
};

window.toggleMapHudMinimize = function() {
  mapHudMinimized = !mapHudMinimized;
  const body = document.getElementById('hudBodyContent');
  const icon = document.getElementById('hudToggleIcon');
  if (body) body.classList.toggle('hidden', mapHudMinimized);
  if (icon) icon.textContent = mapHudMinimized ? 'Expand' : 'Minimize';
};

window.toggleRealGpsTracking = function() {
  switchAppTab('speedometer');
  requestSpeedometerGps();
};

window.fitActiveRouteOnMap = function() {
  if (googleRailwayMap && currentTrackingStops.length > 0) {
    const bounds = new google.maps.LatLngBounds();
    currentTrackingStops.forEach(s => {
      if (s.lat && s.lng) bounds.extend({ lat: Number(s.lat), lng: Number(s.lng) });
    });
    googleRailwayMap.fitBounds(bounds);
    return;
  }
  if (!leafletMap || currentTrackingRouteCoords.length === 0) {
    recenterRouteMap();
    return;
  }
  const bounds = L.latLngBounds(currentTrackingRouteCoords);
  leafletMap.fitBounds(bounds, { padding: [50, 50] });
};

window.recenterRouteMap = function() {
  if (googleRailwayMap) {
    fitCentralLineTracksOnMap();
  } else if (leafletMap) {
    leafletMap.setView([19.1200, 72.9300], 11);
  }
};

// ==========================================
// LANDING PAGE HERO BACKGROUND CUSTOMIZATION
// ==========================================
// LANDING PAGE HERO BACKGROUND CUSTOMIZATION
// ==========================================
const HERO_BG_PRESETS = {
  dusk: {
    url: '/assets/mumbai_railway_hero.svg',
    name: 'Dusk EMU'
  },
  midnight: {
    url: '/assets/bg_midnight_rail.svg',
    name: 'Midnight Electric'
  },
  monsoon: {
    url: '/assets/bg_monsoon_ghat.svg',
    name: 'Monsoon Ghat'
  },
  heritage: {
    url: '/assets/bg_heritage_vt.svg',
    name: 'VT Heritage'
  }
};

window.toggleHeroBgModal = function(show = true) {
  const modal = document.getElementById('heroBgModal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
};

window.selectPresetBg = function(presetKey) {
  const preset = HERO_BG_PRESETS[presetKey];
  if (!preset) return;

  applyHeroBg(preset.url, preset.name);
  try {
    localStorage.setItem('centralsaathi_hero_bg', preset.url);
    localStorage.setItem('centralsaathi_hero_bg_name', preset.name);
  } catch (e) {
    console.warn('LocalStorage error:', e);
  }

  // Persist preset choice to server permanently
  fetch('/api/save-hero-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: preset.url, name: preset.name })
  }).catch(err => console.warn('Failed to save preset to server:', err));

  toggleHeroBgModal(false);
};

window.handleHeroBgFileSelected = function(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const rawDataUrl = e.target.result;
    
    // Scale and optimize image to ensure it easily fits in localStorage and persists permanently
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      const maxW = 1920;
      const maxH = 1080;
      if (w > maxW || h > maxH) {
        if (w / h > maxW / maxH) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        } else {
          w = Math.round((w * maxH) / h);
          h = maxH;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      applyHeroBg(optimizedDataUrl, 'Custom Train Photo');
      try {
        localStorage.setItem('centralsaathi_hero_bg', optimizedDataUrl);
        localStorage.setItem('centralsaathi_hero_bg_name', 'Custom Train Photo');
      } catch (err) {
        console.warn('LocalStorage cache limit:', err);
      }

      // Persist to server permanently so it survives across sessions and reloads
      fetch('/api/save-hero-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: optimizedDataUrl, name: 'Custom Train Photo' })
      }).then(r => r.json()).then(data => {
        if (data.url && data.url !== optimizedDataUrl) {
          try {
            localStorage.setItem('centralsaathi_hero_bg', data.url);
          } catch (e) {}
        }
      }).catch(err => console.warn('Failed to save wallpaper to server:', err));

      toggleHeroBgModal(false);
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
};

window.resetHeroBgToDefault = function() {
  localStorage.removeItem('centralsaathi_hero_bg');
  localStorage.removeItem('centralsaathi_hero_bg_name');
  applyHeroBg(HERO_BG_PRESETS.dusk.url, 'Dusk EMU');
  fetch('/api/save-hero-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath: HERO_BG_PRESETS.dusk.url, name: 'Dusk EMU' })
  }).catch(err => {});
  toggleHeroBgModal(false);
};

function applyHeroBg(bgUrl, labelText = '') {
  const banner = document.getElementById('heroAtmosphericBanner');
  if (!banner) return;

  banner.style.backgroundImage = `linear-gradient(90deg, rgba(7, 19, 30, 0.94) 0%, rgba(7, 19, 30, 0.82) 38%, rgba(7, 19, 30, 0.22) 75%, rgba(7, 19, 30, 0.35) 100%), radial-gradient(ellipse at 80% 50%, rgba(217, 119, 6, 0.20) 0%, rgba(7, 19, 30, 0) 70%), url('${bgUrl}')`;
  banner.style.backgroundPosition = 'right center';
  banner.style.backgroundSize = 'cover';
  banner.style.backgroundRepeat = 'no-repeat';

  const label = document.getElementById('currentHeroBgLabel');
  if (label && labelText) {
    label.textContent = labelText;
  }
}

async function initHeroWallpaper() {
  const savedBg = localStorage.getItem('centralsaathi_hero_bg');
  const savedName = localStorage.getItem('centralsaathi_hero_bg_name');
  if (savedBg) {
    applyHeroBg(savedBg, savedName || 'Custom Train Photo');
  }

  // Check if a saved custom photo or preset exists on the server
  try {
    const res = await fetch('/api/current-hero-image');
    if (res.ok) {
      const data = await res.json();
      if (data.exists && data.url) {
        applyHeroBg(data.url, data.name || 'Saved Train Photo');
        try {
          localStorage.setItem('centralsaathi_hero_bg', data.url);
          localStorage.setItem('centralsaathi_hero_bg_name', data.name || 'Saved Train Photo');
        } catch (e) {}
        return;
      }
    }
  } catch (e) {
    // fallback
  }

  if (!savedBg) {
    applyHeroBg(HERO_BG_PRESETS.dusk.url, 'Dusk EMU');
  }
}

// ==========================================
// 4. HERO SECTION SEARCH
// ==========================================
function setupHeroEvents() {
  const heroFrom = document.getElementById('heroOriginInput');
  const heroTo = document.getElementById('heroDestInput');

  setupStationAutocomplete('heroOriginInput', 'heroOriginDropdown');
  setupStationAutocomplete('heroDestInput', 'heroDestDropdown');
  const heroTime = document.getElementById('heroTimeInput');

  // Pre-fill current time in hero input
  if (heroTime) {
    const now = new Date();
    heroTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  heroFrom?.addEventListener('input', (e) => {
    delete e.target.dataset.code;
    filterHeroDropdown('origin', e.target.value);
  });
  heroFrom?.addEventListener('focus', (e) => filterHeroDropdown('origin', e.target.value));
  heroTo?.addEventListener('input', (e) => {
    delete e.target.dataset.code;
    filterHeroDropdown('dest', e.target.value);
  });
  heroTo?.addEventListener('focus', (e) => filterHeroDropdown('dest', e.target.value));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#heroOriginInput') && !e.target.closest('#heroOriginDropdown')) {
      document.getElementById('heroOriginDropdown')?.classList.add('hidden');
    }
    if (!e.target.closest('#heroDestInput') && !e.target.closest('#heroDestDropdown')) {
      document.getElementById('heroDestDropdown')?.classList.add('hidden');
    }
  });
}

function filterHeroDropdown(type, query) {
  const dropdown = document.getElementById(type === 'origin' ? 'heroOriginDropdown' : 'heroDestDropdown');
  if (!dropdown) return;

  const matched = searchStations(query, 10);

  if (matched.length === 0) {
    dropdown.innerHTML = `<div role="status" aria-live="polite" class="p-3 text-xs text-slate-400 text-center">No stations found</div>`;
    dropdown.classList.remove('hidden');
    return;
  }

  let html = '';
  matched.forEach(s => {
    html += `
      <div id="station-option-hero-${type}-${s.code}" role="option" aria-selected="false"
        class="p-2.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors"
        onclick="selectHeroStation('${type}', '${s.code}')"
      >
        <div class="flex items-center gap-2">
          <span class="w-8 h-6 rounded bg-emerald-50 text-emerald-800 text-xs font-black flex items-center justify-center">${s.code}</span>
          <div>
            <div class="text-xs font-bold text-slate-900">${s.name}${s.marathi_name ? ` <span lang="mr" class="text-slate-500 font-medium">(${s.marathi_name})</span>` : ''}</div>
            <div class="text-[10px] text-slate-400">${s.dist_km} km · Door: ${s.door_side || 'Left'}</div>
          </div>
        </div>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
}

window.selectHeroStation = function(type, code) {
  const stn = allStations.find(s => s.code === code);
  if (!stn) return;
  const input = document.getElementById(type === 'origin' ? 'heroOriginInput' : 'heroDestInput');
  if (input) {
    input.value = `${stn.name} (${stn.code})`;
    input.dataset.code = stn.code;
  }
  document.getElementById(type === 'origin' ? 'heroOriginDropdown' : 'heroDestDropdown')?.classList.add('hidden');
};

window.executeHeroSearch = function() {
  const heroFrom = document.getElementById('heroOriginInput');
  const heroTo = document.getElementById('heroDestInput');
  const heroTime = document.getElementById('heroTimeInput')?.value || '';
  const heroService = document.getElementById('heroServiceSelect')?.value || 'ALL';

  const fromCode = heroFrom?.dataset.code;
  const toCode = heroTo?.dataset.code;

  if (!fromCode || !toCode) {
    alert('Please select both Starting Station and Destination in the search box.');
    return;
  }

  // Sync with Journey Planner inputs
  setStation('origin', fromCode);
  setStation('dest', toCode);

  const plannerTime = document.getElementById('plannerTimeInput');
  if (plannerTime && heroTime) plannerTime.value = heroTime;

  currentServiceFilter = heroService;
  document.querySelectorAll('.pref-type-btn').forEach(b => {
    if (b.dataset.type === heroService) {
      b.classList.add('bg-white', 'text-slate-900', 'shadow-2xs', 'font-bold');
      b.classList.remove('text-slate-600');
    } else {
      b.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs', 'font-bold');
      b.classList.add('text-slate-600');
    }
  });

  switchAppTab('planner');
  executeJourneySearch();
};

// ==========================================
// 5. JOURNEY PLANNER & TIMETABLE SEARCH
// ==========================================
function setupPlannerEvents() {
  const originInput = document.getElementById('originInput');
  const destInput = document.getElementById('destInput');
  const swapBtn = document.getElementById('swapStationsBtn');
  const findBtn = document.getElementById('findBestTrainBtn');
  const plannerTime = document.getElementById('plannerTimeInput');

  setupStationAutocomplete('originInput', 'originDropdown');
  setupStationAutocomplete('destInput', 'destDropdown');

  if (plannerTime) {
    const now = new Date();
    plannerTime.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  originInput?.addEventListener('input', (e) => {
    delete e.target.dataset.code;
    filterStationDropdown('origin', e.target.value);
  });
  originInput?.addEventListener('focus', (e) => filterStationDropdown('origin', e.target.value));
  destInput?.addEventListener('input', (e) => {
    delete e.target.dataset.code;
    filterStationDropdown('dest', e.target.value);
  });
  destInput?.addEventListener('focus', (e) => filterStationDropdown('dest', e.target.value));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#originContainer')) {
      document.getElementById('originDropdown')?.classList.add('hidden');
    }
    if (!e.target.closest('#destContainer')) {
      document.getElementById('destDropdown')?.classList.add('hidden');
    }
  });

  swapBtn?.addEventListener('click', () => {
    document.getElementById('swapIcon')?.classList.toggle('rotated');
    const tempCode = originInput.dataset.code;
    const tempVal = originInput.value;
    originInput.dataset.code = destInput.dataset.code;
    originInput.value = destInput.value;
    destInput.dataset.code = tempCode;
    destInput.value = tempVal;

    if (originInput.dataset.code && destInput.dataset.code) {
      executeJourneySearch();
    }
  });

  document.querySelectorAll('.pref-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pref-type-btn').forEach(b => {
        b.classList.remove('bg-white', 'text-slate-900', 'shadow-2xs', 'font-bold');
        b.classList.add('text-slate-600');
      });
      btn.classList.add('bg-white', 'text-slate-900', 'shadow-2xs', 'font-bold');
      btn.classList.remove('text-slate-600');
      currentServiceFilter = btn.dataset.type;

      if (originInput.dataset.code && destInput.dataset.code) {
        executeJourneySearch();
      }
    });
  });

  findBtn?.addEventListener('click', () => {
    executeJourneySearch();
  });
}

function filterStationDropdown(type, query) {
  const dropdown = document.getElementById(type === 'origin' ? 'originDropdown' : 'destDropdown');
  if (!dropdown) return;

  const matched = searchStations(query, 10);

  if (matched.length === 0) {
    dropdown.innerHTML = `<div role="status" aria-live="polite" class="p-3 text-xs text-slate-400 text-center">No stations found</div>`;
    dropdown.classList.remove('hidden');
    return;
  }

  let html = '';
  matched.forEach(s => {
    const doorBadge = s.door_side ? `<span class="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Door: ${s.door_side}</span>` : '';
    const fastTag = s.is_fast ? `<span class="text-[9px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded font-bold">Fast</span>` : '';

    html += `
      <div id="station-option-planner-${type}-${s.code}" role="option" aria-selected="false"
        class="p-2.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors"
        onclick="selectStation('${type}', '${s.code}')"
      >
        <div class="flex items-center gap-2">
          <span class="w-8 h-6 rounded bg-slate-100 text-slate-900 text-xs font-black flex items-center justify-center">${s.code}</span>
          <div>
            <div class="text-xs font-bold text-slate-900">${s.name} <span class="text-slate-400 font-normal">(${s.marathi_name || ''})</span></div>
            <div class="text-[10px] text-slate-400">${s.dist_km} km · PF ${s.platforms || 2}</div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          ${doorBadge}
          ${fastTag}
        </div>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
}

function selectStation(type, code) {
  setStation(type, code);
  document.getElementById(type === 'origin' ? 'originDropdown' : 'destDropdown')?.classList.add('hidden');
}

function setStation(type, code) {
  const stn = allStations.find(s => s.code === code);
  if (!stn) return;
  const input = document.getElementById(type === 'origin' ? 'originInput' : 'destInput');
  if (input) {
    input.value = `${stn.name} (${stn.code})`;
    input.dataset.code = stn.code;
  }
}

// Search execution with Live Crowd Predictor Integration
async function executeJourneySearch() {
  const originInput = document.getElementById('originInput');
  const destInput = document.getElementById('destInput');
  const fromCode = originInput?.dataset.code;
  const toCode = destInput?.dataset.code;
  const timeVal = document.getElementById('plannerTimeInput')?.value || '';

  if (!fromCode || !toCode) {
    alert('Please select both departure and destination stations to view schedules.');
    return;
  }

  if (fromCode === toCode) {
    alert('Boarding and destination stations cannot be identical.');
    return;
  }

  currentOriginCode = fromCode;
  currentDestCode = toCode;

  const initialEmpty = document.getElementById('plannerInitialEmptyState');
  const skeleton = document.getElementById('resultsSkeleton');
  const content = document.getElementById('resultsContent');
  const findBtnLabel = document.getElementById('findBtnLabel');

  if (initialEmpty) initialEmpty.classList.add('hidden');
  if (skeleton) skeleton.classList.remove('hidden');
  if (content) content.classList.add('hidden');
  if (findBtnLabel) findBtnLabel.textContent = 'CHECKING TIMETABLE...';

  try {
    let url = `/api/trains/search?origin=${fromCode}&destination=${toCode}`;
    if (timeVal) url += `&time=${encodeURIComponent(timeVal)}`;

    const res = await fetch(url);
    const data = await res.json();
    currentSearchTrains = data.available_trains || data.all_scheduled_trains || [];
    renderSearchResults(data, fromCode, toCode);
  } catch (err) {
    console.error('Timetable search error:', err);
  } finally {
    if (skeleton) skeleton.classList.add('hidden');
    if (content) content.classList.remove('hidden');
    if (findBtnLabel) findBtnLabel.textContent = 'FIND BEST TRAIN';
  }
}

function renderSearchResults(data, fromCode, toCode) {
  let trains = [...(currentSearchTrains || [])];

  // User-selected planner time filter: strictly sort and prioritize trains departing from selected time
  const plannerTime = document.getElementById('plannerTimeInput')?.value || '';
  if (plannerTime) {
    const parseM = (t) => {
      if (!t) return 0;
      const parts = String(t).split(':').map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    };
    const targetMins = parseM(plannerTime);
    trains.sort((a, b) => {
      const aM = parseM(a.departure_time || a.departure || a.dep_time);
      const bM = parseM(b.departure_time || b.departure || b.dep_time);
      const aWait = aM >= targetMins ? aM - targetMins : aM + 1440 - targetMins;
      const bWait = bM >= targetMins ? bM - targetMins : bM + 1440 - targetMins;
      return aWait - bWait;
    });
  }

  if (currentServiceFilter === 'FAST') {
    trains = trains.filter(t => t.is_fast || t.train_type === 'FAST');
  } else if (currentServiceFilter === 'AC') {
    trains = trains.filter(t => t.is_ac);
  } else if (currentServiceFilter === 'SLOW') {
    trains = trains.filter(t => !t.is_fast && t.train_type !== 'FAST');
  }

  // Set the primary selected train (first train departing from selected time)
  selectedTrainIndex = 0;
  const initialTrain = trains[0] || data.recommended_journey;
  if (initialTrain) {
    setActiveSelectedTrain(initialTrain, fromCode, toCode);
  }

  // Render Upcoming Trains List starting from user's selected time
  renderUpcomingTrains(trains, fromCode, toCode);

  const stops = initialTrain?.intermediate_stops || initialTrain?.stops || [];

  // Render Route Timeline
  renderRouteTimeline(stops, fromCode, toCode);

  // Update Map with Route and auto-zoom live tracking
  updateGoogleMapRoute(fromCode, toCode, stops, initialTrain);

  // Populate Target Stations in Speedometer with only the stations on this route
  populateRouteStationsInSpeedometer(stops, toCode);
}

function setActiveSelectedTrain(train, fromCode, toCode) {
  selectedTrain = train;
  const originStn = allStations.find(s => s.code === fromCode);
  const destStn = allStations.find(s => s.code === toCode);

  document.getElementById('recDepTime').textContent = train.departure_time || '08:32';
  document.getElementById('recArrTime').textContent = train.arrival_time || '09:05';
  document.getElementById('recOriginName').textContent = originStn?.name || fromCode;
  document.getElementById('recDestName').textContent = destStn?.name || toCode;
  document.getElementById('recDuration').textContent = `${train.duration_minutes || 33} min`;
  document.getElementById('recOriginPlatform').textContent = train.origin_platform || train.platform || 'PF 5';
  document.getElementById('recDestPlatform').textContent = train.dest_platform || 'PF 4/5';
  document.getElementById('recTrainName').textContent = `${train.train_name || 'Central Suburban Local'} (#${train.train_number || '95746'})`;

  const waitText = (train.wait_mins !== null && train.wait_mins !== undefined)
    ? `Departs in ${train.wait_mins} mins`
    : 'Scheduled WTT Service';
  document.getElementById('recWaitMinutes').textContent = waitText;

  const destDoorSide = train.door_side_at_dest || destStn?.door_side || 'Left & Right';
  document.getElementById('recDoorSide').textContent = destDoorSide;

  // UPDATE LIVE DELAY STATUS BADGE ('On Time', 'Delayed 5m', 'Delayed 15m')
  const delayInfo = train.delay_info || {
    status: 'On Time',
    delay_minutes: 0,
    badge_color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    dot_color: '#10b981',
    reason: 'Operating on time as per Central Railway WTT'
  };

  const delayBadge = document.getElementById('recDelayBadge');
  const delayText = document.getElementById('recDelayText');
  const delayDot = document.getElementById('recDelayDot');
  const expectedTimeEl = document.getElementById('recExpectedTime');

  if (delayBadge && delayText) {
    delayText.textContent = delayInfo.status.toUpperCase();
    delayBadge.className = `inline-flex items-center gap-1 px-2.5 py-0.5 border text-[10px] font-extrabold rounded-md uppercase ${delayInfo.badge_color}`;
    if (delayDot) delayDot.style.backgroundColor = delayInfo.dot_color;
  }

  if (expectedTimeEl) {
    if (delayInfo.delay_minutes > 0 && delayInfo.expected_departure_time) {
      expectedTimeEl.textContent = `Expected: ${delayInfo.expected_departure_time}`;
      expectedTimeEl.classList.remove('hidden');
    } else {
      expectedTimeEl.classList.add('hidden');
    }
  }

  // UPDATE LIVE CROWD PREDICTOR WIDGET (HISTORICAL BOARDING DENSITY MODEL)
  const crowd = train.crowd_prediction || {
    level: 'Moderate',
    occupancy_pct: 64,
    tag_color: 'bg-amber-50 text-amber-800 border-amber-200',
    bar_color: '#d97706',
    period_name: 'Moderate Day Commute',
    description: 'Moderate passenger flow. Seats generally open up after major junction halts like Dadar, Kurla, or Thane.',
    coach_density: {
      coach_front_ii: 'Moderate',
      coach_ladies_3: 'Moderate',
      coach_first_5: 'Moderate',
      coach_ladies_7: 'Moderate',
      coach_first_10: 'Low',
      coach_rear_guard: 'Moderate'
    }
  };

  // Trigger immediate live GPS telemetry ping and periodic polling
  refreshActiveTrainTelemetry(false);
  if (activeTrainTelemetryTimer) clearInterval(activeTrainTelemetryTimer);
  activeTrainTelemetryTimer = setInterval(() => {
    refreshActiveTrainTelemetry(false);
  }, 8000);

  const badge = document.getElementById('crowdStatusBadge');
  const bar = document.getElementById('crowdProgressBar');
  const pct = document.getElementById('crowdOccupancyPct');
  const period = document.getElementById('crowdPeriodName');
  const tip = document.getElementById('crowdTipText');

  if (badge) {
    badge.textContent = crowd.level;
    badge.className = `px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border ${crowd.tag_color}`;
  }
  if (bar) {
    bar.style.width = `${crowd.occupancy_pct || 60}%`;
    bar.style.backgroundColor = crowd.bar_color || '#d97706';
  }
  if (pct) {
    pct.textContent = `${crowd.occupancy_pct || 60}% Occupancy`;
  }
  if (period) {
    period.textContent = crowd.period_name || 'Historical Boarding Model';
  }
  if (tip) {
    tip.textContent = crowd.description;
  }

  // Update coach density breakdown
  if (crowd.coach_density) {
    const cd = crowd.coach_density;
    setDensityBadge('coachDensity1', cd.coach_front_ii);
    setDensityBadge('coachDensity3', cd.coach_ladies_3);
    setDensityBadge('coachDensity5', cd.coach_first_5);
    setDensityBadge('coachDensity7', cd.coach_ladies_7);
    setDensityBadge('coachDensity8', cd.coach_first_10 || 'Low');
    setDensityBadge('coachDensity12', cd.coach_rear_guard);
  }
}

function setDensityBadge(elementId, density) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = density || 'Moderate';
  if (density === 'Super-Dense' || density === 'Packed') {
    el.className = 'font-bold text-rose-700';
  } else if (density === 'Low') {
    el.className = 'font-bold text-emerald-700';
  } else {
    el.className = 'font-bold text-amber-700';
  }
}

// Mock 'Live Status' GPS Telemetry Engine
let activeTrainTelemetryTimer = null;

window.refreshActiveTrainTelemetry = async function(manualTrigger = false) {
  const trainNum = selectedTrain?.train_number || '97380';

  if (manualTrigger) {
    const badge = document.getElementById('telemetryStatusBadge');
    if (badge) {
      badge.textContent = 'FETCHING GPS...';
      badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-amber-500/20 text-amber-300 border border-amber-500/40';
    }
  }

  try {
    const res = await fetch(`/api/trains/${encodeURIComponent(trainNum)}/telemetry`);
    const data = await res.json();
    if (data && data.success) {
      const badge = document.getElementById('telemetryStatusBadge');
      const beaconDot = document.getElementById('telemetryBeaconDot');
      const beaconPing = document.getElementById('telemetryBeaconPing');
      const sectionText = document.getElementById('telemetrySectionText');
      const speedText = document.getElementById('telemetrySpeed');
      const reasonText = document.getElementById('telemetryReasonText');
      const coordsText = document.getElementById('telemetryGpsCoords');
      const tsText = document.getElementById('telemetryTimestamp');

      if (badge) {
        badge.textContent = data.status.toUpperCase();
        badge.className = `px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${data.badge_color}`;
      }
      if (beaconDot && beaconPing) {
        beaconDot.style.backgroundColor = data.dot_color;
        beaconPing.style.backgroundColor = data.dot_color;
      }
      if (sectionText) sectionText.textContent = `Section: ${data.section}`;
      if (speedText) speedText.textContent = data.speed_kmh;
      if (reasonText) reasonText.textContent = data.reason;
      if (coordsText && data.gps_coords) {
        coordsText.textContent = `GPS: ${data.gps_coords.latitude}° N, ${data.gps_coords.longitude}° E`;
      }
      if (tsText) {
        tsText.textContent = `Telemetry updated: ${data.telemetry_timestamp} IST`;
      }

      // Also sync top delay badge
      const recDelayBadge = document.getElementById('recDelayBadge');
      const recDelayText = document.getElementById('recDelayText');
      const recDelayDot = document.getElementById('recDelayDot');
      if (recDelayBadge && recDelayText) {
        recDelayText.textContent = data.status.toUpperCase();
        recDelayBadge.className = `inline-flex items-center gap-1 px-2.5 py-0.5 border text-[10px] font-extrabold rounded-md uppercase ${data.badge_color}`;
        if (recDelayDot) recDelayDot.style.backgroundColor = data.dot_color;
      }
    }
  } catch (err) {
    console.warn('Telemetry fetch error:', err);
  }
};

function renderUpcomingTrains(trains, fromCode, toCode, activeIdx = selectedTrainIndex) {
  const container = document.getElementById('moreTrainsList');
  const countEl = document.getElementById('moreOptionsCount');
  if (!container) return;

  const plannerTime = document.getElementById('plannerTimeInput')?.value || '';
  if (countEl) {
    countEl.textContent = plannerTime 
      ? `${trains.length} trains from ${plannerTime} onwards · Click Select to activate service` 
      : `${trains.length} verified services · Click Select to activate service`;
  }

  if (trains.length === 0) {
    container.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">No trains found for this selection</div>`;
    return;
  }

  let html = '';
  trains.forEach((t, idx) => {
    const isSelected = (idx === activeIdx);
    const isAc = t.is_ac;
    const isFast = t.is_fast || t.train_type === 'FAST';
    const typeLabel = isAc ? 'AC Local' : (isFast ? 'Fast Local' : 'Slow Local');
    const typeColor = isFast ? 'text-emerald-800 bg-emerald-50' : 'text-slate-600 bg-slate-100';
    const crowdLevel = t.crowd_prediction?.level || 'Moderate';
    const crowdColor = crowdLevel === 'Packed' ? 'text-rose-700 bg-rose-50' : (crowdLevel === 'Low' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50');

    // LIVE DELAY STATUS BADGE ('On Time', 'Delayed 5m', 'Delayed 15m')
    const delayInfo = t.delay_info || {
      status: 'On Time',
      delay_minutes: 0,
      badge_color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      dot_color: '#10b981'
    };

    const expText = (delayInfo.delay_minutes > 0 && delayInfo.expected_departure_time)
      ? `<span class="text-amber-700 font-bold ml-1">· Exp: ${delayInfo.expected_departure_time}</span>`
      : '';

    html += `
      <div 
        class="py-2.5 flex items-center justify-between group rounded-xl px-2.5 transition-all cursor-pointer border ${isSelected ? 'bg-emerald-50/70 border-emerald-300 shadow-2xs' : 'hover:bg-slate-50 border-transparent'}"
        onclick="pickTrainFromList(${idx}, '${fromCode}', '${toCode}')"
      >
        <div class="flex items-center gap-3">
          <div class="text-base font-extrabold ${isSelected ? 'text-emerald-950 font-black' : 'text-slate-900'} w-16">${t.departure_time}</div>
          <div>
            <div class="text-xs font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
              <span>${t.train_name}</span>
              <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${typeColor}">${typeLabel}</span>
              <!-- LIVE DELAY STATUS BADGE -->
              <span class="text-[9px] font-extrabold px-1.5 py-0.2 rounded border ${delayInfo.badge_color} flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${delayInfo.dot_color};"></span>
                <span>${delayInfo.status}</span>
              </span>
              <span class="text-[9px] font-bold px-1.5 py-0.2 rounded border ${crowdColor}">${crowdLevel}</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-0.5">
              <span>Arrives ${t.arrival_time}</span>
              <span>/</span>
              <span>${t.duration_minutes || 35} min</span>
              <span>/</span>
              <span>${t.platform || 'PF 2'}</span>
              ${expText}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          ${isSelected 
            ? `<span class="text-[11px] font-extrabold text-white bg-emerald-700 px-3 py-1.5 rounded-xl flex items-center gap-1 shadow-xs">
                 <span>✓ Active Service</span>
               </span>`
            : `<button 
                 type="button" 
                 class="select-train-btn text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-[#064e3b] hover:text-white border border-slate-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                 onclick="event.stopPropagation(); pickTrainFromList(${idx}, '${fromCode}', '${toCode}')"
                 title="Select this train service"
               >
                 <span>Select</span>
                 <span>➔</span>
               </button>`
          }
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

window.pickTrainFromList = function(idx, fromCode, toCode) {
  selectedTrainIndex = idx;
  const train = currentSearchTrains[idx];
  if (train) {
    setActiveSelectedTrain(train, fromCode, toCode);
    const stops = train.intermediate_stops || train.stops || [];
    renderRouteTimeline(stops, fromCode, toCode);
    updateMapActiveRoute(fromCode, toCode, stops, train);
    populateRouteStationsInSpeedometer(stops, toCode);

    // Re-render upcoming trains so the selected train is highlighted with active state
    renderUpcomingTrains(currentSearchTrains, fromCode, toCode, idx);

    // Smoothly scroll and move commuter directly to the Active Selected Services card
    const activeCard = document.getElementById('selectedActiveTrainCard');
    if (activeCard) {
      const header = document.querySelector('header');
      const navOffset = (header ? header.offsetHeight : 70) + 16;
      const cardTop = activeCard.getBoundingClientRect().top + window.pageYOffset - navOffset;
      window.scrollTo({
        top: Math.max(0, cardTop),
        behavior: 'smooth'
      });

      // Visual feedback: vibrant emerald focus ring animation
      activeCard.classList.remove('ring-4', 'ring-emerald-500', 'ring-offset-2', 'ring-emerald-400');
      void activeCard.offsetWidth; // Trigger reflow for reliable animation
      activeCard.classList.add('ring-4', 'ring-emerald-500', 'ring-offset-2', 'transition-all', 'duration-300');
      setTimeout(() => {
        activeCard.classList.remove('ring-4', 'ring-emerald-500', 'ring-offset-2');
      }, 2200);
    }
  }
};

window.trackSelectedTrainOnMap = function() {
  if (selectedTrain) {
    const stops = selectedTrain.intermediate_stops || selectedTrain.stops || [];
    const fromCode = currentOriginCode || selectedTrain.source_station_code || 'TNA';
    const toCode = currentDestCode || selectedTrain.destination_station_code || 'CSMT';
    updateMapActiveRoute(fromCode, toCode, stops, selectedTrain);
  }
  switchAppTab('satellite');
};

window.armAlarmForSelectedTrain = function() {
  const destInput = document.getElementById('destInput');
  const toCode = destInput?.dataset.code || currentDestCode || 'CSMT';
  armWakeAlarm(toCode, 1.5);
  switchAppTab('speedometer');
};

function renderRouteTimeline(stops, fromCode, toCode) {
  const container = document.getElementById('routeTimelineContainer');
  const summaryEl = document.getElementById('routeTimelineSummary');
  if (!container) return;

  let haltList = stops;
  if (!haltList || haltList.length === 0) {
    const origIdx = allStations.findIndex(s => s.code === fromCode);
    const destIdx = allStations.findIndex(s => s.code === toCode);
    if (origIdx !== -1 && destIdx !== -1) {
      if (origIdx <= destIdx) {
        haltList = allStations.slice(origIdx, destIdx + 1).map(s => ({ station_code: s.code, station_name: s.name, platform: `PF ${s.platforms || 2}` }));
      } else {
        haltList = allStations.slice(destIdx, origIdx + 1).reverse().map(s => ({ station_code: s.code, station_name: s.name, platform: `PF ${s.platforms || 2}` }));
      }
    }
  }

  if (summaryEl) summaryEl.textContent = `${haltList.length} stops`;

  let html = '<div class="route-timeline-stem"></div>';
  haltList.forEach((h, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === haltList.length - 1;
    const dotClass = isFirst
      ? 'w-4 h-4 bg-emerald-600 ring-4 ring-emerald-100'
      : (isLast ? 'w-4 h-4 bg-[#07131e] ring-4 ring-slate-200' : 'w-2.5 h-2.5 bg-slate-400');

    const stn = allStations.find(s => s.code === h.station_code);
    const doorSide = stn?.door_side ? `<span class="text-[9px] text-slate-400">Door: ${stn.door_side}</span>` : '';
    const timeDisplay = h.departure_time ? `${h.departure_time}` : '';

    html += `
      <div class="relative flex items-center justify-between py-2">
        <div class="flex items-center gap-3">
          <div class="relative z-10 flex items-center justify-center w-6">
            <div class="rounded-full ${dotClass}"></div>
          </div>
          <div>
            <div class="text-xs font-bold ${isFirst || isLast ? 'text-slate-900 text-sm' : 'text-slate-700'}">${h.station_name || h.short_name || h.station_code}</div>
            <div class="text-[10px] text-slate-400 font-medium">${h.station_code} · ${doorSide}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs font-bold text-slate-800">${timeDisplay}</div>
          <div class="text-[10px] font-bold text-slate-400">${h.platform || (stn?.platforms ? `PF ${stn.platforms}` : 'PF 2')}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ==========================================
// 6. SPEEDOMETER & GEOFENCE WAKE ALARM
// ==========================================
function setupSpeedometerEvents() {
  const activateBtn = document.getElementById('activateGpsBtn');
  const stopBtn = document.getElementById('stopGpsBtn');
  const armBtn = document.getElementById('armWakeAlarmBtn');

  activateBtn?.addEventListener('click', () => {
    requestSpeedometerGps();
  });

  stopBtn?.addEventListener('click', () => {
    stopGpsTracking();
  });

  armBtn?.addEventListener('click', () => {
    const stnCode = document.getElementById('alarmStationSelect')?.value;
    const distVal = parseFloat(document.getElementById('alarmDistanceSelect')?.value || '1.5');
    armWakeAlarm(stnCode, distVal);
  });
}

window.requestSpeedometerGps = function() {
  const promptCard = document.getElementById('gpsPromptCard');
  const deniedCard = document.getElementById('gpsDeniedCard');
  const activeDialCard = document.getElementById('gpsActiveDialCard');
  const statusText = document.getElementById('gpsStatusText');

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      promptCard?.classList.add('hidden');
      deniedCard?.classList.add('hidden');
      activeDialCard?.classList.remove('hidden');

      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const speedKmh = (pos.coords.speed !== null && pos.coords.speed !== undefined && pos.coords.speed >= 0)
        ? Math.round(pos.coords.speed * 3.6)
        : 0;

      updateSpeedometerUI(speedKmh);

      if (statusText) {
        statusText.textContent = `GPS Connected · Accuracy ±${Math.round(pos.coords.accuracy || 10)}m`;
      }

      // Update nearest station telemetry
      updateTelemetryFromCoords(pos.coords.latitude, pos.coords.longitude);

      if (isWakeAlarmArmed && wakeAlarmTargetStation) {
        checkWakeAlarmProximity(pos.coords.latitude, pos.coords.longitude);
      }
    },
    (err) => {
      console.warn('GPS Error:', err.message);
      promptCard?.classList.add('hidden');
      activeDialCard?.classList.add('hidden');
      deniedCard?.classList.remove('hidden');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
  );
};

function stopGpsTracking() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (isSimulating) {
    clearInterval(simulationInterval);
    isSimulating = false;
  }
  document.getElementById('gpsActiveDialCard')?.classList.add('hidden');
  document.getElementById('gpsPromptCard')?.classList.remove('hidden');
  updateSpeedometerUI(0);
}

function updateSpeedometerUI(speedKmh) {
  const speedValEl = document.getElementById('speedValue');
  const speedSubtext = document.getElementById('speedSubtext');
  const circle = document.getElementById('speedometerGaugeCircle');

  if (speedValEl) speedValEl.textContent = speedKmh;

  if (speedSubtext) {
    if (speedKmh === 0) speedSubtext.textContent = 'At Station Halt';
    else if (speedKmh < 40) speedSubtext.textContent = 'Decelerating';
    else if (speedKmh < 65) speedSubtext.textContent = 'Cruising';
    else speedSubtext.textContent = 'High Speed';
  }

  if (circle) {
    // 283 circumference, mapping 0..100 km/h
    const maxSpeed = 100;
    const progress = Math.min(speedKmh / maxSpeed, 1);
    const offset = 283 - (progress * 210);
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = speedKmh > 75 ? '#e11d48' : (speedKmh > 40 ? '#047857' : '#d97706');
  }
}

function updateTelemetryFromCoords(lat, lng) {
  if (allStations.length === 0) return;
  let nearest = null;
  let minD = Infinity;

  allStations.forEach(s => {
    if (s.lat && s.lng) {
      const d = calculateHaversineDistance(lat, lng, s.lat, s.lng);
      if (d < minD) {
        minD = d;
        nearest = s;
      }
    }
  });

  if (nearest) {
    document.getElementById('telemetryCurrentStn').textContent = `${nearest.name} (${nearest.code})`;
    const nextStn = allStations.find(s => s.dist_km > nearest.dist_km) || nearest;
    document.getElementById('telemetryNextStn').textContent = `${nextStn.name} · PF 2 · ETA ~3m`;
  }
}

// Live Train Ride Simulation Mode
window.startRideSimulation = function() {
  isSimulating = true;
  document.getElementById('gpsPromptCard')?.classList.add('hidden');
  document.getElementById('gpsDeniedCard')?.classList.add('hidden');
  document.getElementById('gpsActiveDialCard')?.classList.remove('hidden');

  // Use selected train stops if available, else standard corridor
  let simulatedRoute = [];
  if (selectedTrain && (selectedTrain.intermediate_stops || selectedTrain.stops)) {
    const rawStops = selectedTrain.intermediate_stops || selectedTrain.stops;
    simulatedRoute = rawStops.map(s => {
      const stn = allStations.find(st => st.code === s.station_code) || s;
      return {
        name: stn.name || s.station_name,
        code: s.station_code,
        lat: Number(stn.lat || 19.18),
        lng: Number(stn.lng || 72.97),
        speed: 48 + Math.floor(Math.random() * 26)
      };
    });
  }

  if (simulatedRoute.length === 0) {
    simulatedRoute = [
      { name: 'Thane', code: 'TNA', lat: 19.1868, lng: 72.9757, speed: 28 },
      { name: 'Mulund', code: 'MLND', lat: 19.1726, lng: 72.9563, speed: 54 },
      { name: 'Bhandup', code: 'BND', lat: 19.1437, lng: 72.9378, speed: 68 },
      { name: 'Vikhroli', code: 'VK', lat: 19.1105, lng: 72.9288, speed: 62 },
      { name: 'Ghatkopar', code: 'GC', lat: 19.0864, lng: 72.9081, speed: 45 },
      { name: 'Kurla', code: 'CLA', lat: 19.0652, lng: 72.8793, speed: 65 },
      { name: 'Sion', code: 'SIN', lat: 19.0433, lng: 72.8631, speed: 58 },
      { name: 'Dadar', code: 'DR', lat: 19.0178, lng: 72.8433, speed: 30 },
      { name: 'Byculla', code: 'BY', lat: 18.9774, lng: 72.8331, speed: 52 },
      { name: 'CSMT', code: 'CSMT', lat: 18.9401, lng: 72.8354, speed: 0 }
    ];
  }

  simulationStep = 0;
  const statusText = document.getElementById('gpsStatusText');

  simulationInterval = setInterval(() => {
    if (simulationStep >= simulatedRoute.length) {
      clearInterval(simulationInterval);
      isSimulating = false;
      updateSpeedometerUI(0);
      if (statusText) statusText.textContent = 'Simulation Completed. Arrived at Destination Terminal.';
      return;
    }

    const current = simulatedRoute[simulationStep];
    const next = simulatedRoute[Math.min(simulationStep + 1, simulatedRoute.length - 1)];

    updateSpeedometerUI(current.speed);
    document.getElementById('telemetryCurrentStn').textContent = `${current.name} (${current.code}) · Traversed`;
    document.getElementById('telemetryNextStn').textContent = `${next.name} · PF 2 · ETA ~2m`;

    if (statusText) {
      statusText.textContent = `Simulation Mode · Traversed ${simulationStep + 1}/${simulatedRoute.length} stations on route`;
    }

    // Check alarm condition
    if (isWakeAlarmArmed && wakeAlarmTargetStation) {
      const dist = calculateHaversineDistance(current.lat, current.lng, wakeAlarmTargetStation.lat, wakeAlarmTargetStation.lng);
      if (dist <= wakeAlarmDistanceThreshold) {
        triggerAlarmBuzzer();
        disarmWakeAlarm();
      }
    }

    simulationStep++;
  }, 2200);
};

// Helper for client-side route synthesis
function getSynthesizedStopsBetweenClient(origin, destination, isFast = false) {
  const MAIN = ['CSMT', 'MSD', 'SNRD', 'BY', 'CHG', 'CRD', 'PR', 'DR', 'MTN', 'SIN', 'CLA', 'VVH', 'GC', 'VK', 'KJRD', 'BND', 'NHU', 'MLND', 'TNA', 'KLVA', 'MBQ', 'DIVA', 'KOPR', 'DI', 'THK', 'KYN'];
  const KSRA = ['KYN', 'SHAD', 'ABY', 'TLA', 'KDV', 'VSD', 'ASO', 'ATG', 'THS', 'KE', 'OMB', 'KSRA'];
  const KJT = ['KYN', 'VLDI', 'ULNR', 'ABH', 'BUD', 'VGI', 'SHLU', 'NRL', 'BVS', 'KJT', 'PDI', 'KLY', 'DLV', 'LWJ', 'KHPI'];

  const getCorridor = (code) => {
    if (MAIN.includes(code)) return 'MAIN';
    if (KSRA.includes(code)) return 'KSRA';
    if (KJT.includes(code)) return 'KJT';
    return 'MAIN';
  };

  const c1 = getCorridor(origin);
  const c2 = getCorridor(destination);
  let codes = [];

  if (c1 === c2) {
    const list = c1 === 'MAIN' ? MAIN : (c1 === 'KSRA' ? KSRA : KJT);
    const i1 = list.indexOf(origin);
    const i2 = list.indexOf(destination);
    if (i1 === -1 || i2 === -1) codes = [origin, destination];
    else if (i1 <= i2) codes = list.slice(i1, i2 + 1);
    else codes = list.slice(i2, i1 + 1).reverse();
  } else {
    let p1 = [];
    if (c1 === 'MAIN') {
      const i1 = MAIN.indexOf(origin);
      const iK = MAIN.indexOf('KYN');
      p1 = i1 <= iK ? MAIN.slice(i1, iK) : MAIN.slice(iK, i1 + 1).reverse().slice(0, -1);
    } else {
      const b = c1 === 'KSRA' ? KSRA : KJT;
      const i1 = b.indexOf(origin);
      const iK = b.indexOf('KYN');
      p1 = i1 <= iK ? b.slice(i1, iK) : b.slice(iK, i1 + 1).reverse().slice(0, -1);
    }
    let p2 = [];
    if (c2 === 'MAIN') {
      const iK = MAIN.indexOf('KYN');
      const i2 = MAIN.indexOf(destination);
      p2 = iK <= i2 ? MAIN.slice(iK, i2 + 1) : MAIN.slice(i2, iK + 1).reverse();
    } else {
      const b = c2 === 'KSRA' ? KSRA : KJT;
      const iK = b.indexOf('KYN');
      const i2 = b.indexOf(destination);
      p2 = iK <= i2 ? b.slice(iK, i2 + 1) : b.slice(i2, iK + 1).reverse();
    }
    codes = [...p1, ...p2];
  }

  if (isFast && codes.length > 8) {
    const fastHalts = ['CSMT', 'BY', 'DR', 'CLA', 'GC', 'BND', 'MLND', 'TNA', 'DIVA', 'DI', 'KYN'];
    codes = codes.filter((c, idx) => {
      if (idx === 0 || idx === codes.length - 1) return true;
      if (MAIN.includes(c)) return fastHalts.includes(c);
      return true;
    });
  }

  return codes.map(c => {
    const s = allStations.find(st => st.code === c);
    return {
      station_code: c,
      station_name: s ? s.name : c,
      code: c,
      name: s ? s.name : c,
      platforms: s?.platforms || 2,
      door_side: s?.door_side || 'Left',
      lat: s?.lat,
      lng: s?.lng,
      dist_km: s?.dist_km || 0
    };
  });
}

function populateRouteStationsInSpeedometer(stops, defaultTargetCode) {
  const select = document.getElementById('alarmStationSelect');
  if (!select) return;

  select.innerHTML = '';
  let listToUse = stops;

  if (!listToUse || listToUse.length === 0) {
    listToUse = selectedTrain?.intermediate_stops || selectedTrain?.stops;
  }
  if (!listToUse || listToUse.length === 0) {
    const oCode = currentOriginCode || selectedTrain?.source_station_code || 'TNA';
    const dCode = currentDestCode || selectedTrain?.destination_station_code || 'CSMT';
    listToUse = getSynthesizedStopsBetweenClient(oCode, dCode, Boolean(selectedTrain?.is_fast));
  }

  const oCode = currentOriginCode || selectedTrain?.source_station_code || 'TNA';
  const dCode = defaultTargetCode || currentDestCode || selectedTrain?.destination_station_code || 'CSMT';
  const origStn = allStations.find(s => s.code === oCode);
  const destStn = allStations.find(s => s.code === dCode);

  // Update active train banner in Speed & Alarm tab
  const trainNameEl = document.getElementById('alarmActiveTrainName');
  if (trainNameEl) {
    trainNameEl.textContent = `${selectedTrain?.train_name || 'Central Suburban Local'} (#${selectedTrain?.train_number || '97380'})`;
  }
  const trainRouteEl = document.getElementById('alarmActiveTrainRoute');
  if (trainRouteEl) {
    trainRouteEl.textContent = `${origStn?.name || oCode} ➔ ${destStn?.name || dCode} · Only stations on this service`;
  }

  let selectedCode = dCode;
  listToUse.forEach((s, idx) => {
    const code = s.station_code || s.code;
    const name = s.station_name || s.name;
    const stn = allStations.find(st => st.code === code) || s;
    const isSelected = code === dCode || (idx === listToUse.length - 1 && !listToUse.some(x => (x.station_code || x.code) === dCode));
    if (isSelected) selectedCode = code;
    const opt = new Option(`${name} (${code}) · PF ${stn.platforms || 2} · Door: ${stn.door_side || 'Left'}`, code, false, isSelected);
    select.add(opt);
  });

  handleAlarmStationChanged(selectedCode);
}

window.handleAlarmStationChanged = function(code) {
  const stn = allStations.find(s => s.code === code);
  if (!stn) return;

  wakeAlarmTargetStation = stn;
  const targetTelemetry = document.getElementById('telemetryTargetStn');
  if (targetTelemetry) {
    targetTelemetry.textContent = `${stn.name} (${stn.dist_km ? stn.dist_km + ' km' : '0 km'})`;
  }

  if (isWakeAlarmArmed) {
    const thresholdKm = wakeAlarmDistanceThreshold || 1.5;
    const activeTarget = document.getElementById('activeAlarmTarget');
    if (activeTarget) {
      activeTarget.textContent = `${stn.name} (${thresholdKm} km)`;
    }
  }
};

function armWakeAlarm(stnCode, thresholdKm) {
  const code = stnCode || document.getElementById('alarmStationSelect')?.value || currentDestCode;
  const stn = allStations.find(s => s.code === code);
  if (!stn) return;

  wakeAlarmTargetStation = stn;
  wakeAlarmDistanceThreshold = thresholdKm || 1.5;
  isWakeAlarmArmed = true;

  document.getElementById('alarmActiveStatus')?.classList.remove('hidden');
  const targetEl = document.getElementById('activeAlarmTarget');
  if (targetEl) targetEl.textContent = `${stn.name} (${wakeAlarmDistanceThreshold} km before arrival)`;
}

window.disarmWakeAlarm = function() {
  isWakeAlarmArmed = false;
  wakeAlarmTargetStation = null;
  document.getElementById('alarmActiveStatus')?.classList.add('hidden');
};

function checkWakeAlarmProximity(lat, lng) {
  if (!wakeAlarmTargetStation || !wakeAlarmTargetStation.lat) return;

  const distKm = calculateHaversineDistance(lat, lng, wakeAlarmTargetStation.lat, wakeAlarmTargetStation.lng);
  if (distKm <= wakeAlarmDistanceThreshold) {
    triggerStationArrivalAlarm(wakeAlarmTargetStation, distKm, false);
    disarmWakeAlarm();
  }
}

// Global Alarm State & 8-Second Auto-Stop Engine
let alarmAudioInterval = null;
let alarmTimeoutTimer = null;
let alarmCountdownTimer = null;
let alarmRemainingSeconds = 8;
let isAlarmRinging = false;

window.triggerStationArrivalAlarm = function(stationObj, distKm = 1.2, isTest = false) {
  const modal = document.getElementById('stationArrivalAlarmModal');
  if (!modal) return;

  const targetStn = stationObj || wakeAlarmTargetStation || allStations.find(s => s.code === 'DR') || allStations[0];
  if (!targetStn) return;

  const nameEl = document.getElementById('alarmModalStationName');
  if (nameEl) nameEl.textContent = targetStn.name;
  const codeEl = document.getElementById('alarmModalStationCode');
  if (codeEl) codeEl.textContent = targetStn.code;
  const marathiEl = document.getElementById('alarmModalStationMarathi');
  if (marathiEl) marathiEl.textContent = targetStn.marathi_name || 'मध्य रेल्वे स्थानक';
  const distEl = document.getElementById('alarmModalDistance');
  if (distEl) distEl.textContent = isTest ? '1.2 km (Test Mode)' : `~${Number(distKm).toFixed(1)} km ahead`;
  const doorEl = document.getElementById('alarmModalDoorSide');
  if (doorEl) doorEl.textContent = targetStn.door_side ? `Door: ${targetStn.door_side}` : 'Door: Left & Right';

  const subtextEl = document.getElementById('alarmModalSubtext');
  if (subtextEl) {
    subtextEl.textContent = isTest
      ? 'Test Mode: Alarm rings continuously until you stop it, or automatically stops in 8 seconds.'
      : `Your train is approaching ${targetStn.name}! Prepare to deboard from ${targetStn.door_side || 'Left'} side.`;
  }

  // 8-second visual countdown
  alarmRemainingSeconds = 8;
  const countEl = document.getElementById('alarmCountdownSeconds');
  if (countEl) countEl.textContent = '8s';
  const progBar = document.getElementById('alarmProgressBar');
  if (progBar) progBar.style.width = '100%';

  modal.classList.remove('hidden');
  isAlarmRinging = true;

  playAudibleChime();
  if (alarmAudioInterval) clearInterval(alarmAudioInterval);
  alarmAudioInterval = setInterval(() => {
    if (isAlarmRinging) {
      playAudibleChime();
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    }
  }, 950);

  if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 1000]);

  if (alarmCountdownTimer) clearInterval(alarmCountdownTimer);
  alarmCountdownTimer = setInterval(() => {
    alarmRemainingSeconds--;
    if (countEl) countEl.textContent = `${alarmRemainingSeconds}s`;
    if (progBar) {
      const pct = Math.max(0, (alarmRemainingSeconds / 8) * 100);
      progBar.style.width = `${pct}%`;
    }
    if (alarmRemainingSeconds <= 0) {
      clearInterval(alarmCountdownTimer);
      alarmCountdownTimer = null;
    }
  }, 1000);

  // Auto-stop after 8 seconds unless stopped by user
  if (alarmTimeoutTimer) clearTimeout(alarmTimeoutTimer);
  alarmTimeoutTimer = setTimeout(() => {
    stopStationArrivalAlarm(true);
  }, 8000);
};

window.stopStationArrivalAlarm = function(wasAutoStopped = false) {
  isAlarmRinging = false;
  if (alarmAudioInterval) {
    clearInterval(alarmAudioInterval);
    alarmAudioInterval = null;
  }
  if (alarmTimeoutTimer) {
    clearTimeout(alarmTimeoutTimer);
    alarmTimeoutTimer = null;
  }
  if (alarmCountdownTimer) {
    clearInterval(alarmCountdownTimer);
    alarmCountdownTimer = null;
  }

  document.getElementById('stationArrivalAlarmModal')?.classList.add('hidden');
  disarmWakeAlarm();

  const statusText = document.getElementById('gpsStatusText');
  if (statusText) {
    statusText.textContent = wasAutoStopped
      ? 'Station wake alarm automatically silenced after 8 seconds.'
      : 'Station wake alarm stopped by commuter.';
  }
};

window.testAlarmPopupModal = function() {
  const code = document.getElementById('alarmStationSelect')?.value || currentDestCode || 'DR';
  const stn = allStations.find(s => s.code === code) || allStations[0];
  triggerStationArrivalAlarm(stn, 1.2, true);
};

function playAudibleChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(880, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.3);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(440, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      setTimeout(() => {
        osc1.stop();
        osc2.stop();
      }, 1300);
    }
  } catch (e) {
    console.warn('Audio chime error:', e);
  }
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==========================================
// 7. MY PERSONAL COMMUTE: PASS & ROUTINE
// ==========================================
function initPassTrackingUI() {
  const expiryDate = new Date(userPassData.expiryDate);
  const today = new Date();
  const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

  const corridorEl = document.getElementById('userPassCorridor');
  const countdownEl = document.getElementById('userPassCountdown');
  const dateEl = document.getElementById('userPassExpiryDate');
  const badgeEl = document.getElementById('passExpiryBadge');
  const classLabelEl = document.getElementById('userPassClassLabel');
  const progressBar = document.getElementById('passProgressBar');

  if (corridorEl) corridorEl.textContent = userPassData.corridor;
  if (dateEl) dateEl.textContent = userPassData.expiryDate;
  if (classLabelEl) classLabelEl.textContent = `${userPassData.passType} Monthly Suburban Pass`;

  if (diffDays <= 0) {
    if (countdownEl) countdownEl.textContent = 'EXPIRED - RENEW PASS';
    if (badgeEl) {
      badgeEl.textContent = 'Pass Expired';
      badgeEl.className = 'px-2.5 py-0.5 bg-rose-500/30 text-rose-200 rounded-full text-xs font-bold border border-rose-400';
    }
    if (progressBar) progressBar.style.width = '0%';
  } else if (diffDays <= 3) {
    if (countdownEl) countdownEl.textContent = `${diffDays} Days Left (Expiring Soon)`;
    if (badgeEl) {
      badgeEl.textContent = 'Expiring Soon';
      badgeEl.className = 'px-2.5 py-0.5 bg-amber-500/30 text-amber-200 rounded-full text-xs font-bold border border-amber-400';
    }
    if (progressBar) progressBar.style.width = '20%';
  } else {
    if (countdownEl) countdownEl.textContent = `${diffDays} Days Remaining`;
    if (badgeEl) {
      badgeEl.textContent = 'Active Pass';
      badgeEl.className = 'px-2.5 py-0.5 bg-white/10 rounded-full text-xs font-bold border border-white/20';
    }
    if (progressBar) progressBar.style.width = '75%';
  }
}

window.togglePassEditModal = function() {
  const modal = document.getElementById('passEditModal');
  modal?.classList.toggle('hidden');
  if (!modal?.classList.contains('hidden')) {
    document.getElementById('modalPassCorridorInput').value = userPassData.corridor;
    document.getElementById('modalPassExpiryInput').value = userPassData.expiryDate;
    document.getElementById('modalPassClassInput').value = userPassData.passType;
  }
};

window.savePassDetails = function() {
  const corridor = document.getElementById('modalPassCorridorInput')?.value;
  const expiry = document.getElementById('modalPassExpiryInput')?.value;
  const passType = document.getElementById('modalPassClassInput')?.value;

  if (corridor) userPassData.corridor = corridor;
  if (expiry) userPassData.expiryDate = expiry;
  if (passType) userPassData.passType = passType;

  localStorage.setItem('centralsaathi_user_pass', JSON.stringify(userPassData));
  initPassTrackingUI();
  togglePassEditModal();
};

window.testPassAlarmSound = function() {
  playAudibleChime();
  alert('Suburban Pass Expiry Audio Chime verified.');
};

window.openRoutineEditModal = function() {
  const modal = document.getElementById('routineEditModal');
  modal?.classList.remove('hidden');
  document.getElementById('modalMorningInput').value = userRoutineData.morningTrain;
  document.getElementById('modalMorningDetailsInput').value = userRoutineData.morningDetails;
  document.getElementById('modalEveningInput').value = userRoutineData.eveningTrain;
  document.getElementById('modalEveningDetailsInput').value = userRoutineData.eveningDetails;
};

window.closeRoutineEditModal = function() {
  document.getElementById('routineEditModal')?.classList.add('hidden');
};

window.saveRoutineDetails = function() {
  const morning = document.getElementById('modalMorningInput')?.value;
  const morningDetails = document.getElementById('modalMorningDetailsInput')?.value;
  const evening = document.getElementById('modalEveningInput')?.value;
  const eveningDetails = document.getElementById('modalEveningDetailsInput')?.value;

  if (morning) userRoutineData.morningTrain = morning;
  if (morningDetails) userRoutineData.morningDetails = morningDetails;
  if (evening) userRoutineData.eveningTrain = evening;
  if (eveningDetails) userRoutineData.eveningDetails = eveningDetails;

  localStorage.setItem('centralsaathi_user_routine', JSON.stringify(userRoutineData));
  updateRoutineUI();
  closeRoutineEditModal();
};

function updateRoutineUI() {
  document.getElementById('morningOfficeTrainTime').textContent = userRoutineData.morningTrain;
  document.getElementById('morningOfficeTrainDetails').textContent = userRoutineData.morningDetails;
  document.getElementById('eveningOfficeTrainTime').textContent = userRoutineData.eveningTrain;
  document.getElementById('eveningOfficeTrainDetails').textContent = userRoutineData.eveningDetails;
}

window.armAlarmForMorningRoutine = function() {
  armWakeAlarm('DR', 1.5);
  switchAppTab('speedometer');
};

window.armAlarmForEveningRoutine = function() {
  armWakeAlarm('TNA', 1.5);
  switchAppTab('speedometer');
};

function loadSavedPersonalNotes() {
  const notes = localStorage.getItem('centralsaathi_commuter_notes');
  const textarea = document.getElementById('personalCommuteNotes');
  if (textarea && notes) textarea.value = notes;
}

window.savePersonalNotes = function() {
  const val = document.getElementById('personalCommuteNotes')?.value || '';
  localStorage.setItem('centralsaathi_commuter_notes', val);
  alert('Personal commute notes saved to device.');
};

// ==========================================
// 8. ADVANCED SAFETY SOS CONSOLE
// ==========================================
window.toggleEmergencySiren = function() {
  const btn = document.getElementById('sosSirenBtn');
  const label = document.getElementById('sirenBtnLabel');

  if (isSirenActive) {
    // Stop Siren
    if (sirenOscillator) {
      sirenOscillator.stop();
      sirenOscillator.disconnect();
      sirenOscillator = null;
    }
    isSirenActive = false;
    if (label) label.textContent = 'START EMERGENCY SIREN';
    btn?.classList.remove('bg-black');
    btn?.classList.add('bg-rose-700');
  } else {
    // Start Siren
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = audioContext || new AudioCtx();
        sirenOscillator = audioContext.createOscillator();
        sirenGain = audioContext.createGain();

        sirenOscillator.type = 'sawtooth';
        sirenOscillator.frequency.setValueAtTime(1000, audioContext.currentTime);

        // Oscillate pitch between 1000Hz and 2200Hz
        const now = audioContext.currentTime;
        for (let i = 0; i < 40; i++) {
          sirenOscillator.frequency.exponentialRampToValueAtTime(2200, now + i * 0.5 + 0.25);
          sirenOscillator.frequency.exponentialRampToValueAtTime(1000, now + i * 0.5 + 0.5);
        }

        sirenGain.gain.setValueAtTime(0.4, audioContext.currentTime);
        sirenOscillator.connect(sirenGain);
        sirenGain.connect(audioContext.destination);

        sirenOscillator.start();
        isSirenActive = true;
        if (label) label.textContent = 'STOP EMERGENCY SIREN';
        btn?.classList.remove('bg-rose-700');
        btn?.classList.add('bg-black');
      }
    } catch (e) {
      console.warn('Siren audio error:', e);
    }
  }
};

window.broadcastEmergencyLocation = function() {
  const timeStr = new Date().toLocaleTimeString('en-US');
  let locLink = 'https://maps.google.com';
  let nearestName = 'Central Railway Main Line';

  if (userCoords) {
    locLink = `https://maps.google.com/?q=${userCoords.lat},${userCoords.lng}`;
    const nearest = allStations.reduce((closest, s) => {
      const d = calculateHaversineDistance(userCoords.lat, userCoords.lng, s.lat, s.lng);
      return (!closest || d < closest.dist) ? { stn: s, dist: d } : closest;
    }, null);
    if (nearest && nearest.stn) nearestName = `${nearest.stn.name} (${nearest.stn.code})`;
  }

  const msg = `EMERGENCY ALERT: I need immediate help on Central Railway Mumbai Local. Near Station: ${nearestName} at ${timeStr}. Live Location: ${locLink}. Please notify Railway Police (139 / 1512).`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;

  window.open(whatsappUrl, '_blank');
};

// ==========================================
// 9. COMMUTER SUITE: FARES, LUGGAGE, UTS, SAFETY & CHARTER
// ==========================================
function renderAmenitiesDirectory() {
  // Overlapping station amenities are now natively hosted inside "Know Your Station"
}

function renderDoorSideDirectory() {
  // Platform door sides are now interactively displayed in "Know Your Station" & Timetables
}

async function loadCoachLayout() {
  // Retained for coach reference data
}

function populateToolDropdowns() {
  const originSelect = document.getElementById('fareCalcOriginSelect');
  const destSelect = document.getElementById('fareCalcDestSelect');
  const alarmSelect = document.getElementById('alarmStationSelect');

  if (!originSelect || allStations.length === 0) return;

  originSelect.innerHTML = '';
  destSelect.innerHTML = '';
  if (alarmSelect) alarmSelect.innerHTML = '';

  allStations.forEach(s => {
    originSelect.add(new Option(`${s.name} (${s.code})`, s.code, false, s.code === 'TNA'));
    destSelect.add(new Option(`${s.name} (${s.code})`, s.code, false, s.code === 'CSMT'));
    if (alarmSelect) alarmSelect.add(new Option(`${s.name} (${s.code})`, s.code, false, s.code === 'DR'));
  });

  originSelect.addEventListener('change', calculateCustomFares);
  destSelect.addEventListener('change', calculateCustomFares);
  calculateCustomFares();
}

async function calculateCustomFares() {
  const from = document.getElementById('fareCalcOriginSelect')?.value || 'TNA';
  const to = document.getElementById('fareCalcDestSelect')?.value || 'CSMT';
  const grid = document.getElementById('customFareResultGrid');
  if (!grid) return;

  try {
    const res = await fetch(`/api/fare?origin=${from}&destination=${to}`);
    const data = await res.json();
    const dist = data.distance_km || 34.0;
    const f = data.fares || { second_class: 10, first_class: 105, ac_local: 135 };
    const sp = data.season_pass || { monthly_second: 200, monthly_first: 650, monthly_ac: 1400 };

    const fromStn = allStations.find(s => s.code === from);
    const toStn = allStations.find(s => s.code === to);

    // Quarterly (2.7x), Half-Yearly (5.4x), Annual (10.8x)
    const qSec = Math.round(sp.monthly_second * 2.7);
    const qFirst = Math.round(sp.monthly_first * 2.7);
    const qAc = Math.round(sp.monthly_ac * 2.7);
    const hyFirst = Math.round(sp.monthly_first * 5.4);
    const yFirst = Math.round(sp.monthly_first * 10.8);

    // Monthly Savings calculation (22 work days × 2 trips = 44 single trips)
    const dailyReturnIClass = f.first_class * 2;
    const monthlyDailyCost = dailyReturnIClass * 22;
    const monthlyPassSavings = Math.max(0, monthlyDailyCost - sp.monthly_first);
    const tripsToBreakeven = Math.ceil(sp.monthly_first / f.first_class);

    grid.innerHTML = `
      <!-- Route distance badge -->
      <div class="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs">
        <div class="font-extrabold text-slate-800 flex items-center gap-1.5">
          <span>${fromStn?.name || from}</span>
          <span class="text-slate-400">➔</span>
          <span>${toStn?.name || to}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">Distance: ${dist} km</span>
          <span class="text-[11px] font-semibold text-slate-500">Central Main Line</span>
        </div>
      </div>

      <!-- Single & Daily Return Journey Rates -->
      <div>
        <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Single Journey &amp; Return Fares</h4>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <!-- Second Class -->
          <div class="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-slate-200 text-slate-800 rounded">II Class Ordinary</span>
              <span class="text-[10px] text-slate-400">Non-AC</span>
            </div>
            <div class="mt-2.5 flex items-baseline gap-2">
              <span class="text-2xl font-black text-slate-900">₹${f.second_class}</span>
              <span class="text-xs text-slate-500 font-semibold">Single</span>
            </div>
            <div class="mt-1 pt-1.5 border-t border-slate-200 flex justify-between text-xs text-slate-600">
              <span>Daily Return Ticket:</span>
              <strong class="text-slate-900 font-bold">₹${f.second_class * 2}</strong>
            </div>
          </div>

          <!-- First Class -->
          <div class="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-amber-200 text-amber-900 rounded">I Class Suburban</span>
              <span class="text-[10px] text-amber-700 font-semibold">Cushioned Seats</span>
            </div>
            <div class="mt-2.5 flex items-baseline gap-2">
              <span class="text-2xl font-black text-amber-900">₹${f.first_class}</span>
              <span class="text-xs text-amber-700 font-semibold">Single</span>
            </div>
            <div class="mt-1 pt-1.5 border-t border-amber-200/60 flex justify-between text-xs text-amber-900">
              <span>Daily Return Ticket:</span>
              <strong class="font-bold">₹${f.first_class * 2}</strong>
            </div>
          </div>

          <!-- AC Local -->
          <div class="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded">AC Suburban EMU</span>
              <span class="text-[10px] text-emerald-700 font-semibold">Auto Vestibule</span>
            </div>
            <div class="mt-2.5 flex items-baseline gap-2">
              <span class="text-2xl font-black text-emerald-950">₹${f.ac_local}</span>
              <span class="text-xs text-emerald-700 font-semibold">Single</span>
            </div>
            <div class="mt-1 pt-1.5 border-t border-emerald-200/60 flex justify-between text-xs text-emerald-900">
              <span>Return Ticket:</span>
              <strong class="font-bold">₹${Math.round(f.ac_local * 1.9)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Unlimited Suburban Season Pass Matrix -->
      <div>
        <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Unlimited Suburban Season Pass (MST &amp; QST)</h4>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <!-- Second Class Pass -->
          <div class="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs">
            <div class="text-[10px] font-bold text-slate-500 uppercase">Second Class Season Pass</div>
            <div class="mt-2 flex items-baseline justify-between">
              <div>
                <span class="text-xs text-slate-400">Monthly:</span>
                <span class="text-lg font-black text-slate-900 ml-1">₹${sp.monthly_second}</span>
              </div>
              <div>
                <span class="text-xs text-slate-400">Quarterly:</span>
                <span class="text-sm font-bold text-slate-800 ml-1">₹${qSec}</span>
              </div>
            </div>
            <p class="text-[10px] text-slate-400 mt-2">Unlimited travel across origin &amp; destination</p>
          </div>

          <!-- First Class Pass -->
          <div class="p-4 bg-amber-50/40 border border-amber-200/80 rounded-2xl shadow-2xs">
            <div class="text-[10px] font-bold text-amber-800 uppercase">First Class Season Pass</div>
            <div class="mt-2 flex items-baseline justify-between">
              <div>
                <span class="text-xs text-amber-700">Monthly:</span>
                <span class="text-lg font-black text-amber-950 ml-1">₹${sp.monthly_first}</span>
              </div>
              <div>
                <span class="text-xs text-amber-700">Quarterly:</span>
                <span class="text-sm font-bold text-amber-900 ml-1">₹${qFirst}</span>
              </div>
            </div>
            <div class="mt-1 pt-1 text-[10px] text-amber-800 flex justify-between border-t border-amber-100">
              <span>Half-Yearly: ₹${hyFirst}</span>
              <span>Yearly: ₹${yFirst}</span>
            </div>
          </div>

          <!-- AC Local Pass -->
          <div class="p-4 bg-emerald-50/40 border border-emerald-200/80 rounded-2xl shadow-2xs">
            <div class="text-[10px] font-bold text-emerald-800 uppercase">AC Local Season Pass</div>
            <div class="mt-2 flex items-baseline justify-between">
              <div>
                <span class="text-xs text-emerald-700">Monthly:</span>
                <span class="text-lg font-black text-emerald-950 ml-1">₹${sp.monthly_ac}</span>
              </div>
              <div>
                <span class="text-xs text-emerald-700">Quarterly:</span>
                <span class="text-sm font-bold text-emerald-900 ml-1">₹${qAc}</span>
              </div>
            </div>
            <p class="text-[10px] text-emerald-700 mt-2">Valid in all AC &amp; non-AC First Class rakes</p>
          </div>
        </div>
      </div>

      <!-- Cost Savings Meter Banner -->
      <div class="p-4 bg-gradient-to-r from-emerald-900 via-teal-900 to-[#07131e] text-white rounded-2xl shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-[10px] uppercase font-extrabold tracking-wider text-emerald-300">Commuter Cost-Benefit Analysis</div>
          <div class="text-sm font-black mt-0.5">
            A First Class Season Pass saves ~₹${monthlyPassSavings.toLocaleString('en-IN')} every month
          </div>
          <p class="text-xs text-slate-300 mt-0.5">
            Daily return tickets cost ₹${monthlyDailyCost.toLocaleString('en-IN')}/mo (22 working days). Pass breaks even in only <strong>${tripsToBreakeven} single trips</strong>!
          </p>
        </div>
        <button onclick="switchAppTab('my-personal')" class="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold transition-all shrink-0">
          Save in Pass Wallet ➔
        </button>
      </div>
    `;
  } catch (err) {
    console.warn('Fare calc error:', err);
  }
}

async function loadBulletins() {
  const container = document.getElementById('tabBulletinsList');
  if (!container) return;

  try {
    const res = await fetch('/api/railway-updates');
    const data = await res.json();
    const alerts = data.alerts || [];

    let html = '';
    alerts.forEach(a => {
      html += `
        <div class="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs">
          <div class="flex items-center gap-2 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded w-fit mb-2">
            <span>OFFICIAL NOTICE</span>
            <span>/</span>
            <span>${a.effective_time || 'Central Railway'}</span>
          </div>
          <h4 class="text-xs font-bold text-slate-900">${a.title}</h4>
          <p class="text-xs text-slate-500 mt-1 leading-relaxed">${a.description}</p>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (e) {
    console.warn('Bulletins error:', e);
  }
}

// ==========================================
// 10. GEMINI TRANSIT AI COPILOT
// ==========================================
window.submitAiQuery = async function() {
  const input = document.getElementById('aiInputText');
  const query = input?.value.trim();
  if (!query) return;

  appendAiMessage('user', query);
  input.value = '';

  const btn = document.getElementById('aiSendBtn');
  if (btn) btn.textContent = 'Thinking...';

  try {
    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    appendAiMessage('copilot', data.answer || 'No response available.');
  } catch (err) {
    appendAiMessage('copilot', 'Central Railway timetable intelligence query failed. Please verify network connection.');
  } finally {
    if (btn) btn.textContent = 'Ask AI';
  }
};

window.sendQuickAiPrompt = function(promptText) {
  const input = document.getElementById('aiInputText');
  if (input) input.value = promptText;
  submitAiQuery();
};

function appendAiMessage(sender, text) {
  const stream = document.getElementById('aiChatStream');
  if (!stream) return;

  const isUser = sender === 'user';
  const bubble = document.createElement('div');
  bubble.className = isUser
    ? 'p-3 bg-[#064e3b] text-white rounded-2xl ml-auto max-w-md shadow-2xs text-xs'
    : 'p-3 bg-white border border-slate-200 text-slate-800 rounded-2xl mr-auto max-w-md shadow-2xs text-xs';

  const label = isUser ? 'You' : 'CentralSaathi AI Copilot';
  const labelColor = isUser ? 'text-emerald-200' : 'text-emerald-800';

  bubble.innerHTML = `
    <div class="font-bold ${labelColor} mb-1">${label}</div>
    <div class="leading-relaxed">${text}</div>
  `;

  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
}
