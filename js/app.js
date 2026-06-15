import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

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

    // --- KLIKNUTÍ NA VOZIDLO ---
    map.on('click', 'vehicles-layer', async (e) => {
        const feature = e.features[0];
        const props = feature.properties; 

        if (window.currentPopup) window.currentPopup.remove();
        map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

        window.currentPopup = new maplibregl.Popup({ closeButton: true })
            .setLngLat(feature.geometry.coordinates)
            .setHTML(`<div style="padding: 15px; font-family: sans-serif;">Stahuji detaily...</div>`)
            .addTo(map);

        window.currentPopup.on('close', () => {
            map.getSource('selected-route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
        });

        const providerObj = providers.find(p => p.providerName === props.provider);
        if (providerObj) {
            const [details, routeCoordinates] = await Promise.all([
                providerObj.getDetails ? providerObj.getDetails(props.id) : null,
                providerObj.getRouteInfo ? providerObj.getRouteInfo(props.id) : null
            ]);
            
            if (routeCoordinates && routeCoordinates.length > 0) {
                map.getSource('selected-route').setData({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: routeCoordinates }
                });
            }

            if (details) {
                window.currentPopup.setHTML(`
                    <div style="font-family: sans-serif; min-width: 240px; max-height: 380px; display: flex; flex-direction: column;">
                        <h3 style="margin: 0 0 10px 0; border-bottom: 2px solid ${props.provider === 'GRAPP' ? '#800000' : '#2C89C8'}; padding-bottom: 5px;">
                            ${details.route}
                        </h3>
                        <table style="width: 100%; text-align: left; font-size: 13px; border-collapse: collapse; margin-bottom: 10px;">
                            <tr><th style="padding: 4px 0; width: 40%;">Směr:</th><td>${details.destination}</td></tr>
                            <tr><th style="padding: 4px 0;">Zastávka:</th><td>${details.stop}</td></tr>
                            <tr><th style="padding: 4px 0;">Zpoždění:</th><td><strong style="color: #e67e22;">${details.delay}</strong></td></tr>
                            <tr><th style="padding: 4px 0;">Dopravce:</th><td>${details.carrier}</td></tr>
                        </table>
                        
                        <button id="btn-timetable" data-id="${props.id}" style="width: 100%; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;">
                            Jízdní řád
                        </button>

                        <div id="timetable-container" style="display: none; max-height: 180px; overflow-y: auto; margin-top: 10px; border-top: 1px solid #ccc; padding-top: 10px;">
                        </div>
                    </div>
                `);

                // Navážeme událost kliknutí na nově vytvořené tlačítko
                document.getElementById('btn-timetable').addEventListener('click', async (btnEvent) => {
                    const button = btnEvent.target;
                    const trainId = button.getAttribute('data-id');
                    const container = document.getElementById('timetable-container');

                    // Pokud už je otevřený, zavřeme ho
                    if (container.style.display === 'block') {
                        container.style.display = 'none';
                        button.innerText = 'Jízdní řád';
                        return;
                    }

                    button.innerText = 'Načítám...';
                    button.disabled = true;

                    const timetableData = await providerObj.getTimetable(trainId);
                    
                    if (timetableData && timetableData.length > 0) {
                        let htmlRows = timetableData.map(stop => `
                            <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 1px dashed #eee;">
                                <span style="font-weight: 500; max-width: 65%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stop.station}</span>
                                <span style="color: #555; font-family: monospace;">${stop.time}</span>
                            </div>
                        `).join('');

                        container.innerHTML = htmlRows;
                        container.style.display = 'block';
                        button.innerText = 'Skrýt jízdní řád';
                    } else {
                        container.innerHTML = '<div style="font-size: 12px; color: red; text-align: center;">Jízdní řád není dostupný</div>';
                        container.style.display = 'block';
                        button.innerText = 'Jízdní řád';
                    }
                    button.disabled = false;
                });

            } else {
                window.currentPopup.setHTML(`<div style="padding: 15px; font-family: sans-serif; color: red;">Chyba při načítání detailů.</div>`);
            }
        }
    });

    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    updateData();
    setInterval(updateData, 15000);
});

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
        console.error("Kritická chyba ve smyčce:", err);
        statusDiv.innerText = "Chyba při načítání dat.";
    }
}
