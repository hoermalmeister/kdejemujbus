import BaseProvider from './BaseProvider.js';
import { getGtfsRoute } from './gtfsRoutes.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/dpmd';
// Linka 201 má celostátní číslo 515201
const LINE_BASE = 515000;

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

export default class DpmdProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DPMD';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`DPMD chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba DPMD:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => {
                const fullLine = String(LINE_BASE + parseInt(item.line, 10));
                return {
                    id: `dpmd_${item.vehicle}`,
                    provider: this.providerName,
                    lat: item.lat,
                    lon: item.lng,
                    heading: item.heading,
                    route: item.line,
                    headsign: item.destination || 'Neznámý cíl',
                    globalMatchId: item.run ? `${fullLine}_${item.run}` : `dpmd_${item.vehicle}`,
                    delay: `${item.delay} min`,
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
            stop: attributes.stops?.[attributes.lastStopIndex]?.name || 'Na trase...',
            delay: `${attributes.delay} min`,
            carrier: attributes.carrier || 'DPMD',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    getRouteInfo(id, attributes) {
        return attributes ? getGtfsRoute(this.linkospoj(attributes)) : null;
    }

    async getTimetable(id, attributes) {
        const stops = attributes?.stops || [];
        return stops.map((stop, index) => {
            const passed = index <= attributes.lastStopIndex;
            const block = {
                planned: stop.time,
                actual: passed ? stop.time : addMinutes(stop.time, attributes.delay),
                color: passed ? '#58d68d' : delayColor(attributes.delay)
            };
            const isLast = index === stops.length - 1;
            return { station: stop.name, arr: isLast ? block : null, dep: isLast ? null : block, isPassing: false, isNAD: false };
        });
    }
}
