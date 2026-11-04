import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/dpmlb';

function delayColor(minutes) {
    if (minutes > 15) return '#e74c3c';
    if (minutes > 5) return '#f39c12';
    if (minutes < 0) return '#bada55';
    return '#58d68d';
}

export default class DpmlbProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DPMLB';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`DPMLB chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba DPMLB:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.line)
            .map(item => ({
                id: `dpmlb_${item.vehicle}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: item.line,
                headsign: item.destination || 'Neznámý cíl',
                // Zdroj nemá číslo spoje, proto se vozy s ostatními zdroji nepárují
                globalMatchId: `dpmlb_${item.vehicle}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        return {
            route: attributes.route || attributes.line,
            timetableRoute: attributes.fullLine || attributes.line,
            destination: attributes.destination || 'Neznámý cíl',
            stop: 'Na trase...',
            delay: `${attributes.delay || 0} min`,
            delayColor: delayColor(attributes.delay || 0),
            carrier: 'DPMLB',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    // Zdroj neposílá seznam zastávek ani tvar trasy
    async getTimetable() { return []; }
    getRouteInfo() { return null; }
}
