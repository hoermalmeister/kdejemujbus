import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

// Prvky našeho nového bočního/spodního panelu
const detailPanel = document.getElementById('detail-panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
const panelClose = document.getElementById('panel-close');

// Do této proměnné si schováme stažená data o aktuálně otevřeném vlaku,
// abychom mezi detaily a jízdním řádem mohli přepínat okamžitě bez načítání
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
    center: [15.4730, 49.8175], 
    zoom: 7,
    maxZoom: 19
});

// --- GENEROVÁNÍ DOKONALÝCH SAMOLEPEK (Ikona + Text v jednom obrázku) ---
function getOrCreateIcon(map, provider, routeText, heading) {
    const isCircle = heading === null || heading === undefined;
    const safeHeading = isCircle ? 0 : Math.round(heading / 5) * 5;
    const iconId = `veh-${provider}-${routeText}-${safeHeading}`;

    if (map.hasImage(iconId)) return iconId;

    const size = 44; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); 
    ctx.translate(size/2, size/2); 

    let fillColor = '#7f8c8d';
    if (provider === 'GRAPP') fillColor = '#800000';
    if (provider === 'PID') fillColor = '#2C89C8';

    ctx.save();
    if (!isCircle) {
        ctx.rotate(safeHeading * Math.PI / 180);
        ctx.scale(1.4, 1.4); 
        ctx.translate(-11, -15.5); 
        const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
        ctx.fillStyle = fillColor;
        ctx.fill(path);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, 2 * Math.PI); 
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    ctx.restore(); 

    if (routeText) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 10px sans-serif'; 
        ctx.lineWidth = 3; 
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(routeText, 0, 0);
        ctx.fillStyle = '#FFFFFF'; 
        ctx.fillText(routeText, 0, 0);
    }

    map.addImage(iconId, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
    return iconId;
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    map.addSource('selected-route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
    });

    map.addLayer({
        id: 'selected-route-layer',
        type: 'line',
        source: 'selected-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e67e22', 'line-width': 4, 'line-opacity': 0.8 }
    });

    map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 'icon-image': ['get', 'iconId'], 'icon-allow-overlap': true, 'icon-ignore-placement': true }
    });

    // --- KLIKNUTÍ NA VOZIDLO (ZOBRAZENÍ PANELU) ---
    map.on('click', 'vehicles-layer', async (e) => {
        const feature = e.features[0];
        const props = feature.properties; 

        // Reset předchozí volby trasy
        map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

        // Otevřeme panel a dáme do něj loading stav
        panelTitle.innerText = "Načítám...";
        panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#7f8c8d;">Stahuji podrobné informace o spoji...</div>`;
        detailPanel.style.display = "flex";
        setTimeout(() => detailPanel.classList.add('open'), 10); // Spustí plynulý výjezd na mobilu

        const providerObj = providers.find(p => p.providerName === props.provider);
        if (providerObj) {
            // Paralelně stáhneme základní detaily i souřadnice trasy
            const [details, routeCoordinates] = await Promise.all([
                providerObj.getDetails ? providerObj.getDetails(props.id) : null,
                providerObj.getRouteInfo ? providerObj.getRouteInfo(props.id) : null
            ]);
            
            // Pokud trasa existuje, hned ji vykreslíme
            if (routeCoordinates && routeCoordinates.length > 0) {
                map.getSource('selected-route').setData({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: routeCoordinates }
                });
            }

            if (details) {
                // Uložíme si kompletní sadu dat do globální paměti pro přepínání oken
                activeTrainData = { props: props, details: details, timetable: null };
                renderDetailView(); // Vykreslíme základní pohled s detaily
            } else {
                panelTitle.innerText = "Chyba";
                panelBody.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Informace o spoji se nepodařilo stáhnout.</div>`;
            }
        }
    });

    // Zavření panelu křížkem (schová panel a smaže čáru z mapy)
    panelClose.addEventListener('click', closeDetailPanel);
    
    // Kliknutí do prázdného místa v mapě panel také zavře
    map.on('click', (e) => {
        if (e.defaultPrevented) return;
        // Pokud uživatel klikl na prázdnou mapu (mimo vlak), panel zavřeme
        const features = map.queryRenderedFeatures(e.point, { layers: ['vehicles-layer'] });
        if (features.length === 0) closeDetailPanel();
    });

    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    updateData();
    setInterval(updateData, 15000);
});

// --- POHLED 1: VYKRESLENÍ DETAILŮ O VOZIDLE ---
function renderDetailView() {
    const d = activeTrainData.details;
    const p = activeTrainData.props;

    // Sestavíme titulek (přidáme značku NAD, pokud existuje)
    let titleHtml = `${d.route}`;
    if (d.isNAD) {
        titleHtml += ` <span style="font-size: 12px; background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle;">Náhradní doprava</span>`;
    }
    panelTitle.innerHTML = titleHtml;
    
    panelBody.innerHTML = `
        <table class="detail-table">
            <tr><th>Směr</th><td>${d.destination}</td></tr>
            <tr><th>Aktuální stanice</th><td>${d.stop}</td></tr>
            <tr><th>Zpoždění</th><td><span style="color:#e67e22; font-weight:700;">${d.delay}</span></td></tr>
            <tr><th>Dopravce</th><td>${d.carrier}</td></tr>
        </table>
        <button id="show-timetable-btn" class="panel-btn panel-btn-primary">
            📋 Zobrazit jízdní řád
        </button>
    `;

    document.getElementById('show-timetable-btn').addEventListener('click', switchToTimetable);
}

// --- POHLED 2: PŘEPNUTÍ A VYKRESLENÍ JÍZDNÍHO ŘÁDU ---
async function switchToTimetable() {
    panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#7f8c8d;">Stahuji kompletní jízdní řád...</div>`;
    
    const p = activeTrainData.props;
    const providerObj = providers.find(prov => prov.providerName === p.provider);

    if (!activeTrainData.timetable && providerObj && providerObj.getTimetable) {
        activeTrainData.timetable = await providerObj.getTimetable(p.id);
    }

    panelTitle.innerText = "Jízdní řád";
    
    let htmlContent = `
        <button id="back-to-details-btn" class="panel-btn panel-btn-secondary" style="margin-bottom: 15px;">
            ← Zpět na informace o spoji
        </button>
    `;

    if (activeTrainData.timetable && activeTrainData.timetable.length > 0) {
        htmlContent += '<div class="timetable-list">';
        htmlContent += activeTrainData.timetable.map(stop => {
            
            // Helper pro vykreslení jednoho bloku času (příjezd/odjezd)
            const renderTimeBlock = (label, data) => {
                if (!data || !data.planned) return `<div class="timetable-time-block"></div>`;
                return `
                    <div class="timetable-time-block">
                        <span class="time-label">${label}</span>
                        <span class="time-actual" style="color: ${data.color};">${data.actual}</span>
                        ${data.actual !== data.planned ? `<span class="time-planned">${data.planned}</span>` : ''}
                    </div>
                `;
            };

            return `
            <div class="timetable-item">
                <span class="timetable-station">${stop.station}</span>
                <div class="timetable-times-container">
                    ${renderTimeBlock('Příj.', stop.arr)}
                    ${renderTimeBlock('Odj.', stop.dep)}
                </div>
            </div>
        `}).join('');
        htmlContent += '</div>';
    } else {
        htmlContent += `<div style="color:red; text-align:center; padding:20px;">Jízdní řád se nepodařilo načíst.</div>`;
    }

    panelBody.innerHTML = htmlContent;
    document.getElementById('back-to-details-btn').addEventListener('click', renderDetailView);
}

// --- FUNKCE PRO ZAVŘENÍ PANELU ---
function closeDetailPanel() {
    detailPanel.classList.remove('open');
    setTimeout(() => { detailPanel.style.display = "none"; }, 300); // Počká na dojezd animace na mobilu
    map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
}

// --- HLAVNÍ DATOVÁ SMYČKA ---
async function updateData() {
    try {
        statusDiv.innerText = 'Aktualizuji data...';
        const fetchPromises = providers.map(p => p.fetchData());
        const results = await Promise.allSettled(fetchPromises);
        let allVehicles = [];
        results.forEach((result) => {
            if (result.status === 'fulfilled') allVehicles = allVehicles.concat(result.value);
        });

        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        const features = cleanData
            .filter(v => v.lat !== undefined && v.lon !== undefined && v.lat !== null && v.lon !== null)
            .map(v => {
                const iconId = getOrCreateIcon(map, v.provider, v.route, v.heading);
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                    properties: { ...v, iconId: iconId }
                };
            });

        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;
    } catch (err) {
        console.error("Kritická chyba:", err);
        statusDiv.innerText = "Chyba při načítání dat.";
    }
}
