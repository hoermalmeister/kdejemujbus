import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';
// Později přidáš: import PidProvider from './providers/PidProvider.js';

// Inicializace mapy přesně jako v tvém VDV projektu
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
    center: [15.6, 49.4], // Střed ČR
    zoom: 7,
    maxZoom: 19
});

// Založíme si naše "nástroje"
const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

// Po načtení mapy přidáme prázdnou vrstvu pro vozidla
map.on('load', () => {
    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // Zde bys použil své dynamické ikonky jako ve VDV (getVehicleIcon)
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'circle', // Pro test zatím použijeme kolečka, později si nasadíš své symboly
        source: 'vehicles', 
        paint: { 
            'circle-radius': 6, 
            'circle-color': '#ff4d4d',
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2
        } 
    });

    // Spustíme nekonečnou smyčku
    updateData();
    setInterval(updateData, 15000);
});

// Tímto nahrazujeme tvou původní obří funkci fetchLiveVehicles()
async function updateData() {
    // 1. Řekneme všem 20 providerům: "Stáhněte si svá data nezávisle na sobě"
    const fetchPromises = providers.map(p => p.fetchData());
    const results = await Promise.allSettled(fetchPromises);
    
    let allVehicles = [];
    
    // 2. Sesypeme všechno do jedné hromady
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            allVehicles = allVehicles.concat(result.value);
        }
    });

    // 3. Necháme chytrý deduplikátor vyházet duplicity a seřadit priority
    deduplicator.processData(allVehicles);
    const cleanData = deduplicator.getCleanData();

    // 4. Připravíme GeoJSON pro MapLibre (přesně jak jsi zvyklý)
    const features = cleanData.map(v => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
        properties: v // Tady v.headsign, v.provider, v.delay atd.
    }));

    // 5. Překreslíme mapu
    map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
    
    // Zde bys např. updatoval UI čítač spojů
    console.log(`Vykresleno spojů: ${features.length}`);
}
