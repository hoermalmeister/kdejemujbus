import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/gepard';

function delayColor(minutes) {
    if (minutes > 15) return '#e74c3c';
    if (minutes > 5) return '#f39c12';
    if (minutes < 0) return '#bada55';
    return '#58d68d';
}

function minutesBetween(planned, actual) {
    const [ph, pm] = planned.split(':').map(Number);
    const [ah, am] = actual.split(':').map(Number);
    let diff = (ah * 60 + am) - (ph * 60 + pm);
    if (diff < -720) diff += 1440; // přes půlnoc
    if (diff > 720) diff -= 1440;
    return diff;
}

// Gepard Express – úzkokolejky JHMD. Polohu dopočítává můstek z časů v zastávkách;
// trasa je spojnice zastávek a jízdní řád přichází rovnou s polohou.
export default class GepardProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'JHMD';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`Gepard chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba Gepard:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        return rawData
            .filter(item => item.lat && item.lng && item.number)
            .map(item => ({
                id: `gepard_${item.number}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: item.category || 'Os',
                headsign: item.destination || 'Neznámý cíl',
                // Stejný klíč jako GRAPP ("Os 21200"), aby se vlak neukázal dvakrát
                globalMatchId: `${item.category || 'Os'} ${item.number}`,
                delay: `${item.delay || 0} min`,
                attributes: { ...item }
            }));
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        const delay = attributes.delay || 0;
        const label = `${attributes.category || 'Os'} ${attributes.number}`;
        return {
            route: attributes.name ? `${label} ${attributes.name}` : label,
            timetableRoute: label,
            destination: attributes.destination || 'Neznámý cíl',
            stop: attributes.stop || 'Na trase...',
            delay: `${delay} min`,
            delayColor: delayColor(delay),
            carrier: attributes.carrier || 'Gepard Express',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };
    }

    // Trasa = spojnice souřadnic zastávek
    async getRouteInfo(id, attributes) {
        const shape = (attributes?.stops || []).map(stop => [stop.lng, stop.lat]);
        return shape.length >= 2 ? shape : null;
    }

    async getTimetable(id, attributes) {
        const block = (planned, actual) => {
            if (!planned) return null;
            const shown = actual || planned;
            return { planned, actual: shown, color: delayColor(minutesBetween(planned, shown)) };
        };
        return (attributes?.stops || []).map(stop => ({
            station: stop.name,
            arr: block(stop.planArr, stop.actArr),
            dep: block(stop.planDep, stop.actDep),
            isPassing: false,
            isNAD: Boolean(stop.isNAD)
        }));
    }
}
