// Trasy linek předpočítané z GTFS, publikované jako statické soubory (viz kdejemujbus-bridge).
const ROUTES_URL = 'https://hoermalmeister.github.io/kdejemujbus-bridge/routes';
const MAX_CACHED_LINES = 20;
const DAY_MS = 86400000;

const cache = new Map();

function loadLine(line) {
    if (cache.has(line)) return cache.get(line);
    const request = fetch(`${ROUTES_URL}/${encodeURIComponent(line)}.json`)
        .then(response => (response.ok ? response.json() : null))
        .catch(() => null);
    cache.set(line, request);
    if (cache.size > MAX_CACHED_LINES) cache.delete(cache.keys().next().value);
    return request;
}

export function decodePolyline(encoded) {
    const coordinates = [];
    let index = 0, lat = 0, lng = 0;
    const next = () => {
        let shift = 0, result = 0, byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (index < encoded.length) {
        lat += next();
        lng += next();
        coordinates.push([lng / 1e5, lat / 1e5]);
    }
    return coordinates;
}

// Stejné číslo spoje může mít v různé dny jinou trasu. Spoj po půlnoci patří ke včerejšímu dni.
export function pickVariant(variants, base, now = new Date()) {
    const baseDay = Date.UTC(+base.slice(0, 4), +base.slice(4, 6) - 1, +base.slice(6, 8));
    const today = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - baseDay) / DAY_MS);
    const runsOn = (offset) => offset >= 0 && variants.find(([, mask]) => (mask >> offset) & 1);
    return runsOn(today) || runsOn(today - 1) || variants[0];
}

// Přijímá linkospoj ve tvaru "841129/25"
export async function getGtfsRoute(lineAndRun) {
    const [line, run] = String(lineAndRun || '').replace(/\s/g, '').split('/');
    if (!line || !run) return null;

    const data = await loadLine(line);
    const variants = data?.trips?.[run];
    if (!variants || variants.length === 0) return null;

    const [shapeIndex] = pickVariant(variants, data.base);
    const coordinates = decodePolyline(data.shapes[shapeIndex]);
    return coordinates.length >= 2 ? coordinates : null;
}
