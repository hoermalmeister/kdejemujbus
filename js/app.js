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
    
    // Zaokrouhlíme úhel na 5 stupňů. To zajistí, že paměť prohlížeče
    // nezatížíme zbytečně moc obrázky, ale vizuálně si toho nikdo nevšimne.
    const safeHeading = isCircle ? 0 : Math.round(heading / 5) * 5;
    
    // Unikátní ID této konkrétní samolepky
    const iconId = `veh-${provider}-${routeText}-${safeHeading}`;

    if (map.hasImage(iconId)) return iconId;

    const size = 44; // Zvětšili jsme prostor, aby se vešel větší text i tvar
    const canvas = document.createElement('canvas');
    canvas.width = size * 2; 
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    
    ctx.scale(2, 2); 
    ctx.translate(size/2, size/2); // Jdeme přesně do středu

    let fillColor = '#7f8c8d';
    if (provider === 'GRAPP') fillColor = '#800000';
    if (provider === 'PID') fillColor = '#2C89C8';

    // 1. KRESLENÍ GRAFIKY (Otáčíme pouze plátnem)
    ctx.save();
    if (!isCircle) {
        ctx.rotate(safeHeading * Math.PI / 180);
        ctx.scale(1.4, 1.4); // Zvětšený trojúhelník
        ctx.translate(-11, -15.5); // Vycentrování těžiště z tvého SVG
        const path = new Path2D("M 10.97,2.31 C 10.97,2.31 2.03,23.03 2.03,23.03 2.03,23.03 11.00,20.94 11.00,20.94 11.00,20.94 20.00,23.00 20.00,23.00 20.00,23.00 10.97,2.31 10.97,2.31 Z");
        ctx.fillStyle = fillColor;
        ctx.fill(path);
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, 2 * Math.PI); // Zvětšený kruh pro neznámý směr
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    ctx.restore(); // Vrátíme plátno do původního stavu. GRAFIKA ZŮSTALA ZATOČENÁ!

    // 2. KRESLENÍ TEXTU (Vždy perfektně vodorovně a uprostřed!)
    if (routeText) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Bold sans-serif přesně podle tvého zadání (10px odpovídá dobře čitelné hodnotě v Canvasu)
        ctx.font = 'bold 10px sans-serif'; 
        
        ctx.lineWidth = 3; // Krásný tlustý černý stín pro extrémní čitelnost
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(routeText, 0, 0);
        
        ctx.fillStyle = '#FFFFFF'; // Bílý střed písma
        ctx.fillText(routeText, 0, 0);
    }

    map.addImage(iconId, ctx.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 });
    return iconId;
}

// --- PO NAČTENÍ MAPY ---
map.on('load', () => {
    map.addSource('vehicles', { 
        type: 'geojson', 
        data: { type: 'FeatureCollection', features: [] } 
    });

    // ÚPLNĚ ČISTÁ VRSTVA - MapLibre už neví, že vykresluje nějaké texty. Vidí jen celistvé obrázky!
    map.addLayer({ 
        id: 'vehicles-layer', 
        type: 'symbol',
        source: 'vehicles', 
        layout: { 
            'icon-image': ['get', 'iconId'], 
            'icon-allow-overlap': true, // Dovolí spojům fyzicky se překrývat přes sebe
            'icon-ignore-placement': true
        }
    });

    map.on('mouseenter', 'vehicles-layer', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'vehicles-layer', () => map.getCanvas().style.cursor = '');

    updateData();
    setInterval(updateData, 15000);
});
// --- KLIKNUTÍ NA SPOJ (ZOBRAZENÍ TABULKY) ---
    map.on('click', 'vehicles-layer', async (e) => {
        const feature = e.features[0];
        const props = feature.properties; // Obsahuje data z našeho provideru (lon, lat, id, provider...)

        // Zavřeme předchozí okno, pokud existuje
        if (window.currentPopup) window.currentPopup.remove();

        // 1. Zobrazíme načítací okénko okamžitě (než server SŽ odpoví)
        window.currentPopup = new maplibregl.Popup({ closeButton: true })
            .setLngLat(feature.geometry.coordinates)
            .setHTML(`<div style="padding: 15px; font-family: sans-serif;">Stahuji detaily ze SŽ...</div>`)
            .addTo(map);

        // 2. Najdeme správný zdroj dat a vyžádáme si detaily
        const providerObj = providers.find(p => p.providerName === props.provider);
        if (providerObj && providerObj.getDetails) {
            
            const details = await providerObj.getDetails(props.id);
            
            // 3. Po stažení přepíšeme HTML v popupu na úhlednou tabulku!
            if (details) {
                window.currentPopup.setHTML(`
                    <div style="font-family: sans-serif; min-width: 220px;">
                        <h3 style="margin: 0 0 10px 0; border-bottom: 2px solid ${props.provider === 'GRAPP' ? '#800000' : '#2C89C8'}; padding-bottom: 5px;">
                            ${details.route}
                        </h3>
                        <table style="width: 100%; text-align: left; font-size: 13px; border-collapse: collapse;">
                            <tr><th style="padding: 4px 0; width: 40%;">Směr:</th><td>${details.destination}</td></tr>
                            <tr><th style="padding: 4px 0;">Zastávka:</th><td>${details.stop}</td></tr>
                            <tr><th style="padding: 4px 0;">Zpoždění:</th><td><strong style="color: #e67e22;">${details.delay}</strong></td></tr>
                            <tr><th style="padding: 4px 0;">Dopravce:</th><td>${details.carrier}</td></tr>
                        </table>
                        <button style="margin-top: 15px; width: 100%; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                            Jízdní řád
                        </button>
                    </div>
                `);
            } else {
                window.currentPopup.setHTML(`<div style="padding: 15px; font-family: sans-serif; color: red;">Chyba při načítání detailů.</div>`);
            }
        }
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
                // Vygenerujeme (nebo načteme z paměti) hotový obrázek pro tento konkrétní vlak
                const iconId = getOrCreateIcon(map, v.provider, v.route, v.heading);

                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
                    properties: {
                        ...v,
                        iconId: iconId 
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
