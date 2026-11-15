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

// Zobrazovaný název zastávky: zkratku města „Ústí n.L." rozepíšeme na „Ústí nad Labem"
export function displayStopName(name) {
    return String(name || '').trim().replace(/^Ústí\s*n\.\s*L(ab)?\.?\s*(?=,|$)/i, 'Ústí nad Labem');
}

// Klíč pro porovnání názvů z Portaba a z GTFS: bez diakritiky, interpunkce a s rozepsanými
// zkratkami („hl.nádr." = „Hlavní nádraží", „žel.st." = „nádraží", „nám." = „náměstí"…)
function stopKey(name) {
    return displayStopName(name)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/hl\.\s*nadr\./g, 'hlavni nadrazi')
        .replace(/zel\.\s*(st|zast)\./g, 'nadrazi')
        .replace(/aut\.\s*(st|nadr)\./g, 'autobusove nadrazi')
        .replace(/nadr\./g, 'nadrazi')
        .replace(/nam\./g, 'namesti')
        .replace(/sidl\./g, 'sidliste')
        .replace(/[^a-z0-9]/g, '');
}

function minutesOf(time) {
    const match = /^(\d{1,2}):(\d{2})/.exec(time || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function pragueMinutesNow() {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date());
    const get = (type) => Number(parts.find(p => p.type === type)?.value || 0);
    return get('hour') * 60 + get('minute');
}

// Index aktuální zastávky v jízdním řádu podle názvu ze zdroje. Když se zastávka na spoji
// opakuje (okružní linky), vybereme výskyt, jehož čas se zpožděním je nejblíž teď.
function findCurrentIndex(timetable, stopName, delay) {
    const key = stopKey(stopName);
    if (!key) return -1;
    const now = pragueMinutesNow();
    let best = -1, bestDiff = Infinity;
    timetable.forEach((stop, index) => {
        if (stopKey(stop.name) !== key) return;
        const planned = minutesOf(stop.dep || stop.arr);
        let diff = planned === null ? 0 : Math.abs(planned + delay - now);
        if (diff > 720) diff = 1440 - diff; // přes půlnoc
        if (diff < bestDiff) { bestDiff = diff; best = index; }
    });
    return best;
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
                headsign: item.destination || 'Neznámý cíl',
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

        // Aktuální zastávku pojmenujeme stejně jako v jízdním řádu, aby se v něm zvýraznila
        let stop = attributes.stop ? displayStopName(attributes.stop) : 'Na trase...';
        if (attributes.stop && this.useGtfs) {
            const timetable = await this.getTimetableData(attributes);
            if (timetable) {
                const index = findCurrentIndex(timetable, attributes.stop, delay);
                if (index >= 0) stop = displayStopName(timetable[index].name);
            }
        }

        return {
            route: attributes.spoj ? `${attributes.line}/${attributes.spoj}` : String(attributes.line),
            timetableRoute: attributes.spoj ? `${attributes.cis}/${attributes.spoj}` : String(attributes.line),
            destination: attributes.destination || 'Neznámý cíl',
            stop,
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

        // Projeté zastávky (před aktuální) ukazujeme v plánu, od aktuální dál se zpožděním
        const delay = attributes.delay || 0;
        const currentIndex = attributes.stop ? findCurrentIndex(timetable, attributes.stop, delay) : -1;
        return timetable.map((stop, index) => {
            const isLast = index === timetable.length - 1;
            const passed = currentIndex >= 0 && index < currentIndex;
            const block = (time) => {
                if (!time) return null;
                if (passed) return { planned: time, actual: time, color: '#58d68d' };
                return { planned: time, actual: addMinutes(time, delay), color: delayColor(delay) };
            };
            return {
                station: displayStopName(stop.name),
                arr: isLast ? block(stop.arr) : null,
                dep: isLast ? null : block(stop.dep),
                isPassing: false,
                isNAD: false
            };
        });
    }
}
