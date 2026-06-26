import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';
import PidProvider from './providers/PidProvider.js';
import IdsJmkProvider from './providers/IdsJmkProvider.js';
import IredoProvider from './providers/IredoProvider.js';
import IdsokProvider from './providers/IdsokProvider.js';
import VdvProvider from './providers/VdvProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider(),
    new PidProvider(),
    new IdsJmkProvider(),
    new IredoProvider(),
    new IdsokProvider(),
    new VdvProvider()
];

const statusDiv = document.getElementById('status');

const detailPanel = document.getElementById('detail-panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
const panelClose = document.getElementById('panel-close');

const urlParams = new URLSearchParams(window.location.search);
let startZoom = urlParams.has('z') ? parseFloat(urlParams.get('z')) : 7;
let startLat = urlParams.has('y') ? parseFloat(urlParams.get('y')) : 49.8175;
let startLng = urlParams.has('x') ? parseFloat(urlParams.get('x')) : 15.4730;
let targetVehicleId = urlParams.get('id'); 
let targetTimetable = urlParams.get('tt') === '1';
let initialClickDone = false;
let isTimetableOpen = false;

let activeTrainData = { props: null, details: null, timetable: null };

function getProviderColor(provider) {
    if (provider === 'GRAPP') return '#800000';
    if (provider === 'PID') return '#d40000';
    if (provider === 'IDS JMK') return '#4ab95d';
    if (provider === 'IREDO') return '#ee7e1e';
    if (provider === 'IDSOK') return '#009e9e';
    if (provider === 'VDV') return '#0000ff';
    return '#ff8080'; 
}

// --- INICIALIZACE MAPY ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        // Fonty už nepotřebujeme stahovat, řeší to Canvas
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
    maxZoom: 19,
    pitchWithRotate: false, 
    dragPitch: false,       
    touchPitch: false       
});

function updateURL() {
    const center = map.getCenter();
    const params = new URLSearchParams();
    params.set('x', center.lng.toFixed(4));
    params.set('y', center.lat.toFixed(4));
    params.set('z', map.getZoom().toFixed(1));
    
    if (activeTrainData && activeTrainData.props) {
        const v = activeTrainData.props;
        let urlId = v.id;
        if (v.provider === 'GRAPP' && v.globalMatchId) urlId = v.globalMatchId.replace(/ /g, '_');
        else if (v.text) urlId = v.text.replace(/\//g, '_').replace(/ /g, '_');
        else if (v.route && v.runNumber) urlId = `${v.route}_${v.runNumber}`;
        params.set('id', urlId);
        if (isTimetableOpen) params.set('tt', '1');
    }
    
    window.history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

map.on('moveend', updateURL);
map.on('zoomend', updateURL);

// --- GENEROVÁNÍ ŠIPEK ---
function getOrCreateIcon(map, provider, routeText, heading) {
    const isCircle = heading === null || heading === undefined;
    // Zaokrouhlení azimutu, aby se negenerovalo zbytečně moc obrázků a RAM zůstala čistá
    const safeHeading = isCircle ? 0 : Math.round(heading / 5) * 5;
    const iconId = `veh-${provider}-${routeText}-${safeHeading}`;

    if (map.hasImage(iconId)) return iconId;

    const size = 44; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); ctx.translate(size/2, size/2); 

    let fillColor = getProviderColor(provider);

    ctx.save();
    if (!isCircle) {
        // Rotujeme pouze šipku vůči Canvasu
        ctx.rotate(safeHeading * Math.PI / 180);
        ctx.scale(1.4, 1.4); ctx.translate(-11, -15.5); 
        
        const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
        ctx.fillStyle = fillColor; ctx.fill(path);
    } else {
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, 2 * Math.PI); 
        ctx.fillStyle = fillColor; ctx.fill();
    }
    ctx.restore(); 

    // Text zůstává vodorovně vzhledem k obrázku 
    if (routeText) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px sans-serif'; 
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
    
    // --- JEDINÁ ABSOLUTNĚ SPRÁVNÁ VRSTVA ---
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'symbol', 
        source: 'vehicles', 
        layout: { 
            'icon-image': ['get', 'iconId'], 
            'icon-allow-overlap': true, 
            'icon-ignore-placement': true,
            // Tohle zařídí, že samolepka rotuje přesně s mapou (šipka udrží azimut, text se natočí)
            'icon-rotation-alignment': 'map', 
            // Třídění Z-Indexu nyní aplikujeme na spojený blok ikona+text
            'symbol-sort-key': ['get', 'sortKey'] 
        }
    });

    panelClose.addEventListener('click', closeDetailPanel);

    map.on('click', (e) => {
        if (e.defaultPrevented) return;

        const padding = 10;
        const bbox = [
            [e.point.x - padding, e.point.y - padding],
            [e.point.x + padding, e.point.y + padding]
        ];

        const features = map.queryRenderedFeatures(bbox, { layers: ['vehicles-layer'] });

        if (!features || features.length === 0) {
            closeDetailPanel();
            return;
        }

        if (features.length === 1) {
            openVehicleDetail(features[0].properties);
        } else if (features.length <= 20) {
            showEntitySelection(features);
        } else {
            showTooManyEntitiesError();
        }
    });

    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    updateData();
    setInterval(updateData, 15000);
});

