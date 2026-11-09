import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/dpmhk';

function delayColor(minutes) {
    if (minutes > 15) return '#e74c3c';
    if (minutes > 5) return '#f39c12';
    if (minutes < 0) return '#bada55';
    return '#58d68d';
}

export default class DpmhkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DPMHK';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`DPMHK chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba DPMHK:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => ({
                id: `dpmhk_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: String(item.line),
                headsign: item.destination || 'Neznámý cíl',
                globalMatchId: `dpmhk_${item.vehicle}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        const delay = attributes.delay || 0;
        return {
            route: String(attributes.line),
            timetableRoute: String(attributes.line),
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.stop || 'Na trase...',
            delay: `${delay} min`,
            delayColor: delayColor(delay),
            carrier: 'DPMHK',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    // Trasu dává zdroj v katalogu (ne z GTFS); jízdní řád zdroj neposílá
    async getRouteInfo(id, attributes) {
        if (!attributes?.lineId || !attributes?.routeId) return null;
        try {
            const response = await fetch(`${BRIDGE_URL}/route?lineId=${encodeURIComponent(attributes.lineId)}&routeId=${encodeURIComponent(attributes.routeId)}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data.shape?.length >= 2 ? data.shape : null;
        } catch (error) {
            console.warn('Trasu DPMHK se nepodařilo stáhnout.', error);
            return null;
        }
    }

    // Jízdní řád spoje z getPlatformsDataWithHistory přes můstek (plán + skutečnost + zpoždění
    // na každé zastávce). Mají ho jen vozy na pravidelném spoji (s číslem spoje tn).
    async getTimetable(id, attributes) {
        if (!attributes?.trip || !attributes?.obu || !attributes?.routeName) return [];
        try {
            const url = `${BRIDGE_URL}/timetable?line=${encodeURIComponent(attributes.lineNum || '')}`
                + `&trip=${encodeURIComponent(attributes.trip)}`
                + `&route=${encodeURIComponent(attributes.routeName)}`
                + `&obu=${encodeURIComponent(attributes.obu)}`;
            const response = await fetch(url);
            if (!response.ok) return [];
            const { stops } = await response.json();
            if (!stops?.length) return [];
            return stops.map((s, index) => {
                const isLast = index === stops.length - 1;
                const block = (actual) => s.planned
                    ? { planned: s.planned, actual: actual || s.planned, color: delayColor(s.delayMin || 0) }
                    : null;
                return {
                    station: s.station,
                    arr: isLast ? block(s.actualArr) : null,
                    dep: isLast ? null : block(s.actualDep),
                    isPassing: false,
                    isNAD: false
                };
            });
        } catch (error) {
            console.warn('Jízdní řád DPMHK se nepodařilo stáhnout.', error);
            return [];
        }
    }
}
