import BaseProvider from './BaseProvider.js';
import { getGtfsRoute } from './gtfsRoutes.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/tshb';
const TIMETABLES_URL = 'https://hoermalmeister.github.io/kdejemujbus-bridge/timetables';
const LINE_BASE = 605000;
const CITY_PREFIX = 'Havlíčkův Brod,';

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

export default class TshbProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'TSHB';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`TSHB chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba TSHB:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => {
                const fullLine = String(LINE_BASE + parseInt(item.line, 10));
                return {
                    id: `tshb_${item.plate}`,
                    provider: this.providerName,
                    lat: item.lat,
                    lon: item.lng,
                    heading: item.heading ?? null,
                    route: item.line,
                    headsign: item.destination || 'Neznámý cíl',
                    globalMatchId: item.run ? `${fullLine}_${item.run}` : `tshb_${item.plate}`,
                    delay: item.delay === null ? 'Neznámé' : `${item.delay} min`,
                    attributes: { ...item, fullLine }
                };
            });
    }

    linkospoj(attributes) {
        return attributes.run ? `${attributes.fullLine}/${attributes.run}` : attributes.fullLine;
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        return {
            route: attributes.run ? `${attributes.line}/${attributes.run}` : attributes.line,
            timetableRoute: this.linkospoj(attributes),
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.stop || 'Na trase...',
            delay: attributes.delay === null ? 'Neznámé' : `${attributes.delay} min`,
            carrier: 'TSHB',
            isNAD: false,
            isOdklon: false,
            isOffline: attributes.delay === null,
            isAtDestination: false
        };
    }

    getRouteInfo(id, attributes) {
        return attributes ? getGtfsRoute(this.linkospoj(attributes)) : null;
    }

    async getTimetable(id, attributes) {
        if (!attributes?.run) return [];
        try {
            const response = await fetch(`${TIMETABLES_URL}/${attributes.fullLine}_${attributes.run}.json`);
            if (!response.ok) return [];
            const stops = await response.json();
            const delay = attributes.delay || 0;
            const names = stops.map(stop => stop.name.replace(CITY_PREFIX, ''));
            const currentIndex = names.indexOf(attributes.stop);

            const block = (time, index) => {
                if (!time) return null;
                const passed = currentIndex >= 0 && index < currentIndex;
                return {
                    planned: time,
                    actual: passed ? time : addMinutes(time, delay),
                    color: passed ? '#58d68d' : delayColor(delay)
                };
            };
            return stops.map((stop, index) => ({
                station: names[index],
                arr: index === 0 ? null : block(stop.arr, index),
                dep: index === stops.length - 1 ? null : block(stop.dep, index),
                isPassing: false,
                isNAD: false
            }));
        } catch (error) {
            console.error('Chyba JŘ TSHB:', error);
            return [];
        }
    }
}