async function openVehicleDetail(props) {
    map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

    panelBody.style.padding = '15px';
    panelBody.style.overflowY = 'auto';
    panelBody.style.display = 'block';

    panelTitle.innerText = "Načítám...";
    document.querySelector('.panel-header').style.display = 'flex';
    panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Stahuji podrobné informace o spoji...</div>`;
    detailPanel.style.display = "flex";
    setTimeout(() => detailPanel.classList.add('open'), 10); 

    let parsedAttributes = null;
    if (props.attributes) {
        try { parsedAttributes = typeof props.attributes === 'string' ? JSON.parse(props.attributes) : props.attributes; } 
        catch (e) { parsedAttributes = props.attributes; }
    }

    const providerObj = providers.find(p => p.providerName === props.provider);
    if (providerObj) {
        
        // 1. NEJPRVE stáhneme detaily (zde Můstek zjistí přesný linkospoj)
        const details = providerObj.getDetails ? await providerObj.getDetails(props.id, parsedAttributes) : null;
        
        // 2. AŽ POTOM stáhneme trasu a předáme jí rovnou i ty zjištěné detaily
        const routeCoordinates = providerObj.getRouteInfo ? await providerObj.getRouteInfo(props.id, parsedAttributes, details) : null;
        
        if (routeCoordinates && routeCoordinates.length > 0) {
            map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: routeCoordinates } });
        }

        if (details) {
            activeTrainData = { props: props, details: details, timetable: null };
            if (targetTimetable) {
                targetTimetable = false; 
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

async function showEntitySelection(features) {
    panelBody.style.padding = '15px';
    panelBody.style.overflowY = 'auto';
    panelBody.style.display = 'block';
    
    panelTitle.innerText = "Výběr spoje";
    document.querySelector('.panel-header').style.display = 'flex';
    detailPanel.style.display = "flex";
    detailPanel.classList.add('open');

    panelBody.innerHTML = `<div style="color: #aaa; text-align: center; padding: 30px 10px;">Zjišťuji přesné trasy a směry spojů...</div>`;

    const detailedFeatures = await Promise.all(features.map(async (f) => {
        const props = f.properties;
        let parsedAttributes = null;
        if (props.attributes) {
            try { parsedAttributes = typeof props.attributes === 'string' ? JSON.parse(props.attributes) : props.attributes; } 
            catch (e) { parsedAttributes = props.attributes; }
        }

        const providerObj = providers.find(p => p.providerName === props.provider);
        let details = null;
        if (providerObj && providerObj.getDetails) {
            details = await providerObj.getDetails(props.id, parsedAttributes);
        }
        return { feature: f, details: details };
    }));

    let html = `
        <div style="color: #aaa; margin-bottom: 15px; font-size: 13px;">
            V označené oblasti bylo nalezeno <b>${features.length}</b> spojů. Vyberte si jeden:
        </div>
        <div class="selection-list" style="display: flex; flex-direction: column; gap: 10px;">
    `;

    detailedFeatures.forEach((item, idx) => {
        const props = item.feature.properties;
        const d = item.details;
        
        let label = props.route;
        let direction = props.headsign;

        if (d) {
            label = d.route; 
            direction = d.destination; 
        } else {
            if (props.provider === 'PID') {
                const idParts = props.id.split('_');
                if (idParts.length >= 3) label = `${props.route}/${idParts[2]}`;
            } else if (props.provider === 'GRAPP') {
                label = props.headsign;
                direction = 'Směr nezjištěn';
            }
        }

        const sideColor = getProviderColor(props.provider);

        html += `
            <div class="selection-item" data-idx="${idx}" style="padding: 12px; background: #252525; border-radius: 6px; cursor: pointer; border-left: 5px solid ${sideColor}; transition: background 0.2s;">
                <div style="font-weight: bold; color: #fff; margin-bottom: 3px;">
                    Linka: ${label} <span style="font-weight: normal; color: #888; font-size: 12px; margin-left: 5px;">(${props.provider})</span>
                </div>
                <div style="color: #bbb; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    Směr: ${direction}
                </div>
            </div>
        `;
    });

    html += '</div>';
    panelBody.innerHTML = html;

    const items = panelBody.querySelectorAll('.selection-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const idx = item.getAttribute('data-idx');
            const selectedProps = features[idx].properties;
            openVehicleDetail(selectedProps);
        });

        item.addEventListener('mouseenter', () => item.style.background = '#2d2d2d');
        item.addEventListener('mouseleave', () => item.style.background = '#252525');
    });
}

function showTooManyEntitiesError() {
    panelBody.style.padding = '15px';
    panelBody.style.display = 'block';
    
    panelTitle.innerText = "Chyba zobrazení";
    document.querySelector('.panel-header').style.display = 'flex';
    detailPanel.style.display = "flex";
    detailPanel.classList.add('open');
    
    panelBody.innerHTML = `
        <div style="color: #e74c3c; text-align: center; padding: 30px 10px; font-weight: bold; font-size: 16px;">
            ⚠️ Příliš mnoho entit
            <div style="color: #888; font-weight: normal; font-size: 13px; margin-top: 10px;">
                V tomto místě je spojů příliš mnoho a překrývají se. Přibližte si více mapu, abyste mohli vybrat konkrétní spoj.
            </div>
        </div>
    `;
}

function renderDetailView() {
    panelBody.style.padding = '15px';
    panelBody.style.overflowY = 'auto';
    panelBody.style.display = 'block';

    isTimetableOpen = false;
    updateURL();

    const d = activeTrainData.details;

    let titleHtml = `${d.route}`; 
    if (d.isNAD) {
        titleHtml += ` <span style="font-size: 11px; background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; font-weight: bold;">Náhradní doprava</span>`;
    } else if (d.isOdklon) {
        titleHtml += ` <span style="font-size: 11px; background: #e67e22; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; font-weight: bold;">Odklon</span>`;
    }
    
    document.querySelector('.panel-header').style.display = 'flex';
    panelTitle.innerHTML = titleHtml;

    let delayColor = '#58d68d'; 
    let delayText = 'Bez zpoždění';

    if (d.delay === 'V cíli' || d.delay === 'Neznámé') {
        delayColor = '#7f8c8d'; 
        delayText = d.delay;
        
        // Z mapy odmažeme šipku (směr) POUZE pokud je už v cíli (Neznámé na trase šipku potřebují)
        if (activeTrainData.props && d.delay === 'V cíli') {
            activeTrainData.props.heading = null;
        }
        if (typeof updateData === "function") updateData(); 
    } else if (d.delay.startsWith('-')) {
        delayColor = '#bada55'; 
        delayText = d.delay;    
    } else if (d.delay !== '0 min') {
        let minVal = parseInt(d.delay);
        if (minVal > 15) delayColor = '#e74c3c';
        else if (minVal > 5) delayColor = '#f39c12';
        delayText = d.delay; 
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
        let parsedAttributes = null;
        if (p.attributes) {
            try { parsedAttributes = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes; } 
            catch (e) { parsedAttributes = p.attributes; }
        }
        activeTrainData.timetable = await providerObj.getTimetable(p.id, parsedAttributes);
    }

    document.querySelector('.panel-header').style.display = 'none';

    panelBody.style.padding = '0';
    panelBody.style.overflowY = 'hidden';
    panelBody.style.display = 'flex';
    panelBody.style.flexDirection = 'column';
    
    let delayColor = '#58d68d'; 
    let delayText = '0 min';

    if (d.delay === 'V cíli' || d.delay === 'Neznámé') {
        delayColor = '#7f8c8d'; 
        delayText = d.delay;
    } else if (d.delay.startsWith('-')) {
        delayColor = '#bada55'; delayText = d.delay;
    } else if (d.delay !== '0 min') {
        let minVal = parseInt(d.delay);
        if (minVal > 15) delayColor = '#e74c3c';
        else if (minVal > 5) delayColor = '#f39c12';
        delayText = d.delay;
    }

    let htmlContent = `
            <div class="tt-header" style="padding: 15px; margin: 0; background: #1e1e1e; border-bottom: 1px solid #333; z-index: 20;">
                <button id="back-to-details-btn" class="tt-back-btn">Zpět</button>
                <div class="tt-header-info">
                    <span style="margin-right:15px;">Linkospoj: <strong>${d.timetableRoute || d.route}</strong></span>
                    Zpoždění: <strong class="delay-val" style="color: ${delayColor}">${delayText}</strong>
                </div>
            </div>
        <div id="tt-scroll-container" style="overflow-y: auto; flex-grow: 1; padding: 0 15px 15px 15px;">
            <table class="tt-table" style="position: relative;">
                <thead style="position: sticky; top: 0; background: #1e1e1e; z-index: 10;">
                    <tr>
                        <th style="padding-top: 10px;">Zastávka</th>
                        <th style="padding-top: 10px;">Příjezd</th>
                        <th style="padding-top: 10px;">Odjezd</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (activeTrainData.timetable && activeTrainData.timetable.length > 0) {
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
            const isCurrentStop = (stop.station.trim() === d.stop.trim());
            const rowId = isCurrentStop ? 'id="current-stop-row"' : '';
            
            let stationStyle = '';
            if (stop.isPassing) stationStyle += 'font-weight: normal; font-style: italic; color: #bbb; ';
            if (isCurrentStop) stationStyle += 'color: #e74c3c; ';

            return `
            <tr ${rowId}>
                <td style="${stationStyle}">${stop.station}${nadHtml}</td>
                <td>${renderTime(stop.arr)}</td>
                <td>${renderTime(stop.dep)}</td>
            </tr>
        `}).join('');
        
        htmlContent += `</tbody></table></div>`;
    } else {
        htmlContent += `</tbody></table></div><div style="color:#e74c3c; text-align:center; padding:20px;">Jízdní řád není k dispozici.</div>`;
    }

    panelBody.innerHTML = htmlContent;
    document.getElementById('back-to-details-btn').addEventListener('click', renderDetailView);

    setTimeout(() => {
        const currentRow = document.getElementById('current-stop-row');
        const scrollContainer = document.getElementById('tt-scroll-container');
        
        if (currentRow && scrollContainer) {
            const containerRect = scrollContainer.getBoundingClientRect();
            const rowRect = currentRow.getBoundingClientRect();
            const offset = (rowRect.top - containerRect.top) - (containerRect.height / 2) + (rowRect.height / 2);
            
            scrollContainer.scrollBy({
                top: offset,
                behavior: 'smooth'
            });
        }
    }, 150);
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

        // --- 1. SBĚR DAT PRO KŘÍŽOVÉ FILTRY ---
        const pidFullLines = new Set();
        const pidFullConnections = new Set(); // Pro mazání konkrétních spojů z IREDO
        const iredoFullLines = new Set();

        allVehicles.forEach(v => {
            // Extrakce PID
            if (v.provider === 'PID' && v.attributes && v.attributes.cisjrLine) {
                pidFullLines.add(v.attributes.cisjrLine);
                // Vytvoříme klíč "linka_spoj" (např. "642305_19") pro přesnou shodu s IREDO
                if (v.attributes.cisjrRun) {
                    pidFullConnections.add(`${v.attributes.cisjrLine}_${v.attributes.cisjrRun}`);
                }
            }
            // Extrakce IREDO
            if (v.provider === 'IREDO' && v.attributes && v.attributes.cisjrLine) {
                iredoFullLines.add(v.attributes.cisjrLine);
            }
        });
        
        // --- 2. APLIKACE FILTRŮ (Vymazání slabších zdrojů) ---
        allVehicles = allVehicles.filter(v => {
            if (v.provider === 'VDV') {
                // VDV linka existuje v PIDu NEBO v IREDO -> Zničit VDV
                if (v.attributes && v.attributes.text) {
                    if (pidFullLines.has(v.attributes.text) || iredoFullLines.has(v.attributes.text)) {
                        return false; 
                    }
                }
            }
            
            if (v.provider === 'IREDO') {
                // IREDO spoj (linka_spoj) existuje v PIDu -> Zničit IREDO
                const matchId = `${v.attributes.cisjrLine}_${v.attributes.cisjrRun}`;
                if (pidFullConnections.has(matchId)) {
                    return false;
                }
            }
            
            return true;
        });
        
        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        const features = cleanData
            .filter(v => v.lat !== undefined && v.lon !== undefined && v.lat !== null && v.lon !== null)
            .map(v => {
                // Vytvoříme/Získáme ikonu z Canvasu s obsaženým textem
                const iconId = getOrCreateIcon(map, v.provider, v.route, v.heading);

                // --- MATEMATIKA PRO DOKONALÉ PŘEKRÝVÁNÍ (Z-INDEX) ---
                const zIndexBase = { 
                    'GRAPP': 9000, 
                    'IDS JMK': 8000, 
                    'PID': 7000, 
                    'IREDO': 3000,
                    'IREDO': 2900,
                    'VDV': 1000 
                }[v.provider] || 0;
                const sortKey = zIndexBase + Math.round((52 - v.lat) * 10000);

                const safeProps = { 
                    ...v, 
                    iconId: iconId,
                    sortKey: sortKey
                };
                
                if (safeProps.attributes) safeProps.attributes = JSON.stringify(safeProps.attributes);

                return { type: 'Feature', geometry: { type: 'Point', coordinates: [v.lon, v.lat] }, properties: safeProps };
            });

        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;

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

        if (isUserLocationActive) updateUserLocation(false); 

    } catch (err) { statusDiv.innerText = "Chyba při načítání dat."; }
}

