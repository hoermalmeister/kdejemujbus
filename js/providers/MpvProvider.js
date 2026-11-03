import BaseProvider from './BaseProvider.js';

const BRIDGE_URL = 'https://grapp-bridge-production.up.railway.app/mpv';

// Společný základ pro portály na mpvnet.cz (ODIS, IDZK, IDOL, IDESKA).
// Údaje o spoji jsou v poli "cn" oddělené svislítkem.
const CN = { line: 0, shortLine: 1, run: 2, lastStop: 3, nextStop: 5, origin: 8, destination: 9, vehicle: 11 };

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

export default class MpvProvider extends BaseProvider {
    constructor(providerName, portal) {
        super();
        this.providerName = providerName;
        this.apiUrl = `${BRIDGE_URL}/${portal}`;
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(this.apiUrl);
            if (!response.ok) throw new Error(`${this.providerName} chyba: ${response.status}`);
            return this.normalize(await response.json());
        } catch (error) {
            console.error(`Chyba ${this.providerName}:`, error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        for (const item of rawData) {
            const fields = String(item.cn || '').split('|');
            const line = fields[CN.line];
            const run = fields[CN.run];
            if (!line || !run || !item.x || !item.y) continue;

            // "a_270.png" je azimut, "a_stoji.png" stojící vozidlo
            const angle = /^a_(\d+)\./.exec(item.ico || '');
            // Šestimístné linky jsou celostátní, linky MHD se mezi městy opakují
            const matchId = /^\d{6}$/.test(line) ? `${line}_${run}` : `${this.providerName}_${line}_${run}`;

            vehicles.push({
                id: `${this.providerName}_${line}_${run}`,
                provider: this.providerName,
                lat: item.x,
                lon: item.y,
                heading: angle ? Number(angle[1]) : null,
                route: fields[CN.shortLine] || line,
                headsign: fields[CN.destination] || 'Neznámý cíl',
                globalMatchId: matchId,
                delay: `${item.dm || 0} min`,
                attributes: {
                    cat: item.cat,
                    carrier: item.cr,
                    delayMinutes: item.dm || 0,
                    line,
                    run,
                    shortLine: fields[CN.shortLine] || line,
                    lastStop: fields[CN.lastStop] || '',
                    destination: fields[CN.destination] || 'Neznámý cíl'
                }
            });
        }
        return vehicles;
    }

    tripQuery(attributes) {
        return new URLSearchParams({ num1: attributes.line, num2: attributes.run, cat: attributes.cat }).toString();
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        const { shortLine, line, run, lastStop, destination, delayMinutes, carrier } = attributes;
        const atDestination = lastStop !== '' && lastStop === destination;
        return {
            route: `${shortLine}/${run}`,
            timetableRoute: `${line}/${run}`,
            destination,
            stop: lastStop || 'Na trase...',
            delay: atDestination ? 'V cíli' : `${delayMinutes} min`,
            carrier: carrier || this.providerName,
            isNAD: false,
            isOdklon: false,
            isOffline: false,
            isAtDestination: atDestination
        };
    }

    async getRouteInfo(id, attributes) {
        if (!attributes) return null;
        try {
            const response = await fetch(`${this.apiUrl}/route?${this.tripQuery(attributes)}`);
            if (!response.ok) return null;
            const data = await response.json();
            return data.shape && data.shape.length >= 2 ? data.shape : null;
        } catch (error) {
            console.warn(`Trasu ${this.providerName} se nepodařilo stáhnout.`, error);
            return null;
        }
    }

    async getTimetable(id, attributes) {
        if (!attributes) return [];
        try {
            const response = await fetch(`${this.apiUrl}/timetable?${this.tripQuery(attributes)}`);
            if (!response.ok) return [];
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            const rows = [...doc.querySelectorAll('table.timetable tr')].filter(row => row.querySelector('td.timetable-stop'));

            return rows.map((row, index) => {
                const time = row.querySelector('.timetable-time')?.textContent.trim();
                const delay = parseInt(row.querySelector('.timetable-delay')?.textContent, 10) || 0;
                const block = time ? { planned: time, actual: addMinutes(time, delay), color: delayColor(delay) } : null;
                const isLast = index === rows.length - 1;
                return {
                    station: row.querySelector('td.timetable-stop').textContent.trim(),
                    arr: isLast ? block : null,
                    dep: isLast ? null : block,
                    isPassing: false,
                    isNAD: false
                };
            });
        } catch (error) {
            console.error(`Chyba JŘ ${this.providerName}:`, error);
            return [];
        }
    }
}
