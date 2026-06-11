import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

// --- INICIALIZACE MAPY (Deck.gl + MapLibre) ---
// Používáme globální objekt 'deck' z HTML skriptu
const { DeckGL, ScatterplotLayer } = deck;

const map = new DeckGL({
    container: 'map',
    initialViewState: {
        longitude: 15.4730, // Střed ČR
        latitude: 49.8175,
        zoom: 7,
        pitch: 0,
        bearing: 0
    },
    controller: true,
    // Veřejná Carto podkladová mapa (tmavý režim)
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    layers: [] // Sem budeme cpát data
});

// --- FUNKCE PRO VYKRESLENÍ ---
function renderMap(dataForMap) {
    // Vytvoříme novou WebGL vrstvu s našimi spoji
    const vehicleLayer = new ScatterplotLayer({
        id: 'vehicles-layer',
        data: dataForMap,
        pickable: true,
        opacity: 0.8,
        stroked: true,
        filled: true,
        radiusScale: 6,
        radiusMinPixels: 4,
        radiusMaxPixels: 15,
        lineWidthMinPixels: 1,
        // Kde se má bod vykreslit (deck.gl bere [lon, lat])
        getPosition: d => [d.lon, d.lat],
        // Barva bodu (RGBA) - dáme jim pěknou červenou
        getFillColor: d => [255, 50, 50, 200],
        getLineColor: d => [255, 255, 255],
        // Tooltip při najetí myší
        onClick: (info) => {
            if(info.object) {
                alert(`Spoj: ${info.object.headsign}\nZdroj: ${info.object.provider}`);
            }
        }
    });

    // Aktualizujeme mapu s novou vrstvou
    map.setProps({
        layers: [vehicleLayer]
    });
}

// --- HLAVNÍ SMYČKA ---
async function updateData() {
    try {
        // Asynchronní stažení dat
        const fetchPromises = providers.map(p => p.fetchData());
        const results = await Promise.allSettled(fetchPromises);
        
        let allVehicles = [];
        
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                allVehicles = allVehicles.concat(result.value);
            }
        });

        // Deduplikace a vyčištění
        deduplicator.processData(allVehicles);
        const finalData = deduplicator.getCleanData();

        statusDiv.innerText = `Spojů na mapě: ${finalData.length}\nZdroj: GRAPP (CORS Proxy)`;
        
        // Zavoláme WebGL vykreslení!
        renderMap(finalData);

    } catch (err) {
        console.error("Kritická chyba v hlavní smyčce:", err);
        statusDiv.innerText = "Chyba při načítání dat. Zkontroluj F12 Console.";
    }
}

// Spustíme hned a opakujeme každých 15 vteřin
updateData();
setInterval(updateData, 15000);