const locateBtn = document.getElementById('locate-btn');
let userLocationMarker = null;
let isUserLocationActive = false; 

function updateUserLocation(flyToUser = false) {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(position => { 
            const coords = [position.coords.longitude, position.coords.latitude];
            
            if (flyToUser) map.flyTo({ center: coords, zoom: 14 }); 
            
            if (!userLocationMarker) {
                const el = document.createElement('div');
                el.className = 'user-location-marker';
                userLocationMarker = new maplibregl.Marker({ element: el })
                    .setLngLat(coords)
                    .addTo(map);
            } else {
                userLocationMarker.setLngLat(coords);
            }
        }, (err) => {
            console.warn("Nepodařilo se aktualizovat polohu uživatele:", err);
            if (flyToUser) alert("Nepodařilo se zjistit vaši polohu.");
        });
    } else if (flyToUser) {
        alert("Geolokace není podporována vaším prohlížečem.");
    }
}

if(locateBtn) {
    locateBtn.addEventListener('click', () => {
        isUserLocationActive = true;
        updateUserLocation(true); 
    });
}

const compassBtn = document.createElement('div'); 
compassBtn.id = 'compass-btn';
compassBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
document.body.appendChild(compassBtn);

compassBtn.addEventListener('click', () => { map.resetNorth({ duration: 500 }); });

function updateCompass() { 
    const bearing = map.getBearing(); 
    if (Math.abs(bearing) < 0.5) compassBtn.style.display = 'none'; 
    else { 
        compassBtn.style.display = 'flex'; 
        compassBtn.querySelector('svg').style.transform = `rotate(${-bearing}deg)`; 
    } 
}
map.on('rotate', updateCompass); 
map.on('move', updateCompass);
