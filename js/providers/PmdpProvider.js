import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/pmdp';

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

export default class PmdpProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'PMDP';
        this.tripCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`PMDP chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba PMDP:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.id !== undefined)
            .map(item => ({
                id: `pmdp_${item.id}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading ?? null,
                route: item.line,
                headsign: item.destination || 'Neznámý cíl',
                // Číslo spoje v polohách není, proto se s ostatními zdroji nepáruje
                globalMatchId: `pmdp_${item.id}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    // Trasa a zastávky spoje se během jízdy nemění
    getTrip(connectionId) {
        if (!this.tripCache.has(connectionId)) {
            const request = fetch(`${BRIDGE_URL}/trip?id=${connectionId}`)
                .then(response => (response.ok ? response.json() : null))
                .catch(() => null)
                .then(trip => {
                    if (!trip) this.tripCache.delete(connectionId);
                    return trip;
                });
            this.tripCache.set(connectionId, request);
            if (this.tripCache.size > 30) this.tripCache.delete(this.tripCache.keys().next().value);
        }
        return this.tripCache.get(connectionId);
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        const trip = await this.getTrip(attributes.id);
        const run = trip?.run;
        return {
            route: run ? `${attributes.line}/${run}` : attributes.line,
            timetableRoute: run ? `${attributes.fullLine}/${run}` : String(attributes.fullLine),
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.lastStop || 'Na trase...',
            delay: `${attributes.delay || 0} min`,
            carrier: 'PMDP',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    async getRouteInfo(id, attributes) {
        if (!attributes) return null;
        const trip = await this.getTrip(attributes.id);
        return trip?.shape?.length >= 2 ? trip.shape : null;
    }

    async getTimetable(id, attributes) {
        if (!attributes) return [];
        const trip = await this.getTrip(attributes.id);
        if (!trip?.stops) return [];

        const delay = attributes.delay || 0;
        const block = (time, index) => {
            if (!time) return null;
            const passed = index < attributes.lastStopIndex;
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
