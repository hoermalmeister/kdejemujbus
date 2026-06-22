import BaseProvider from './BaseProvider.js';

export default class PidProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'PID';
        this.apiUrl = 'https://grapp-bridge.onrender.com/pid';
        this.detailUrl = 'https://grapp-bridge.onrender.com/pid/detail';
        this.shapeUrl = 'https://grapp-bridge.onrender.com/pid/shape';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`PID Můstek vrátil chybu: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data);
        } catch (error) { return []; }
    }

    async getDetails(globalId, attributes) {
        if (!attributes || !attributes.vehicle || attributes.routeType === undefined) return null;

        const url = `${this.detailUrl}?route_type=${attributes.routeType}&vehicle=${attributes.vehicle}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            // PID nám vrací JSON, uvnitř kterého je HTML kód vizitky
            const html = data.infowindow_content;
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const route = doc.querySelector('.routeId')?.textContent.trim() || attributes.route || '?';
            const destination = doc.querySelector('.headsign')?.textContent.trim() || attributes.headsign || '?';
            
            // Hledání poslední zastávky
            let stop = '?';
            const currentStopRow = doc.querySelector('.currentStop');
            if (currentStopRow) {
                const tds = currentStopRow.querySelectorAll('td');
                if (tds.length >= 2) stop = tds[1].textContent.trim();
            }

            // Hledání zpoždění
            let delay = '0 min';
            const delaySpan = doc.querySelector('.currentDelay span');
            if (delaySpan) delay = delaySpan.textContent.replace('min.', 'min').trim();

            // Hledání dopravce
            let carrier = 'PID';
            const operatorTd = doc.querySelector('td.operator');
            if (operatorTd) carrier = operatorTd.textContent.replace(/\n/g, '').trim().split('  ')[0]; // Ořezání zbytečných znaků

            return { route, destination, stop, delay, carrier, isNAD: false };
        } catch (error) { return null; }
    }

    async getRouteInfo(globalId, attributes) {
        // Zde s výhodou použijeme tripId, které už máme v globalId (např. pid_135_998_260302)
        const tripId = globalId.replace('pid_', '');
        const url = `${this.shapeUrl}?id=${tripId}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.shape || !Array.isArray(data.shape)) return null;
            
            // Převedeme shape data na formát [lon, lat] pro naši mapu
            return data.shape.map(point => [point.lon, point.lat]);
        } catch (error) { return null; }
    }

    async getTimetable(globalId, attributes) {
        const tripId = globalId.replace('pid_', '');
        const url = `${this.shapeUrl}?id=${tripId}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.stops || !Array.isArray(data.stops)) return null;

            // PID v getShape neposílá časy, ale pouze seznam zastávek. 
            // Prozatím tedy vypíšeme jen seznam názvů s pomlčkami místo časů.
            return data.stops.map(stop => ({
                station: stop.stopName,
                isNAD: false,
                isPassing: false,
                arr: { actual: '-', planned: null, color: '#aaa' },
                dep: { actual: '-', planned: null, color: '#aaa' }
            }));
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.trips || !Array.isArray(rawData.trips)) return [];
        const vehicles = [];
        
        for (const trip of rawData.trips) {
            if (trip.routeType === 2) continue; // Zahazujeme vlaky

            const heading = (trip.bearing !== undefined && trip.bearing !== null) ? trip.bearing : null;
            const headsign = trip.headsign || 'Neznámý cíl';

            vehicles.push({
                id: `pid_${trip.tripId}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon,
                heading: heading,
                route: trip.route || '?',
                headsign: headsign,
                globalMatchId: `pid_${trip.route}_${trip.tripId}`, 
                delay: trip.delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
