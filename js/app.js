import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

// Inicializace našich tříd
const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
    // Později sem jednoduše přidáš např. new PidProvider()
];

const statusDiv = document.getElementById('status');

// --- INICIALIZACE MAPY (MapLibre) ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        // TUTO ŘÁDKU JSME PŘIDALI: Říká mapě, odkud má stahovat písmo pro čísla spojů
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
    center: [15.4730, 49.8175], // Střed ČR
    zoom: 7,
    maxZoom: 19
});

// --- FUNKCE PRO GENEROVÁNÍ SVG UKAZATELŮ ---
function createTriangleIcon(map, id, fillColor, strokeColor) {
    if (map.hasImage(id)) return;
    
    const size = 26; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; 
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    // Scale pro ostřejší zobrazení (Retina displeje)
    ctx.scale(2, 2); 
    
    // Vycentrování těžiště rotace
    ctx.translate(size/2 - 11, size/2 - 12.65);

    // Využití tvé SVG cesty pro ukazatel
    const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
    
    ctx.fillStyle = fillColor;
    ctx.fill(path);
    ctx.lineWidth = 1;
    ctx.strokeStyle = strokeColor;
    ctx.stroke(path);

    map.addImage(id, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    // 1. Vygenerujeme si ikony pro různé dopravce
    createTriangleIcon(map, 'triangle-grapp', '#800000', '#E0E0E0'); // Tmavě červená SŽ
    createTriangleIcon(map, 'triangle-pid', '#2C89C8', '#E0E0E0');   // Modrá PID
    createTriangleIcon(map, 'triangle-unknown', '#7f8c8d', '#E0E0E0'); // Šedá (ostatní)

    // 2. Přidáme datový zdroj pro vozidla
    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // 3. Hlavní vrstva (kombinuje Ikonu a Text)
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 
            // Vykreslení ikony trojúhelníku
            'icon-image': ['get', 'iconId'], 
            'icon-rotate': ['coalesce', ['get', 'heading'], 0], // Rotace podle azimutu
            'icon-rotation-alignment': 'map', // Rotuje společně s mapou vůči severu
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,

            // Vykreslení textu (číslo vlaku/linky) přes ikonu
            'text-field': ['get', 'route'], 
            'text-size': 9,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-rotation-alignment': 'viewport', // Text je vždy čitelný (nerotuje)
            'text-offset': [0, 0.15] // Lehký posun do těžiště trojúhelníku
        },
        paint: {
            'text-color': '#FFFFFF',
            'text-halo-color': 'rgba(0,0,0,0.4)', // Jemný stín pro lepší čitelnost
            'text-halo-width': 1
        } 
    });

    // Přidáme kurzor ručičky při najetí na spoj
    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    // Spuštění datové smyčky
    updateData();
    setInterval(updateData, 15000);
});

// --- HLAVNÍ DATOVÁ SMYČKA ---
async function updateData() {
    try {
        statusDiv.innerText = 'Aktualizuji data...';

        // 1. Asynchronně stáhneme data ze všech zdrojů najednou
        const fetchPromises = providers.map(p => p.fetchData());
        const results = await Promise.allSettled(fetchPromises);
        
        let allVehicles = [];
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                allVehicles = allVehicles.concat(result.value);
            }
        });

        // 2. Provedeme deduplikaci a setřídění priorit
        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        // 3. Převod na formát GeoJSON a přiřazení barvy ikony
        const features = cleanData.map(v => {
            // Dynamické přiřazení ikony podle zdroje
            let assignedIcon = 'triangle-unknown';
            if (v.provider === 'GRAPP') assignedIcon = 'triangle-grapp';
            if (v.provider === 'PID') assignedIcon = 'triangle-pid';

            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                properties: {
                    ...v,
                    iconId: assignedIcon // Předáme ID grafiky mapě
                }
            };
        });

        // 4. Překreslení mapy
        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;

    } catch (err) {
        console.error("Kritická chyba ve smyčce:", err);
        statusDiv.innerText = "Chyba při načítání dat.";
    }
}
