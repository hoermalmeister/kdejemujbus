import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

// Prvky panelu
const detailPanel = document.getElementById('detail-panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
const panelClose = document.getElementById('panel-close');

// --- ANALÝZA URL PARAMETRŮ PŘI STARTU ---
const urlParams = new URLSearchParams(window.location.search);
let startZoom = urlParams.has('z') ? parseFloat(urlParams.get('z')) : 7;
let startLat = urlParams.has('y') ? parseFloat(urlParams.get('y')) : 49.8175;
let startLng = urlParams.has('x') ? parseFloat(urlParams.get('x')) : 15.4730;
let targetVehicleId = urlParams.get('id'); // e.g. "EC_278" nebo "842150_30"
let targetTimetable = urlParams.get('tt') === '1';
let initialClickDone = false;
let isTimetableOpen = false;

let activeTrainData = { props: null, details: null, timetable: null };

// --- INICIALIZACE MAPY ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf", 
        sources: { 
            'carto-dark': { 
                type: 'raster', 
                tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], 
                tileSize: 256 
            } 
        },
        layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }]
    },
    center: [startLng, startLat], 
    zoom: startZoom,
    maxZoom: 19
});

// --- FUNKCE PRO ZMĚNU URL V PROHLÍŽEČI ---
function updateURL() {
    const center = map.getCenter();
    const params = new URLSearchParams();
    params.set('x', center.lng.toFixed(4));
    params.set('y', center.lat.toFixed(4));
    params.set('z', map.getZoom().toFixed(1));
    
    if (activeTrainData && activeTrainData.props) {
        const v = activeTrainData.props;
        let urlId = v.id;
        
        // Zde si upravujeme ID do krásného tvaru (Os_14458 nebo 842150_30)
        if (v.provider === 'GRAPP' && v.globalMatchId) {
            urlId = v.globalMatchId.replace(/ /g, '_');
        } else if (v.text) {
            urlId = v.text.replace(/\//g, '_').replace(/ /g, '_');
        } else if (v.route && v.runNumber) {
            urlId = `${v.route}_${v.runNumber}`;
        }
        
        params.set('id', urlId);
        
        if (isTimetableOpen) {
            params.set('tt', '1');
        }
    }
    
    // Přepisujeme URL bez nutnosti načítat znova stránku
    window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

// Při pohybu nebo zazoomování mapou URL aktualizujeme
map.on('moveend', updateURL);
map.on('zoomend', updateURL);

// --- GENEROVÁNÍ DOKONALÝCH SAMOLEPEK ---
function getOrCreateIcon(map, provider, routeText, heading) {
    const isCircle = heading === null || heading === undefined;
    const safeHeading = isCircle ? 0 : Math.round(heading / 5) * 5;
    const iconId = `veh-${provider}-${routeText}-${safeHeading}`;

    if (map.hasImage(iconId)) return iconId;

    const size = 44; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); ctx.translate(size/2, size/2); 

    let fillColor = '#7f8c8d';
    if (provider === 'GRAPP') fillColor = '#800000';
    if (provider === 'PID') fillColor = '#2C89C8';

    ctx.save();
    if (!isCircle) {
        ctx.rotate(safeHeading * Math.PI / 180);
        ctx.scale(1.4, 1.4); ctx.translate(-11, -15.5); 
        const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
        ctx.fillStyle = fillColor; ctx.fill(path);
    } else {
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, 2 * Math.PI); ctx.fillStyle = fillColor; ctx.fill();
    }
    ctx.restore(); 

    if (routeText) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px sans-serif'; 
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(routeText, 0, 0);
        ctx.fillStyle = '#FFFFFF'; ctx.fillText(routeText, 0, 0);
    }

    map.addImage(iconId, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
    return iconId;
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    map.addSource('selected-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'selected-route-layer', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e67e22', 'line-width': 4, 'line-opacity': 0.8 } });

    map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'vehicles-layer', type: 'symbol', source: 'vehicles', layout: { 'icon-image': ['get', 'iconId'], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });

    map.on('click', 'vehicles-layer', (e) => {
        openVehicleDetail(e.features[0].properties);
    });

    panelClose.addEventListener('click', closeDetailPanel);
    map.on('click', (e) => {
        if (e.defaultPrevented) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['vehicles-layer'] });
        if (features.length === 0) closeDetailPanel();
    });

    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    updateData();
    setInterval(updateData, 15000);
});

