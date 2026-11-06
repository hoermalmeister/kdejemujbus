import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/tsmk';

function delayColor(minutes) {
    if (minutes > 15) return '#e74c3c';
    if (minutes > 5) return '#f39c12';
    if (minutes < 0) return '#bada55';
    return '#58d68d';
}

function addMinutes(time, minutes) {
    const [hours, mins] = time.split(':').map(Number);
    const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default class TsmkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'TSMK';
        this.tripCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`TSMK chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba TSMK:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line != null)
            .map(item => ({
                id: `tsmk_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: String(item.line),
                headsign: item.destination || 'Neznámý cíl',
                // Kroměříž se s ostatními zdroji nepřekrývá, spoj proto neslučujeme
                globalMatchId: `tsmk_${item.vehicle}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    // Trasa a zastávky spoje se během jízdy nemění
    getTrip(attributes) {
        const key = `${attributes.line}/${attributes.run}`;
        if (!this.tripCache.has(key)) {
            const request = fetch(`${BRIDGE_URL}/trip?line=${encodeURIComponent(attributes.line)}&connection=${encodeURIComponent(attributes.run)}`)
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
            route: attributes.run != null ? `${attributes.line}/${attributes.run}` : String(attributes.line),
            timetableRoute: attributes.run != null ? `${attributes.line}/${attributes.run}` : String(attributes.line),
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.stop || 'Na trase...',
            delay: `${delay} min`,
            delayColor: delayColor(delay),
            carrier: 'TSMK',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    async getRouteInfo(id, attributes) {
        if (attributes?.run == null) return null;
        const trip = await this.getTrip(attributes);
        return trip?.shape?.length >= 2 ? trip.shape : null;
    }

    async getTimetable(id, attributes) {
        if (attributes?.run == null) return [];
        const trip = await this.getTrip(attributes);
        if (!trip?.stops) return [];

        // Zdroj posílá číslo aktuální zastávky, podle něj poznáme projeté zastávky
        let current = trip.stops.findIndex(stop => stop.id === attributes.stopNumber);
        if (current < 0) current = 0;

        const delay = attributes.delay || 0;
        const block = (time, index) => {
            if (!time) return null;
            const passed = index < current;
            return {
                planned: time,
                actual: passed ? time : addMinutes(time, delay),
                color: passed ? '#58d68d' : delayColor(delay)
            };
        };
        return trip.stops.map((stop, index) => ({
            station: stop.name,
            arr: block(stop.arr, index),
            dep: block(stop.dep, index),
            isPassing: false,
            isNAD: false
        }));
    }
}
