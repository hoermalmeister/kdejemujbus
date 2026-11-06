import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';
import PidProvider from './providers/PidProvider.js';
import IdsJmkProvider from './providers/IdsJmkProvider.js';
import IredoProvider from './providers/IredoProvider.js';
import IdsokProvider from './providers/IdsokProvider.js';
import DukProvider from './providers/DukProvider.js';
import VdvProvider from './providers/VdvProvider.js';
import IdpkProvider from './providers/IdpkProvider.js';
import MpvProvider from './providers/MpvProvider.js';
import PmdpProvider from './providers/PmdpProvider.js';
import TshbProvider from './providers/TshbProvider.js';
import DpmdProvider from './providers/DpmdProvider.js';
import DpmpProvider from './providers/DpmpProvider.js';
import DpmlbProvider from './providers/DpmlbProvider.js';
import TsmkProvider from './providers/TsmkProvider.js';

// --- OCHRANA PROTI PŘIBLÍŽENÍ CELÉ STRÁNKY NA TELEFONU ---
// Mapa si gesta řeší sama. Pokud je hlavní vlákno zaneprázdněné, Safari může gesto
// předat prohlížeči a přiblížit celou stránku. Po doběhnutí práce si pak dotyky
// znovu bere mapa a stránka by už zpět zmenšit nešla.
['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, e => e.preventDefault(), { passive: false });
});
const viewportMeta = document.getElementById('viewport-meta');
const VIEWPORT_CONTENT = viewportMeta.content;
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        if (window.visualViewport.scale <= 1.01) return;
        // Změna obsahu značky donutí prohlížeč vrátit měřítko na 1
        viewportMeta.content = viewportMeta.content === VIEWPORT_CONTENT ? `${VIEWPORT_CONTENT}, viewport-fit=auto` : VIEWPORT_CONTENT;
    });
}

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider(),
    new PidProvider(),
    new IdsJmkProvider(),
    new IredoProvider(),
    new IdsokProvider(),
    new DukProvider(),
    new VdvProvider(),
    new IdpkProvider(),
    new MpvProvider('ODIS', 'odis'),
    new MpvProvider('IDZK', 'zlin'),
    new MpvProvider('IDOL', 'idol'),
    new MpvProvider('IDESKA', 'jikord'),
    // IDOK je zatím vypnutý: dopravniportal.dpkv.cz neodpovídá z Railway ani z GitHubu
    new PmdpProvider(),
    new TshbProvider(),
    new DpmdProvider(),
    new DpmpProvider(),
    new DpmlbProvider(),
    new TsmkProvider()
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
let jmkTwinsCache = new Map();

let dukDict = {};
fetch('https://raw.githubusercontent.com/hoermalmeister/kdejemujbus-bridge/main/data/duk_linkospoje.json')
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(data => {
        dukDict = data;
        console.log(`DÚK slovník úspěšně načten z GitHubu: ${Object.keys(data).length} spojů.`);
    })
    .catch(e => console.warn("Slovník DÚK z GitHubu se nepodařilo načíst.", e));

