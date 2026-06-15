import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
];

const statusDiv = document.getElementById('status');

// --- INICIALIZACE MAPY (MapLibre) ---
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

// --- FUNKCE PRO GENEROVÁNÍ SVG UKAZATELŮ ---

// 1. Ukazatel se směrem (Trojúhelník) - ZVĚTŠENÝ
function createTriangleIcon(map, id, fillColor) {
    if (map.hasImage(id)) return;
    
    // Zvětšili jsme plátno, aby se do něj vešel větší tvar
    const size = 40; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); // Optimalizace pro jemné Retina displeje
    
    // Posuneme se do naprostého středu plátna
    ctx.translate(20, 20);
    // Zvětšíme samotnou grafiku o 30 %
    ctx.scale(1.3, 1.3);
    // Vycentrujeme SVG (těžiště tvé šipky je X:11, Y:15.5)
    ctx.translate(-11, -15.5);

    const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
    ctx.fillStyle = fillColor;
    
    // ZDE BYLA CHYBA: Chybělo slovo 'path', proto se šipky nevybarvovaly!
    ctx.fill(path); 

    map.addImage(id, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
}

// 2. Ukazatel bez směru (Kruh) - ZVĚTŠENÝ
function createCircleIcon(map, id, fillColor) {
    if (map.hasImage(id)) return;
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2);
    ctx.beginPath();
    // Střed přesně na 20, 20, a větší poloměr (11), aby seděl k větším šipkám
    ctx.arc(20, 20, 11, 0, 2 * Math.PI);
    ctx.fillStyle = fillColor;
    ctx.fill();

    map.addImage(id, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    // Generování šipek 
    createTriangleIcon(map, 'triangle-grapp', '#800000'); 
    createTriangleIcon(map, 'triangle-pid', '#2C89C8');   
    createTriangleIcon(map, 'triangle-unknown', '#7f8c8d'); 

    // Generování kruhů 
    createCircleIcon(map, 'circle-grapp', '#800000'); 
    createCircleIcon(map, 'circle-pid', '#2C89C8');   
    createCircleIcon(map, 'circle-unknown', '#7f8c8d'); 

    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // JEDNA SPOLEČNÁ VRSTVA PRO VŠE - Ikona a Text jsou jeden nedělitelný objekt!
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 
            // --- IKONA ---
            'icon-image': ['get', 'iconId'], 
            'icon-rotate': ['coalesce', ['get', 'heading'], 0], 
            'icon-rotation-alignment': 'map', 
            // Důležité: Ikony se mohou překrývat (nikdy nezmizí)
            'icon-allow-overlap': true, 
            'icon-ignore-placement': true,

            // --- TEXT ---
            'text-field': ['get', 'route'], 
            'text-size': 11, 
            'text-rotation-alignment': 'viewport',
            // Důležité: Texty se mohou překrývat (nikdy nezmizí nezávisle na ikoně)
            'text-allow-overlap': true, 
            'text-ignore-placement': true
        },
        paint: {
            'text-color': '#FFFFFF',
            // Zvětšený stín plně nahrazuje 'bold' font, zajistí perfektní čitelnost i přes sebe
            'text-halo-color': 'rgba(0,0,0,0.85)', 
            'text-halo-width': 1.5 
        } 
    });

    // Interakce myši
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
            if (result.status === 'fulfilled') {
                allVehicles = allVehicles.concat(result.value);
            }
        });

        deduplicator.processData(allVehicles);
        const cleanData = deduplicator.getCleanData();

        const features = cleanData
            .filter(v => v.lat !== undefined && v.lon !== undefined && v.lat !== null && v.lon !== null)
            .map(v => {
                // Zjistíme zdroj pro barvu
                let sourceBase = 'unknown';
                if (v.provider === 'GRAPP') sourceBase = 'grapp';
                if (v.provider === 'PID') sourceBase = 'pid';

                // Rozhodneme, zda použít šipku (má úhel) nebo kroužek (stojí/nevíme úhel)
                const hasHeading = v.heading !== null && v.heading !== undefined;
                const shapeType = hasHeading ? 'triangle' : 'circle';

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                    properties: {
                        ...v,
                        // Např. 'triangle-grapp' nebo 'circle-pid'
                        iconId: `${shapeType}-${sourceBase}` 
                    }
                };
            });

        map.getSource('vehicles').setData({ type: 'FeatureCollection', features });
        
        statusDiv.innerText = `Spojů na mapě: ${features.length}`;

    } catch (err) {
        console.error("Kritická chyba ve smyčce:", err);
        statusDiv.innerText = "Chyba při načítání dat.";
    }
}
