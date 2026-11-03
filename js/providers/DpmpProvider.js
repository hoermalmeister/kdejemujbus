import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/dpmp';

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

export default class DpmpProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DPMP';
        this.tripCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`DPMP chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba DPMP:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => {
                // Linka 1 má celostátní číslo 655001
                const fullLine = item.fullLine || String(655000 + parseInt(item.line, 10));
                return {
                    id: `dpmp_${item.vehicle}`,
                    provider: this.providerName,
                    lat: item.lat,
                    lon: item.lng,
                    heading: item.heading,
                    route: item.line,
                    headsign: item.destination || 'Neznámý cíl',
                    globalMatchId: item.run ? `${fullLine}_${item.run}` : `dpmp_${item.vehicle}`,
                    delay: `${item.delay || 0} min`,
                    attributes: { ...item, fullLine }
                };
            });
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
        return {
            route: attributes.run ? `${attributes.line}/${attributes.run}` : attributes.line,
            timetableRoute: attributes.run ? `${attributes.fullLine}/${attributes.run}` : attributes.fullLine,
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.lastStop || 'Na trase...',
            delay: `${attributes.delay || 0} min`,
            carrier: 'DPMP',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    async getRouteInfo(id, attributes) {
        if (!attributes?.run) return null;
        const trip = await this.getTrip(attributes);
        return trip?.shape?.length >= 2 ? trip.shape : null;
    }

    async getTimetable(id, attributes) {
        if (!attributes?.run) return [];
        const trip = await this.getTrip(attributes);
        if (!trip?.stops) return [];

        // Spoj může jednou zastávkou projet víckrát, proto se hledá i podle času
        const isNext = (stop) => stop.id === attributes.nextStopId;
        let nextIndex = trip.stops.findIndex(stop => isNext(stop) && (stop.dep || stop.arr) === attributes.nextStopTime);
        if (nextIndex < 0) nextIndex = trip.stops.findIndex(isNext);

        const delay = attributes.delay || 0;
        const block = (time, index) => {
            if (!time) return null;
            const passed = index < nextIndex;
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