function getProviderColor(provider) {
    if (provider === 'GRAPP') return '#800000';
    if (provider === 'PID') return '#d40000';
    if (provider === 'IDS JMK') return '#4ab95d';
    if (provider === 'IREDO') return '#ee7e1e';
    if (provider === 'IDSOK') return '#009e9e';
    if (provider === 'DÚK') return '#a05a2c';
    if (provider === 'VDV') return '#0000ff';
    if (provider === 'IDPK') return '#00ccff';
    if (provider === 'ODIS') return '#ffcb31';
    if (provider === 'IDZK') return '#f31d7f';
    if (provider === 'IDOL') return '#2c89c8';
    if (provider === 'IDESKA') return '#008033';
    if (provider === 'IDOK') return '#8c4a9a';
    if (provider === 'PMDP') return '#ff8080';
    if (provider === 'TSHB') return '#ff8080';
    if (provider === 'DPMD') return '#ff8080';
    if (provider === 'DPMP') return '#ff8080';
    if (provider === 'DPMLB') return '#ff8080';
    if (provider === 'TSMK') return '#ff8080';
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
                tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=cb1_3jz6_1_06d33734b1cc4458e25cfa01'], 
                tileSize: 256 
            } 
        },
        layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }]
    },
    center: [startLng, startLat], 
    zoom: startZoom,
    maxZoom: 19,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    fadeDuration: 0,
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
// Ikony se kreslí až ve chvíli, kdy si je mapa opravdu vyžádá (styleimagemissing),
// takže se neplýtvá časem ani pamětí na vozidla mimo výřez.
const MAX_CACHED_ICONS = 800;
const ICON_SIZE = 44;
const iconSpecs = new Map();
const iconCanvas = document.createElement('canvas');
iconCanvas.width = ICON_SIZE * 2;
iconCanvas.height = ICON_SIZE * 2;
const iconCtx = iconCanvas.getContext('2d', { willReadFrequently: true });
const arrowPath = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");

function getOrCreateIcon(map, provider, routeText, heading) {
    const isCircle = heading === null || heading === undefined;
    // Zaokrouhlení azimutu, aby se negenerovalo zbytečně moc obrázků a RAM zůstala čistá
    const safeHeading = isCircle ? 0 : (Math.round(heading / 10) * 10) % 360;
    const iconId = `veh-${provider}-${routeText}-${isCircle ? 'c' : safeHeading}`;

    if (!iconSpecs.has(iconId)) iconSpecs.set(iconId, { provider, routeText, isCircle, safeHeading });
    return iconId;
}

function drawIcon(iconId) {
    const spec = iconSpecs.get(iconId);
    if (!spec || map.hasImage(iconId)) return;

    const ctx = iconCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
    ctx.scale(2, 2); ctx.translate(ICON_SIZE / 2, ICON_SIZE / 2);

    const fillColor = getProviderColor(spec.provider);

    ctx.save();
    if (!spec.isCircle) {
        // Rotujeme pouze šipku vůči Canvasu
        ctx.rotate(spec.safeHeading * Math.PI / 180);
        ctx.scale(1.4, 1.4); ctx.translate(-11, -15.5);
        ctx.fillStyle = fillColor; ctx.fill(arrowPath);
    } else {
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, 2 * Math.PI);
        ctx.fillStyle = fillColor; ctx.fill();
    }
    ctx.restore();

    // Text zůstává vodorovně vzhledem k obrázku
    if (spec.routeText) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(spec.routeText, 0, 0);
        ctx.fillStyle = '#FFFFFF'; ctx.fillText(spec.routeText, 0, 0);
    }

    map.addImage(iconId, ctx.getImageData(0, 0, iconCanvas.width, iconCanvas.height), { pixelRatio: 2 });
}

map.on('styleimagemissing', e => drawIcon(e.id));

