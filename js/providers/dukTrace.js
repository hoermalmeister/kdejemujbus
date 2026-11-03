// Složí trasu DÚK z odpovědi GetVhcTraceMarkers. Body nechodí v pořadí jízdy a jsou dvojího druhu:
//  - "T  00:00": skutečně projetá stopa vozidla, ID roste s časem, takže drží i závleky
//  - s časem "11:40:00": plán před vozidlem. Modré body (#87CEFA) jsou zastávky, šedé tvar mezi nimi.
//    Podle ID jdou úseky správně za sebou, ale uvnitř úseku jsou šedé body zpřeházené
//    a každý úsek se vrací na výchozí zastávku.
// ID stopy navazují hned za ID plánu, takže stopa obsahuje jen aktuální spoj.

const STOP_COLOR = '#87cefa';
const SPIKE_LEG_M = 400;
const DRIVEN_SPIKE_LEG_M = 150;
const START_TOLERANCE_M = 50;
const CHAIN_GAP_M = 600;
const MIN_BRANCH_POINTS = 3;
const OUTLIER_JUMP_M = 2000;

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

// Uvnitř úseku může být hlavní trasa i závlek na zavolání a jejich časy se prolínají.
// Body proto podle času přidáváme k řetězci, na který navazují nejlépe.
function splitIntoChains(run, previousStop) {
    const chains = previousStop ? [[previousStop]] : [];
    for (const point of sortByTime(run)) {
        let best = null;
        let bestScore = Infinity;
        for (const chain of chains) {
            const distance = distanceM(chain[chain.length - 1], point);
            if (distance > CHAIN_GAP_M) continue;
            const hasNeighbourId = chain.some(p => Math.abs(p.ID - point.ID) === 1);
            const score = hasNeighbourId ? distance * 0.3 : distance;
            if (score < bestScore) {
                bestScore = score;
                best = chain;
            }
        }
        if (best) best.push(point);
        else chains.push([point]);
    }
    return chains;
}

function orderPlan(planPoints) {
    const main = [];
    const branches = [];
    const seenStops = new Set();
    let run = [];

    const flushRun = (nextStop) => {
        if (run.length === 0) return;
        const previousStop = main[main.length - 1];
        const chains = splitIntoChains(run, previousStop);
        run = [];

        const target = nextStop || chains[chains.length - 1][chains[chains.length - 1].length - 1];
        const mainChain = chains.reduce((best, chain) =>
            distanceM(chain[chain.length - 1], target) < distanceM(best[best.length - 1], target) ? chain : best);

        main.push(...mainChain.filter(point => point !== previousStop));
        chains.filter(chain => chain !== mainChain).forEach(chain => {
            const points = chain.filter(point => point !== previousStop);
            if (points.length >= MIN_BRANCH_POINTS) branches.push(points);
        });
    };

    for (const point of [...planPoints].sort((a, b) => a.ID - b.ID)) {
        if (!isStop(point)) {
            run.push(point);
            continue;
        }
        const key = `${point.Lat},${point.Lng}`;
        const isNewStop = !seenStops.has(key);
        flushRun(point);
        if (isNewStop) {
            seenStops.add(key);
            main.push(point);
        }
    }
    flushRun(null);
    return { main, branches };
}

// Zdroj občas pošle bod úplně mimo trasu. Uprostřed ho poznáme tak, že sousedé jsou blízko
// sebe a on daleko od obou, na konci projeté stopy podle velkého skoku.
function removeOutliers(points, { trimEnds }) {
    let result = points.filter((point, i) => {
        if (i === 0 || i === points.length - 1) return true;
        const toPrev = distanceM(points[i - 1], point);
        const toNext = distanceM(point, points[i + 1]);
        if (toPrev <= OUTLIER_JUMP_M || toNext <= OUTLIER_JUMP_M) return true;
        return distanceM(points[i - 1], points[i + 1]) >= 0.5 * Math.min(toPrev, toNext);
    });
    if (trimEnds) {
        while (result.length >= 2 && distanceM(result[0], result[1]) > OUTLIER_JUMP_M) result = result.slice(1);
        while (result.length >= 2 && distanceM(result[result.length - 1], result[result.length - 2]) > OUTLIER_JUMP_M) result = result.slice(0, -1);
    }
    return result;
}

// Odhadnuté časy občas posunou bod mimo pořadí, což by na mapě udělalo zub
function removeSpikes(points, maxLegM) {
    return points.filter((point, i) => {
        if (i === 0 || i === points.length - 1 || isStop(point)) return true;
        const toPrev = distanceM(points[i - 1], point);
        const toNext = distanceM(point, points[i + 1]);
        if (toPrev > maxLegM || toNext > maxLegM) return true;
        return distanceM(points[i - 1], points[i + 1]) >= 0.6 * (toPrev + toNext);
    });
}

function nearestIndex(points, target) {
    let index = -1;
    let nearest = Infinity;
    points.forEach((point, i) => {
        const distance = distanceM(point, target);
        if (distance < nearest) {
            nearest = distance;
            index = i;
        }
    });
    return { index, distance: nearest };
}

function remainingStart(plan, lastDriven) {
    if (!lastDriven || plan.length === 0) return 0;
    const nearest = nearestIndex(plan, lastDriven).distance;
    // Při průjezdu stejným místem dvakrát bereme pozdější výskyt
    let start = 0;
    plan.forEach((point, i) => {
        if (distanceM(lastDriven, point) <= nearest + START_TOLERANCE_M) start = i;
    });
    return start;
}

// Závlek ukážeme, jen když navazuje na část trasy před vozidlem. Neobsloužený závlek za vozidlem zmizí.
function attachBranch(branch, ahead) {
    const head = nearestIndex(ahead, branch[0]);
    if (head.index < 0 || head.distance > CHAIN_GAP_M) return null;
    const tail = nearestIndex(ahead, branch[branch.length - 1]);
    const line = [ahead[head.index], ...removeSpikes(branch, SPIKE_LEG_M)];
    if (tail.distance <= CHAIN_GAP_M) line.push(ahead[tail.index]);
    return line;
}

// Vrací seznam čar: první je hlavní trasa, další jsou závleky, které vozidlo teprve může obsloužit.
export function buildDukRoute(markers) {
    if (!Array.isArray(markers)) return [];
    const valid = markers.filter(m => m && Number.isFinite(m.Lat) && Number.isFinite(m.Lng) && m.Lat !== 0 && m.Lng !== 0);
    const isDriven = (m) => String(m.Text).trim().startsWith('T');

    const sortedDriven = valid.filter(isDriven).sort((a, b) => a.ID - b.ID);
    const driven = removeSpikes(removeOutliers(sortedDriven, { trimEnds: true }), DRIVEN_SPIKE_LEG_M);
    const { main, branches } = orderPlan(valid.filter(m => !isDriven(m)));
    const plan = removeSpikes(removeOutliers(main, { trimEnds: false }), SPIKE_LEG_M);
    const ahead = plan.slice(remainingStart(plan, driven[driven.length - 1]));

    const toCoordinates = (points) => points.map(p => [p.Lng, p.Lat]);
    const lines = [toCoordinates([...driven, ...ahead])];
    branches.forEach(branch => {
        const line = attachBranch(branch, ahead);
        if (line) lines.push(toCoordinates(line));
    });
    return lines[0].length > 0 ? lines : [];
}
