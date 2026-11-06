import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/dszo';

function delayColor(minutes) {
    if (minutes > 15) return '#e74c3c';
    if (minutes > 5) return '#f39c12';
    if (minutes < 0) return '#bada55';
    return '#58d68d';
}

export default class DszoProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DSZO';
        this.tripCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`DSZO chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba DSZO:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => ({
                id: `dszo_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: String(item.line),
                headsign: item.destination || 'Neznámý cíl',
                // Zdroj nemá číslo spoje, vozy se s ostatními zdroji nepárují
                globalMatchId: `dszo_${item.vehicle}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    // Jízdní řád vozu ze spoj.php (přes bridge). Klíč podle vozu a aktuální zastávky.
    getTrip(attributes) {
        const key = `${attributes.vehicle}/${attributes.station}`;
        if (!this.tripCache.has(key)) {
            const url = `${BRIDGE_URL}/trip?vuz=${encodeURIComponent(attributes.vehicle)}&zast=${encodeURIComponent(attributes.station)}`
                + `&zpozdeni=${encodeURIComponent(attributes.delay || 0)}&nizkopodlazni=${encodeURIComponent(attributes.lowlevel || 0)}`;
            const request = fetch(url)
                .then(response => (response.ok ? response.json() : null))
                .catch(() => null)
                .then(trip => {
                    if (!trip) this.tripCache.delete(key);
                    return trip;
                });
            this.tripCache.set(key, request);
            if (this.tripCache.size > 30) this.tripCache.delete(this.tripCache.keys().next().value);
        }
        return this.tripCache.get(key);
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
            carrier: 'DSZO',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    // Tvar trasy zdroj zatím nedává
    getRouteInfo() { return null; }

    async getTimetable(id, attributes) {
        if (!attributes?.station) return [];
        const trip = await this.getTrip(attributes);
        if (!trip?.stops?.length) return [];

        const delay = attributes.delay || 0;
        return trip.stops.map((stop, index) => {
            const passed = trip.active >= 0 && index < trip.active;
            const block = { planned: stop.time, actual: stop.time, color: passed ? '#58d68d' : delayColor(delay) };
            const isLast = index === trip.stops.length - 1;
            return {
                station: stop.name,
                arr: isLast ? block : null,
                dep: isLast ? null : block,
                isPassing: false,
                isNAD: false
            };
        });
    }
}
