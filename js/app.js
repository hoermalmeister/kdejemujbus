import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

// Inicializace MapLibre mapy
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: { 
            'carto-dark': { 
                type: 'raster', 
                tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], 
                tileSize: 256 
            } 
        },
        layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }]
    },
    center: [15.4730, 49.8175], // Střed ČR
    zoom: 7,
    maxZoom: 19
});

map.on('load', () => {
    // Zdroj dat pro spoje
    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // Vykreslovací vrstva (zatím jednoduché červené body, později přidáš své ikonky z VDV)
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'circle',
        source: 'vehicles', 
        paint: { 
            'circle-radius': 6, 
            'circle-color': '#ff4d4d',
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2
        } 
    });

    // Spustíme stahování dat
    updateData();
    setInterval(updateData, 15000);
});

async function updateData() {
    try {
        const fetchPromises = providers.map(p => p.fetchData());
        const results = await Promise.allSettled(fetchPromises);
        
        let allVehicles = [];
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                allVehicles = allVehicles.concat(result.value);
            }
        });

        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        // Převod našich dat na formát GeoJSON pro MapLibre
        const features = cleanData.map(v => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
            properties: v
        }));

        // Aktualizace dat v mapě
        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;
    } catch (err) {
        console.error("Chyba:", err);
        statusDiv.innerText = "Chyba při načítání dat.";
    }
}
