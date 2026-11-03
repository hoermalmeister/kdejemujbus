import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/idok';
// Linka 1 má celostátní číslo 425001 a tak dále
const LINE_PREFIX = '425';

export default class IdokProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDOK';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(BRIDGE_URL);
            if (!response.ok) throw new Error(`IDOK chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error('Chyba IDOK:', error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        for (const item of rawData) {
            const [line, run] = String(item.id || '').split('_');
            if (!line || !run || !item.lat || !item.lng) continue;
            const fullLine = `${LINE_PREFIX}${line.padStart(3, '0')}`;

            vehicles.push({
                id: `idok_${item.id}`,
                provider: this.providerName,
                lat: item.lat,
                lon: item.lng,
                heading: item.heading,
                route: item.label || line,
                headsign: 'Neznámý cíl',
                globalMatchId: `${fullLine}_${run}`,
                delay: '0 min',
                attributes: { rawId: item.id, line, run, fullLine, label: item.label || line }
            });
        }
        return vehicles;
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        const details = {
            route: `${attributes.label}/${attributes.run}`,
            timetableRoute: `${attributes.fullLine}/${attributes.run}`,
            destination: 'Neznámý cíl',
            stop: 'Na trase...',
            delay: 'Neznámé',
            carrier: 'IDOK',
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: false
        };

        try {
            const response = await fetch(`${BRIDGE_URL}/detail?id=${encodeURIComponent(attributes.rawId)}`);
            if (!response.ok) return details;
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            for (const row of doc.querySelectorAll('.content-in > div')) {
                const label = row.querySelector('span')?.textContent.trim() || '';
                const value = row.textContent.replace(label, '').trim();
                if (label.startsWith('Směr') && value) details.destination = value;
                if (label.startsWith('Zpoždění')) {
                    const minutes = parseFloat(value.replace(',', '.'));
                    if (!isNaN(minutes)) details.delay = `${Math.round(minutes)} min`;
                }
            }
        } catch (error) {
            console.warn('Detail IDOK se nepodařilo stáhnout.', error);
        }
        return details;
    }

    async getRouteInfo(id, attributes) {
        if (!attributes) return null;
        try {
            const response = await fetch(`${BRIDGE_URL}/route?line=${encodeURIComponent(attributes.line)}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data.lines && data.lines.length > 0 ? data.lines : null;
        } catch (error) {
            console.warn('Trasu IDOK se nepodařilo stáhnout.', error);
            return null;
        }
    }
}