function evictUnusedIcons(usedIconIds) {
    const images = map.listImages();
    if (images.length <= MAX_CACHED_ICONS) return;
    for (const id of images) {
        if (id.startsWith('veh-') && !usedIconIds.has(id)) map.removeImage(id);
    }
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    map.addSource('selected-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'selected-route-layer', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e67e22', 'line-width': 4, 'line-opacity': 0.8 } });

    map.addSource('vehicles', { type: 'geojson', maxzoom: 12, data: { type: 'FeatureCollection', features: [] } });
    
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

        const features = map.queryRenderedFeatures(bbox, { layers: ['vehicles-layer'] })
            .map(f => ({ ...f, properties: hydrateProps(f.properties) }));

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

    refreshAll();
    setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) refreshAll();
    });
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
        
        // 1. NEJPRVE stáhneme detaily (Tyto přijdou čistě z IDSOK)
        const details = providerObj.getDetails ? await providerObj.getDetails(props.id, parsedAttributes) : null;
        
        // 2. POTOM stáhneme trasu s možností podvrhnutí z IDS JMK
        let routeCoordinates = null;
        
        // Zkusíme se podívat do naší tajné paměti, jestli IDSOK nemá IDS JMK dvojče
        const twinJmkVehicle = jmkTwinsCache.get(props.id);
        
        if (twinJmkVehicle) {
            const jmkProviderObj = providers.find(p => p.providerName === 'IDS JMK');
            if (jmkProviderObj && jmkProviderObj.getRouteInfo) {
                try {
                    // Podvrhneme stahování trasy! Posíláme ID a atributy toho smazaného JMK vozidla.
                    // Null předáváme pro details, protože JMK provider si je pro trasu umí případně stáhnout sám (nebo je nepotřebuje).
                    routeCoordinates = await jmkProviderObj.getRouteInfo(twinJmkVehicle.id, twinJmkVehicle.attributes, null);
                } catch (e) {
                    console.warn("Nepodařilo se stáhnout IDS JMK trasu pro sdílené IDSOK vozidlo.", e);
                }
            }
        }
        
        // 3. FALLBACK NA IDSOK TRASU
        // Pokud dvojče neexistuje, nebo IDS JMK selhalo či vrátilo prázdnou/nullovou trasu:
        if (!routeCoordinates || routeCoordinates.length === 0) {
            routeCoordinates = providerObj.getRouteInfo ? await providerObj.getRouteInfo(props.id, parsedAttributes, details) : null;
        }
        
        if (routeCoordinates && routeCoordinates.length > 0) {
            // Trasa může mít kromě hlavní čáry i odbočky (závleky)
            const isMultiLine = Array.isArray(routeCoordinates[0][0]);
            map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: isMultiLine ? 'MultiLineString' : 'LineString', coordinates: routeCoordinates } });
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
        titleHtml += ` <span style="font-size: 11px; background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; font-weight: bold;">Odklon</span>`;
    } else if (d.isOffline) {
        titleHtml += `<span style="font-size: 11px; background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; font-weight: bold;">Odhad polohy</span>`;
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
            
            // --- OPRAVA SMYČKY: Místo celkového stahování updateData() upravíme vrstvu jen v mapě! ---
            // Tím se vyhneme nekonečné smyčce a ušetříme server
            const featuresSource = map.getSource('vehicles');
            if (featuresSource) {
                // Přegenerujeme ikonku jen pro toto jediné vozidlo, aby přišlo o šipku
                activeTrainData.props.iconId = getOrCreateIcon(map, activeTrainData.props.provider, activeTrainData.props.route, null);
                
                // Mírný hack pro MapLibre - donutíme data v source se překreslit s novou ikonkou
                const currentData = featuresSource._data;
                const featureIndex = currentData.features.findIndex(f => f.properties.id === activeTrainData.props.id);
                if (featureIndex > -1) {
                    currentData.features[featureIndex].properties.iconId = activeTrainData.props.iconId;
                    featuresSource.setData(currentData);
                }
            }
        }
    } else if (String(d.delay).startsWith('-')) {
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

    document.getElementById('show-timetable-btn').addEventListener('click', () => switchToTimetable(false));
}