// --- CENTRÁLNÍ FUNKCE PRO OTEVŘENÍ DETAILU ---
async function openVehicleDetail(props) {
    map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

    panelTitle.innerText = "Načítám...";
    panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Stahuji podrobné informace o spoji...</div>`;
    detailPanel.style.display = "flex";
    setTimeout(() => detailPanel.classList.add('open'), 10); 

    const providerObj = providers.find(p => p.providerName === props.provider);
    if (providerObj) {
        const [details, routeCoordinates] = await Promise.all([
            providerObj.getDetails ? providerObj.getDetails(props.id) : null,
            providerObj.getRouteInfo ? providerObj.getRouteInfo(props.id) : null
        ]);
        
        if (routeCoordinates && routeCoordinates.length > 0) {
            map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoordinates } });
        }

        if (details) {
            activeTrainData = { props: props, details: details, timetable: null };
            
            // Auto-otevření jízdního řádu (pokud bylo v URL &tt=1)
            if (targetTimetable) {
                targetTimetable = false; // Příště už reagujeme na proklik uživatele
                await switchToTimetable();
            } else {
                renderDetailView(); 
            }
        } else {
            panelTitle.innerText = "Chyba";
            panelBody.innerHTML = `<div style="color:#e74c3c; text-align:center; padding:20px;">Informace o spoji se nepodařilo stáhnout.</div>`;
        }
    }
    updateURL();
}

function renderDetailView() {
    isTimetableOpen = false;
    updateURL();
    const d = activeTrainData.details;

    let titleHtml = `${d.route}`;
    if (d.isNAD) {
        titleHtml += ` <span style="font-size: 11px; background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; font-weight: bold;">Náhradní doprava</span>`;
    }
    
    document.querySelector('.panel-header').style.display = 'flex';
    panelTitle.innerHTML = titleHtml;

    let delayColor = '#58d68d'; 
    let delayText = 'Bez zpoždění';

    if (d.delay.startsWith('-')) {
        delayColor = '#bada55'; delayText = d.delay;    
    } else if (d.delay !== '0 min') {
        let minVal = parseInt(d.delay);
        if (minVal > 15) delayColor = '#e74c3c';
        else if (minVal > 5) delayColor = '#f39c12';
        delayText = '+' + d.delay;
    }
    
    panelBody.innerHTML = `
        <table class="vdv-table">
            <tr><th>Směr</th><td>${d.destination}</td></tr>
            <tr><th>Zastávka</th><td>${d.stop}</td></tr>
            <tr><th>Zpoždění</th><td><b style="color:${delayColor};">${delayText}</b></td></tr>
            <tr><th>Dopravce</th><td style="font-weight:normal; color:#ddd;">${d.carrier}</td></tr>
        </table>
        <button id="show-timetable-btn" class="panel-btn panel-btn-primary">
            Jízdní řád
        </button>
    `;

    document.getElementById('show-timetable-btn').addEventListener('click', switchToTimetable);
}

async function switchToTimetable() {
    isTimetableOpen = true;
    updateURL();
    
    panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Načítám jízdní řád...</div>`;
    
    const p = activeTrainData.props;
    const d = activeTrainData.details;
    const providerObj = providers.find(prov => prov.providerName === p.provider);

    if (!activeTrainData.timetable && providerObj && providerObj.getTimetable) {
        activeTrainData.timetable = await providerObj.getTimetable(p.id);
    }

    document.querySelector('.panel-header').style.display = 'none';
    
    let delayColor = '#58d68d'; 
    let delayText = '0 min';

    if (d.delay.startsWith('-')) {
        delayColor = '#bada55'; delayText = d.delay;
    } else if (d.delay !== '0 min') {
        let minVal = parseInt(d.delay);
        if (minVal > 15) delayColor = '#e74c3c';
        else if (minVal > 5) delayColor = '#f39c12';
        delayText = '+' + d.delay;
    }

    let htmlContent = `
        <div class="tt-header">
            <button id="back-to-details-btn" class="tt-back-btn">Zpět</button>
            <div class="tt-header-info">
                <span style="margin-right:15px;">Linkospoj: <strong>${d.route}</strong></span>
                Zpoždění: <strong class="delay-val" style="color: ${delayColor}">${delayText}</strong>
            </div>
        </div>
    `;

    if (activeTrainData.timetable && activeTrainData.timetable.length > 0) {
        htmlContent += `
            <table class="tt-table">
                <thead>
                    <tr>
                        <th>Zastávka</th>
                        <th>Příjezd</th>
                        <th>Odjezd</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        htmlContent += activeTrainData.timetable.map(stop => {
            const renderTime = (data) => {
                if (!data || !data.actual) return `<span style="color:#444;">-</span>`;
                let html = '';
                if (data.planned) {
                    if (data.actual !== data.planned) html += `<s class="tt-time-planned">${data.planned}</s> `;
                    else html += `<span class="tt-time-planned-nodelay">${data.planned}</span> `;
                }
                html += `<span class="tt-time-actual" style="color: ${data.color};">${data.actual}</span>`;
                return html;
            };
            const nadHtml = stop.isNAD ? `<span class="nad-badge" title="Náhradní doprava v tomto úseku">NAD</span>` : '';
            return `<tr><td>${stop.station}${nadHtml}</td><td>${renderTime(stop.arr)}</td><td>${renderTime(stop.dep)}</td></tr>`;
        }).join('');
        
        htmlContent += `</tbody></table>`;
    } else {
        htmlContent += `<div style="color:#e74c3c; text-align:center; padding:20px;">Jízdní řád není k dispozici.</div>`;
    }

    panelBody.innerHTML = htmlContent;
    document.getElementById('back-to-details-btn').addEventListener('click', renderDetailView);
}

function closeDetailPanel() {
    activeTrainData = { props: null, details: null, timetable: null };
    isTimetableOpen = false;
    updateURL();

    detailPanel.classList.remove('open');
    setTimeout(() => { 
        detailPanel.style.display = "none"; 
        document.querySelector('.panel-header').style.display = 'flex'; 
    }, 300); 
    map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
}

async function updateData() {
    try {
        statusDiv.innerText = 'Aktualizuji data...';
        const fetchPromises = providers.map(p => p.fetchData());
        const results = await Promise.allSettled(fetchPromises);
        let allVehicles = [];
        results.forEach((result) => { if (result.status === 'fulfilled') allVehicles = allVehicles.concat(result.value); });
        
        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        const features = cleanData
            .filter(v => v.lat !== undefined && v.lon !== undefined && v.lat !== null && v.lon !== null)
            .map(v => {
                const iconId = getOrCreateIcon(map, v.provider, v.route, v.heading);
                return { type: 'Feature', geometry: { type: 'Point', coordinates: [v.lon, v.lat] }, properties: { ...v, iconId: iconId } };
            });

        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;

        // AUTO-KLIKNUTÍ PŘI NAČTENÍ Z URL
        if (targetVehicleId && !initialClickDone) {
            const targetFeature = features.find(f => {
                const v = f.properties;
                let matchId = v.id;
                if (v.provider === 'GRAPP' && v.globalMatchId) matchId = v.globalMatchId.replace(/ /g, '_');
                else if (v.text) matchId = v.text.replace(/\//g, '_').replace(/ /g, '_');
                else if (v.route && v.runNumber) matchId = `${v.route}_${v.runNumber}`;
                return matchId === targetVehicleId;
            });

            if (targetFeature) {
                initialClickDone = true;
                openVehicleDetail(targetFeature.properties);
            }
        }

    } catch (err) { statusDiv.innerText = "Chyba při načítání dat."; }
}

// =========================================================
// OVLÁDACÍ PRVKY Z VDV (Lokalizace a Kompas)
// =========================================================

const locateBtn = document.getElementById('locate-btn');
let userLocationMarker = null;

if(locateBtn) {
    locateBtn.addEventListener('click', () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(position => { 
                const coords = [position.coords.longitude, position.coords.latitude];
                map.flyTo({ center: coords, zoom: 14 }); 
                
                // Vykreslení pulzující značky uživatele na mapě
                if (!userLocationMarker) {
                    const el = document.createElement('div');
                    el.className = 'user-location-marker';
                    userLocationMarker = new maplibregl.Marker({ element: el })
                        .setLngLat(coords)
                        .addTo(map);
                } else {
                    userLocationMarker.setLngLat(coords);
                }
            }, () => {
                alert("Nepodařilo se zjistit vaši polohu. Zkontrolujte oprávnění prohlížeče.");
            });
        } else {
            alert("Geolokace není podporována vaším prohlížečem.");
        }
    });
}

// Dynamická severka
const compassBtn = document.createElement('div'); 
compassBtn.id = 'compass-btn';
compassBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
document.body.appendChild(compassBtn);

compassBtn.addEventListener('click', () => { map.resetNorthPitch({ duration: 500 }); });

function updateCompass() { 
    const bearing = map.getBearing(); 
    const pitch = map.getPitch(); 
    if (Math.abs(bearing) < 0.5 && pitch < 1) {
        compassBtn.style.display = 'none'; 
    } else { 
        compassBtn.style.display = 'flex'; 
        compassBtn.querySelector('svg').style.transform = `rotate(${-bearing}deg)`; 
    } 
}
map.on('rotate', updateCompass); 
map.on('pitch', updateCompass); 
map.on('move', updateCompass);
