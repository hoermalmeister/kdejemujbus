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

// 1. Ukazatel se směrem (Trojúhelník)
function createTriangleIcon(map, id, fillColor) {
    if (map.hasImage(id)) return;
    const size = 30; 
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); 
    // Posun těžiště SVG do přesného středu Canvasu (15, 15)
    ctx.translate(15 - 11, 15 - 15.5);

    const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
    ctx.fillStyle = fillColor;
    ctx.fill();

    map.addImage(id, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
}

// 2. Ukazatel bez směru (Kruh)
function createCircleIcon(map, id, fillColor) {
    if (map.hasImage(id)) return;
    const size = 30;
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2);
    ctx.beginPath();
    // Nakreslíme přesně vycentrovaný kruh o poloměru 8.5px
    ctx.arc(15, 15, 8.5, 0, 2 * Math.PI);
    ctx.fillStyle = fillColor;
    ctx.fill();

    map.addImage(id, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    // Generování šipek pro spoje se známým směrem
    createTriangleIcon(map, 'triangle-grapp', '#800000'); 
    createTriangleIcon(map, 'triangle-pid', '#2C89C8');   
    createTriangleIcon(map, 'triangle-unknown', '#7f8c8d'); 

    // Generování kruhů pro spoje s neznámým směrem (stojící/bez dat)
    createCircleIcon(map, 'circle-grapp', '#800000'); 
    createCircleIcon(map, 'circle-pid', '#2C89C8');   
    createCircleIcon(map, 'circle-unknown', '#7f8c8d'); 

    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // VRSTVA 1: POUZE IKONY (Vykreslí se jako první vespod)
    map.addLayer({ 
        id: 'vehicles-icon-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 
            'icon-image': ['get', 'iconId'], 
            'icon-rotate': ['coalesce', ['get', 'heading'], 0], 
            'icon-rotation-alignment': 'map', 
            'icon-allow-overlap': true, // Ikony se mohou přes sebe překrývat
            'icon-ignore-placement': true
        }
    });

    // VRSTVA 2: POUZE TEXTY (Vykreslí se absolutně nahoře nad všemi ikonami)
    map.addLayer({ 
        id: 'vehicles-text-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 
            'text-field': ['get', 'route'], 
            'text-size': 9, // Odpovídá tvému 6px-7px požadavku
            'text-rotation-alignment': 'viewport',
            
            // INTELIGENTNÍ CHOVÁNÍ TEXTU
            'text-allow-overlap': false, // Dva texty se nesmí přes sebe překrýt
            // Pokud se mají texty překrýt, zkusí uskočit z prostředka na okraj
            'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 
            'text-radial-offset': 1.0, // Vzdálenost uskoku textu (1.0 = šířka jednoho písmena)
            'text-justify': 'center'
        },
        paint: {
            'text-color': '#FFFFFF',
            'text-halo-color': 'rgba(0,0,0,0.85)', 
            'text-halo-width': 1.5 // Tučný stín supluje 'bold' font
        } 
    });

    // Interakce myši aplikujeme na obě vrstvy
    const changeCursor = () => map.getCanvas().style.cursor = 'pointer';
    const resetCursor = () => map.getCanvas().style.cursor = '';
    map.on('mouseenter', 'vehicles-icon-layer', changeCursor);
    map.on('mouseleave', 'vehicles-icon-layer', resetCursor);
    map.on('mouseenter', 'vehicles-text-layer', changeCursor);
    map.on('mouseleave', 'vehicles-text-layer', resetCursor);

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

                // Zjistíme, zda máme platný směr a vybereme typ tvaru
                const hasHeading = v.heading !== null && v.heading !== undefined;
                const shapeType = hasHeading ? 'triangle' : 'circle';

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                    properties: {
                        ...v,
                        // Výsledné ID ikony (např. 'triangle-grapp' nebo 'circle-pid')
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