async function switchToTimetable(isSilent = false) {
    
    // Pro absolutní jistotu – pokud náhodou isSilent přesto není boolean, uděláme z něj false
    if (typeof isSilent !== 'boolean') {
        isSilent = false;
    }

    isTimetableOpen = true;
    updateURL();

    // Pokud to NENÍ tichý update na pozadí, ukážeme načítání
    if (!isSilent) {
        panelBody.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Načítám jízdní řád...</div>`;
    }
    
    const p = activeTrainData.props;
    const d = activeTrainData.details;
    const providerObj = providers.find(prov => prov.providerName === p.provider);

    // Pokud NENÍ JŘ v paměti (nebo to není tichý update, který ho už dodal), tak ho stáhneme
    if (!activeTrainData.timetable && providerObj && providerObj.getTimetable) {
        let parsedAttributes = null;
        if (p.attributes) {
            try { parsedAttributes = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : p.attributes; } 
            catch (e) { parsedAttributes = p.attributes; }
        }
        activeTrainData.timetable = await providerObj.getTimetable(p.id, parsedAttributes, d);
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
    } else if (String(d.delay).startsWith('-')) {
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

    if (!isSilent) {
        setTimeout(() => {
            const currentRow = document.getElementById('current-stop-row');
            const scrollContainer = document.getElementById('tt-scroll-container');
            
            if (currentRow && scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const rowRect = currentRow.getBoundingClientRect();
                const offset = (rowRect.top - containerRect.top) - (containerRect.height / 2) + (rowRect.height / 2);
                
                scrollContainer.scrollBy({ top: offset, behavior: 'smooth' });
            }
        }, 150);
    }
}

async function silentUpdateDetail(props) {
    // Pokud uživatel okno mezitím zavřel, zastavíme to
    if (!detailPanel.classList.contains('open')) return; 

    const providerObj = providers.find(p => p.providerName === props.provider);
    if (!providerObj) return;

    let parsedAttributes = null;
    if (props.attributes) {
        try { parsedAttributes = typeof props.attributes === 'string' ? JSON.parse(props.attributes) : props.attributes; } 
        catch (e) { parsedAttributes = props.attributes; }
    }

    // 1. Tichý zisk nových detailů ze sítě
    const details = providerObj.getDetails ? await providerObj.getDetails(props.id, parsedAttributes) : null;
    
    // Pokud okno stále svítí a data přišla, aplikujeme je
    if (details && detailPanel.classList.contains('open')) {
        activeTrainData.props = props;
        activeTrainData.details = details;
        
        if (isTimetableOpen) {
            // Pokud koukáme na JŘ, musíme ho potichu stáhnout znovu (změna zpoždění na trase)
            if (providerObj.getTimetable) {
                activeTrainData.timetable = await providerObj.getTimetable(props.id, parsedAttributes, details);
                
                // ULOŽENÍ POSUVNÍKU: Podíváme se, jak nízko máš odscrollováno
                const scrollContainer = document.getElementById('tt-scroll-container');
                const currentScroll = scrollContainer ? scrollContainer.scrollTop : 0;
                
                // Překreslíme JŘ potichu
                await switchToTimetable(true); 
                
                // OBNOVA POSUVNÍKU: Vrátíme tě přesně tam, kde jsi byl!
                const newScrollContainer = document.getElementById('tt-scroll-container');
                if (newScrollContainer) newScrollContainer.scrollTop = currentScroll;
            }
        } else {
            // Hladké překreslení tabulky detailů
            renderDetailView(); 
        }
    }
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

// --- AKTUALIZACE POLOH ---
// Každý zdroj se stahuje samostatně a vozidla se ukážou hned, jak dorazí, takže
// pomalý nebo nedostupný zdroj nezdrží ostatní. Dokud předchozí dotaz na zdroj
// běží, další se neposílá, a na pomalém připojení se tak dotazy nehromadí.
const REFRESH_INTERVAL_MS = 15000;
const STALE_PROVIDER_MS = 120000; // Tak dlouho držíme poslední polohy zdroje, který nic nevrátil
const MIN_RENDER_GAP_MS = 1000;

const providerStates = new Map(providers.map(p => [p, { vehicles: [], receivedAt: 0, inFlight: false }]));
const vehicleIndex = new Map();
let lastRefreshAt = 0;
let lastRenderAt = 0;
let renderTimer = null;
let lastFeatureSignature = null;

const vehicleKey = (v) => `${v.provider}|${v.id}`;

// Mapa dostává jen to, co potřebuje ke kreslení. Zbytek se doplní až po kliknutí.
function hydrateProps(featureProps) {
    const v = vehicleIndex.get(featureProps.key);
    if (!v) return featureProps;
    const props = { ...v, iconId: featureProps.iconId, sortKey: featureProps.sortKey };
    if (props.attributes) props.attributes = JSON.stringify(props.attributes);
    return props;
}

function refreshAll() {
    lastRefreshAt = Date.now();
    providers.forEach(refreshProvider);
    updateStatus();
    if (isUserLocationActive) updateUserLocation(false);
}

async function refreshProvider(provider) {
    const state = providerStates.get(provider);
    if (state.inFlight) return;
    state.inFlight = true;

    try {
        const vehicles = await provider.fetchData();
        // Prázdný výsledek často znamená výpadek, proto vozidla nezmizí hned
        if (vehicles.length > 0 || Date.now() - state.receivedAt > STALE_PROVIDER_MS) {
            state.vehicles = vehicles;
            state.receivedAt = Date.now();
        }
    } catch (err) {
        console.warn(`Aktualizace zdroje ${provider.providerName} selhala.`, err);
    } finally {
        state.inFlight = false;
    }

    scheduleRender();
    if (activeTrainData.props && activeTrainData.props.provider === provider.providerName) {
        pendingDetailRefresh = true;
    }
}

let pendingDetailRefresh = false;

function scheduleRender() {
    if (renderTimer) return;
    const wait = Math.max(50, MIN_RENDER_GAP_MS - (Date.now() - lastRenderAt));
    renderTimer = setTimeout(() => {
        renderTimer = null;
        lastRenderAt = Date.now();
        try {
            renderVehicles();
        } catch (err) {
            console.error(err);
            statusDiv.innerText = "Chyba při zpracování dat.";
        }
    }, wait);
}

function updateStatus() {
    const loading = [...providerStates.values()].some(s => s.inFlight);
    const count = vehicleIndex.size;
    if (count === 0) statusDiv.innerText = loading ? 'Načítám data...' : 'Žádné spoje k zobrazení.';
    else statusDiv.innerText = `Spojů na mapě: ${count}${loading ? ' (aktualizuji...)' : ''}`;
}

function collectVehicles() {
    const allVehicles = [];
    for (const state of providerStates.values()) {
        for (const v of state.vehicles) {
            v._isJmkTwin = false;
            allVehicles.push(v);
        }
    }
    return allVehicles;
}

function matchJmkTwins(allVehicles) {
    jmkTwinsCache.clear();

    const jmkByRoute = new Map();
    allVehicles.forEach(v => {
        if (v.provider !== 'IDS JMK') return;
        const route = String(v.route).replace(/\D/g, '');
        if (!jmkByRoute.has(route)) jmkByRoute.set(route, []);
        jmkByRoute.get(route).push(v);
    });

    const extractEndNumber = (value) => {
        const match = String(value || "").match(/(\d+)$/);
        return match ? parseInt(match[1], 10).toString() : null;
    };

    allVehicles.forEach(idsokV => {
        if (idsokV.provider !== 'IDSOK') return;
        const idsokRouteShort = String(idsokV.route).replace(/\D/g, '');
        const idsokRouteFull = String(idsokV.attributes?.cisjrLine || "").replace(/\D/g, '');
        const idsokRun = parseInt(String(idsokV.attributes?.cisjrRun).replace(/\D/g, ''), 10).toString();

        const candidates = (jmkByRoute.get(idsokRouteShort) || []).concat(
            idsokRouteFull !== idsokRouteShort ? (jmkByRoute.get(idsokRouteFull) || []) : []
        );
        const twin = candidates.find(jmkV => {
            const a = jmkV.attributes;
            return [a?.RouteID, a?.runNumber, a?.spoj, a?.kmenovySpoj, jmkV.id].map(extractEndNumber).includes(idsokRun);
        });

        if (twin) {
            jmkTwinsCache.set(idsokV.id, twin);
            twin._isJmkTwin = true;
        }
    });
}

function renderVehicles() {
    let allVehicles = collectVehicles();

    // --- 1. SBĚR DAT PRO KŘÍŽOVÉ FILTRY ---
    const pidFullLines = new Set();
    const pidFullConnections = new Set();
    const iredoFullLines = new Set();
    const ideskaFullLines = new Set();

    allVehicles.forEach(v => {
        // PŘEKLAD KRÁTKÉ DÚK LINKY NA 6MÍSTNOU CISJR (vozidlo se vykresluje opakovaně, překládáme jen jednou)
        if (v.provider === 'DÚK' && v.attributes && v.attributes.cisjrLine && v.attributes.cisjrRun && !v.attributes.cisjrFullLine) {
            const cLine = String(v.attributes.cisjrLine).trim();
            const cRun = String(v.attributes.cisjrRun).trim();
            const translation = dukDict[`${cLine}_${cRun}`] || dukDict[`${cLine.padStart(3, '0')}_${cRun}`];

            if (translation) {
                const [fullLine, fullRun] = translation.split('_');

                // Původní 3místná linka žije dál, vytvoříme nový parametr FullLine
                v.attributes.cisjrFullLine = fullLine;
                v.attributes.cisjrRun = fullRun;
                v.globalMatchId = `duk_${fullLine}_${fullRun}`;
            }
        }

        // Extrakce PID
        if (v.provider === 'PID' && v.attributes) {
            const pLineShort = String(v.route || v.attributes.text || "").trim();
            if (pLineShort) {
                pidFullLines.add(pLineShort);
            }

            // 2. Extrakce šestimístné linky a čísla spoje
            const pLineLong = v.attributes.cisjrLine;
            const pTrip = v.attributes.cisjrTrip;

            if (pLineLong) {
                const cleanLine = String(pLineLong).trim();
                
                // ZÁCHRANA PRO VDV: Přidáme i šestimístnou linku (např. "261467") do sítě!
                pidFullLines.add(cleanLine);
                
                if (pTrip) {
                    const cleanTrip = String(pTrip).replace(/^0+/, '').trim() || "0";
                    // TOTO SLOUŽÍ PRO SMAZÁNÍ DÚK:
                    pidFullConnections.add(`${cleanLine}_${cleanTrip}`);
                }
            }
        }
        
        // Extrakce IDESKA: IDPK a VDV čísla spoje hned nemají, proto porovnáváme jen šestimístnou linku
        if (v.provider === 'IDESKA' && /^\d{6}$/.test(v.attributes?.line || '')) {
            ideskaFullLines.add(v.attributes.line);
        }

        // Extrakce IREDO
        if (v.provider === 'IREDO' && v.attributes && v.attributes.cisjrLine) {
            iredoFullLines.add(v.attributes.cisjrLine);
        }
    });

    // --- 2. CHYTRÉ PÁROVÁNÍ IDSOK A IDS JMK (Fuzzy Match) ---
    matchJmkTwins(allVehicles);

    // --- 3. APLIKACE FILTRŮ (Vymazání slabších zdrojů) ---
    allVehicles = allVehicles.filter(v => {
        if (v._isJmkTwin) return false; 

        // IDESKA zničí stejnou šestimístnou linku v IDPK a VDV
        if (v.provider === 'VDV' && ideskaFullLines.has(String(v.attributes?.text || '').trim())) return false;
        if (v.provider === 'IDPK' && ideskaFullLines.has(String(v.attributes?.fullLine || '').trim())) return false;

        if (v.provider === 'VDV') {
            if (v.attributes && v.attributes.text) {
                if (pidFullLines.has(v.attributes.text) || iredoFullLines.has(v.attributes.text)) {
                    return false; 
                }
            }
        }
        if (v.provider === 'IREDO') {
            const matchId = `${v.attributes.cisjrLine}_${v.attributes.cisjrRun}`;
            if (pidFullConnections.has(matchId)) {
                return false;
            }
        }
        // PID zničí dublující se DÚK spoj
        if (v.provider === 'DÚK') {
            if (v.attributes.cisjrFullLine) {
                const dLine = String(v.attributes.cisjrFullLine).trim();
                const dRun = String(v.attributes.cisjrRun || "").replace(/^0+/, '').trim() || "0";
                
                // Sestaví identifikátor např. "270430_1016"
                const matchId = `${dLine}_${dRun}`;
                
                if (pidFullConnections.has(matchId)) {
                    return false; 
                }
            }
            return true;
        }

        // PID zničí dublující se IDPK linky
        if (v.provider === 'IDPK') {
            // V.route u IDPK je díky ořezání z minula vždy krátké číslo (např. "467")
            const shortLine = String(v.route).trim();
            
            // Pokud PID vysílá linku stejného jména, IDPK autobus úplně zahodíme
            if (pidFullLines.has(shortLine)) {
                return false;
            }
        }
        
        return true;
    });

    deduplicator.processData(allVehicles);
    const cleanData = deduplicator.getCleanData();

    vehicleIndex.clear();
    const usedIconIds = new Set();
    const signatureParts = [];

    const features = cleanData
        .filter(v => v.lat !== undefined && v.lon !== undefined && v.lat !== null && v.lon !== null)
        .map(v => {
            const key = vehicleKey(v);
            const iconId = getOrCreateIcon(map, v.provider, v.route, v.heading);
            vehicleIndex.set(key, v);
            usedIconIds.add(iconId);
            signatureParts.push(key, v.lon, v.lat, iconId);

                // --- MATEMATIKA PRO DOKONALÉ PŘEKRÝVÁNÍ (Z-INDEX) ---
                const zIndexBase = { 
                    'GRAPP': 9000, 
                    'IDS JMK': 8000, 
                    'PID': 7000, 
                    'IREDO': 3000,
                    'IDSOK': 2900,
                    'DÚK': 2800,
                    'IDOL': 2700,
                    'IDZK': 2600,
                    'ODIS': 2500,
                    'IDESKA': 2400,
                    'IDOK': 2300,
                    'PMDP': 2200,
                    'TSHB': 2100,
                    'DPMD': 2050,
                    'DPMP': 2040,
                    'DPMLB': 2030,
                    'TSMK': 2020,
                    'IDPK': 2000,
                    'VDV': 1000 
                }[v.provider] || 0;
                const sortKey = zIndexBase + Math.round((52 - v.lat) * 10000);

            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                properties: { key, id: v.id, iconId, sortKey }
            };
        });

    // Beze změny poloh není důvod nechat mapu přepočítávat celou vrstvu
    const signature = signatureParts.join(',');
    if (signature !== lastFeatureSignature) {
        lastFeatureSignature = signature;
        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        evictUnusedIcons(usedIconIds);
    }
    updateStatus();

    if (targetVehicleId && !initialClickDone) {
        const target = cleanData.find(v => {
            let matchId = v.id;
            if (v.provider === 'GRAPP' && v.globalMatchId) matchId = v.globalMatchId.replace(/ /g, '_');
            else if (v.text) matchId = v.text.replace(/\//g, '_').replace(/ /g, '_');
            else if (v.route && v.runNumber) matchId = `${v.route}_${v.runNumber}`;
            return matchId === targetVehicleId;
        });

        if (target) {
            initialClickDone = true;
            openVehicleDetail(hydrateProps({ key: vehicleKey(target) }));
        }
    }

    if (pendingDetailRefresh && activeTrainData.props && detailPanel.classList.contains('open')) {
        pendingDetailRefresh = false;
        const updated = vehicleIndex.get(vehicleKey(activeTrainData.props));
        if (updated) silentUpdateDetail(hydrateProps({ key: vehicleKey(updated) }));
    }
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
