import BaseProvider from './BaseProvider.js';
import { getGtfsRoute } from './gtfsRoutes.js';

const BRIDGE_BASE = 'https://grapp-bridge-production.up.railway.app';
const TIMETABLES_URL = 'https://hoermalmeister.github.io/kdejemujbus-bridge/timetables';

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

// Jeden zdroj Portabo pro DPMÚL i MDT. U DPMÚL (useGtfs) dobíráme cíl, jízdní řád a trasu
// z celostátního GTFS přes linku+spoj; MDT zůstává jen poloha (jeho spoje s GTFS nesedí).
export default class PortaboProvider extends BaseProvider {
    constructor(providerName, endpoint, useGtfs) {
        super();
        this.providerName = providerName;
        this.endpoint = endpoint;
        this.useGtfs = useGtfs;
        this.timetableCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(`${BRIDGE_BASE}/${this.endpoint}`);
            if (!response.ok) throw new Error(`${this.providerName} chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error(`Chyba ${this.providerName}:`, error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => ({
                id: `${this.endpoint}_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: String(item.line),
                headsign: 'Neznámý cíl',
                // Šestimístná linka + spoj, ať se vozy případně nepárují dvakrát
                globalMatchId: item.spoj ? `${item.cis}_${item.spoj}` : `${this.endpoint}_${item.vehicle}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    linkospoj(attributes) {
        return this.useGtfs && attributes.spoj ? `${attributes.cis}/${attributes.spoj}` : null;
    }

    getTimetableData(attributes) {
        const key = this.linkospoj(attributes);
        if (!key) return Promise.resolve(null);
        if (!this.timetableCache.has(key)) {
            const request = fetch(`${TIMETABLES_URL}/${attributes.cis}_${attributes.spoj}.json`)
                .then(response => (response.ok ? response.json() : null))
                .catch(() => null)
                .then(data => {
                    if (!data) this.timetableCache.delete(key);
                    return data;
                });
            this.timetableCache.set(key, request);
            if (this.timetableCache.size > 40) this.timetableCache.delete(this.timetableCache.keys().next().value);
        }
        return this.timetableCache.get(key);
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        const delay = attributes.delay || 0;
        let destination = 'Neznámý cíl';
        if (this.useGtfs) {
            const timetable = await this.getTimetableData(attributes);
            destination = timetable?.[timetable.length - 1]?.name || destination;
        }
        return {
            route: attributes.spoj ? `${attributes.line}/${attributes.spoj}` : String(attributes.line),
            timetableRoute: attributes.spoj ? `${attributes.cis}/${attributes.spoj}` : String(attributes.line),
            destination,
            stop: 'Na trase...',
            delay: `${delay} min`,
            delayColor: delayColor(delay),
            carrier: this.providerName,
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    async getRouteInfo(id, attributes) {
        const key = this.linkospoj(attributes);
        return key ? getGtfsRoute(key) : null;
    }

    async getTimetable(id, attributes) {
        if (!this.useGtfs) return [];
        const timetable = await this.getTimetableData(attributes);
        if (!timetable) return [];

        // Feed nedává aktuální zastávku, takže jen jízdní řád se zpožděním na všech zastávkách
        const delay = attributes.delay || 0;
        const block = (time) => time ? { planned: time, actual: addMinutes(time, delay), color: delayColor(delay) } : null;
        return timetable.map((stop, index) => {
            const isLast = index === timetable.length - 1;
            return {
                station: stop.name,
                arr: isLast ? block(stop.arr) : null,
                dep: isLast ? null : block(stop.dep),
                isPassing: false,
                isNAD: false
            };
        });
    }
}
