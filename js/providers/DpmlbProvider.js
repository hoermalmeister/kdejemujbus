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

// Zdroje bez čísla spoje, kterým ho dopočítává můstek z polohy a jízdního řádu (DPMLB, DPMJ, Kladno, Arriva Express)
export default class DpmlbProvider extends BaseProvider {
    // options.estimated = linka bez real-time poloh, poloha je jen teoretická podle jízdního řádu
    // options.carrier = dopravce zobrazený v detailu
    constructor(providerName = 'DPMLB', endpoint = 'dpmlb', options = {}) {
        super();
        this.providerName = providerName;
        this.endpoint = endpoint;
        this.idPrefix = endpoint.replace(/[^a-z0-9]+/gi, '_');
        this.estimated = Boolean(options.estimated);
        this.carrier = options.carrier || providerName;
        this.bridgeUrl = `${BRIDGE_BASE}/${endpoint}`;
        this.timetableCache = new Map();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(this.bridgeUrl);
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
                id: `${this.idPrefix}_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: item.line,
                headsign: item.destination || 'Neznámý cíl',
                // Zdroj nemá číslo spoje, proto se vozy s ostatními zdroji nepárují
                globalMatchId: `${this.idPrefix}_${item.vehicle}`,
                delay: this.estimated ? 'Neznámé' : `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    // Spoj dopočítal bridge; jízdní řád i trasa jsou pak z GTFS
    linkospoj(attributes) {
        return attributes.run != null ? `${attributes.fullLine}/${attributes.run}` : null;
    }

    getTimetableData(attributes) {
        const key = this.linkospoj(attributes);
        if (!key) return Promise.resolve(null);
        if (!this.timetableCache.has(key)) {
            const request = fetch(`${TIMETABLES_URL}/${attributes.fullLine}_${attributes.run}.json`)
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
        // Poslední zastávka: když ji můstek našel v jízdním řádu spoje (stopMatched), použijeme
        // název z jízdního řádu, aby se v něm zvýraznila; jinak název ze zdroje, a když zdroj
        // žádný neposílá, odhad z dopočteného spoje
        let stop = attributes.stop || 'Na trase...';
        if (attributes.run != null && (attributes.stopMatched || !attributes.stop)) {
            const timetable = await this.getTimetableData(attributes);
            stop = timetable?.[attributes.stopIndex]?.name || stop;
        }
        return {
            route: attributes.run != null ? `${attributes.line}/${attributes.run}` : attributes.line,
            timetableRoute: this.linkospoj(attributes) || attributes.line,
            destination: attributes.destination || 'Neznámý cíl',
            stop,
            // Teoretická poloha: zpoždění neznáme, v hlavičce se ukáže „Odhad polohy"
            delay: this.estimated ? 'Neznámé' : `${delay} min`,
            delayColor: this.estimated ? '#7f8c8d' : delayColor(delay),
            carrier: this.carrier,
            isNAD: false,
            isOdklon: false,
            isOffline: this.estimated,
            isAtDestination: false
        };
    }

    async getRouteInfo(id, attributes) {
        const key = this.linkospoj(attributes);
        return key ? getGtfsRoute(key) : null;
    }

    async getTimetable(id, attributes) {
        if (!attributes || attributes.run == null) return [];
        const timetable = await this.getTimetableData(attributes);
        if (!timetable) return [];

        const delay = attributes.delay || 0;
        const current = attributes.stopIndex || 0;
        const block = (time, index) => {
            if (!time) return null;
            const passed = index < current;
            return {
                planned: time,
                actual: passed ? time : addMinutes(time, delay),
                color: passed ? '#58d68d' : delayColor(delay)
            };
        };
        return timetable.map((stop, index) => {
            const isLast = index === timetable.length - 1;
            return {
                station: stop.name,
                arr: isLast ? block(stop.arr, index) : null,
                dep: isLast ? null : block(stop.dep, index),
                isPassing: false,
                isNAD: false
            };
        });
    }
}
