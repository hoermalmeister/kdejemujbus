// Složí trasu DÚK z odpovědi GetVhcTraceMarkers. Body nechodí v pořadí jízdy a jsou dvojího druhu:
//  - "T  00:00": skutečně projetá stopa vozidla, ID roste s časem, takže drží i závleky
//  - s časem "11:40:00": plán před vozidlem. Modré body (#87CEFA) jsou zastávky, šedé tvar mezi nimi.
//    Podle ID jdou úseky správně za sebou, ale uvnitř úseku jsou šedé body zpřeházené
//    a každý úsek se vrací na výchozí zastávku.

const STOP_COLOR = '#87cefa';
const SPIKE_LEG_M = 400;
const START_TOLERANCE_M = 50;

function distanceM(a, b) {
    const dLat = (a.Lat - b.Lat) * 111320;
    const dLng = (a.Lng - b.Lng) * 111320 * Math.cos(a.Lat * Math.PI / 180);
    return Math.hypot(dLat, dLng);
}

function timeToSeconds(text) {
    const [h, m, s] = String(text).trim().split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
}

function sortByTime(points) {
    const seconds = points.map(p => timeToSeconds(p.Text));
    const crossesMidnight = Math.max(...seconds) - Math.min(...seconds) > 12 * 3600;
    const key = (p) => {
        const value = timeToSeconds(p.Text);
        return crossesMidnight && value < 12 * 3600 ? value + 24 * 3600 : value;
    };
    return [...points].sort((a, b) => key(a) - key(b));
}

function isStop(point) {
    return String(point.CSSBgClr).toLowerCase() === STOP_COLOR;
}

function orderPlan(planPoints) {
    const ordered = [];
    const seenStops = new Set();
    let run = [];
    const flushRun = () => {
        if (run.length > 0) ordered.push(...sortByTime(run));
        run = [];
    };

    for (const point of [...planPoints].sort((a, b) => a.ID - b.ID)) {
        if (!isStop(point)) {
            run.push(point);
            continue;
        }
        flushRun();
        const key = `${point.Lat},${point.Lng}`;
        if (!seenStops.has(key)) {
            seenStops.add(key);
            ordered.push(point);
        }
    }
    flushRun();
    return ordered;
}

// Odhadnuté časy občas posunou šedý bod mimo pořadí, což by na mapě udělalo zub
function removeSpikes(points) {
    return points.filter((point, i) => {
        if (i === 0 || i === points.length - 1 || isStop(point)) return true;
        const toPrev = distanceM(points[i - 1], point);
        const toNext = distanceM(point, points[i + 1]);
        if (toPrev > SPIKE_LEG_M || toNext > SPIKE_LEG_M) return true;
        return distanceM(points[i - 1], points[i + 1]) >= 0.6 * (toPrev + toNext);
    });
}

function remainingPlan(plan, lastDriven) {
    if (!lastDriven || plan.length === 0) return plan;
    const distances = plan.map(point => distanceM(lastDriven, point));
    const nearest = Math.min(...distances);
    // Při průjezdu stejným místem dvakrát bereme pozdější výskyt
    let start = 0;
    distances.forEach((distance, i) => {
        if (distance <= nearest + START_TOLERANCE_M) start = i;
    });
    return plan.slice(start);
}

export function buildDukRoute(markers) {
    if (!Array.isArray(markers)) return [];
    const valid = markers.filter(m => m && Number.isFinite(m.Lat) && Number.isFinite(m.Lng) && m.Lat !== 0 && m.Lng !== 0);
    const isDriven = (m) => String(m.Text).trim().startsWith('T');

    const driven = valid.filter(isDriven).sort((a, b) => a.ID - b.ID);
    const plan = removeSpikes(orderPlan(valid.filter(m => !isDriven(m))));

    return [...driven, ...remainingPlan(plan, driven[driven.length - 1])].map(p => [p.Lng, p.Lat]);
}
