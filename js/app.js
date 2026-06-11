import Deduplicator from './Deduplicator.js';
import GrappProvider from './providers/GrappProvider.js';

const deduplicator = new Deduplicator();
const providers = [
    new GrappProvider()
    // Tady pak přidáš další: new PidProvider(), atd.
];

const statusDiv = document.getElementById('status');

async function updateMap() {
    statusDiv.innerText = 'Stahuji data z API...';
    
    // Asynchronně stáhneme data ze všech zdrojů najednou
    const fetchPromises = providers.map(p => p.fetchData());
    const results = await Promise.allSettled(fetchPromises);
    
    let allVehicles = [];
    
    // Sesbíráme úspěšně stažená data
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            allVehicles = allVehicles.concat(result.value);
        } else {
            console.error('Chyba při stahování:', result.reason);
        }
    });

    // Provedeme deduplikaci a prioritizaci
    deduplicator.processData(allVehicles);
    
    // Získáme čistá data připravená pro mapu
    const dataForMap = deduplicator.getCleanData();

    statusDiv.innerText = `Aktualizováno. Celkem vozidel: ${dataForMap.length}`;
    console.log('Data pro WebGL:', dataForMap);

    // TADY POZDĚJI ZAVOLÁŠ FUNKCI PRO PŘEKRESLENÍ CARTO / DECK.GL
    // renderToCarto(dataForMap);
}

// Spustíme první aktualizaci
updateMap();

// Nastavíme smyčku (např. každých 15 vteřin)
setInterval(updateMap, 15000);
