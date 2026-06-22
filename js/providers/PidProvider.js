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
        if (!attributes) return null;

        // 1. ZÁCHRANNÁ SÍŤ (Fallback): Vyplníme data z toho, co už víme
        let route = attributes.route || '?';
        let destination = attributes.headsign || '?';
        let stop = 'Zjišťuji...';
        let delayNum = attributes.delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        let carrier = 'PID';
        let isNAD = false;

        // 2. STÁHNUTÍ REÁLNÝCH DETAILŮ Z API (Pokud máme ID vozidla)
        if (attributes.vehicle !== undefined && attributes.routeType !== undefined) {
            const url = `${this.detailUrl}?route_type=${attributes.routeType}&vehicle=${attributes.vehicle}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data && data.infowindow_content) {
                        const doc = new DOMParser().parseFromString(data.infowindow_content, 'text/html');

                        // Poslední zastávka
                        const currentStopRow = doc.querySelector('.currentStop');
                        if (currentStopRow) {
                            const tds = currentStopRow.querySelectorAll('td');
                            if (tds.length >= 2) stop = tds[1].textContent.trim();
                        }

                        // Zpoždění (často obsahuje &nbsp; což je \u00A0 v textContent)
                        const delaySpan = doc.querySelector('.currentDelay span');
                        if (delaySpan) {
                            delay = delaySpan.textContent.replace(/\u00A0/g, ' ').replace('min.', 'min').trim();
                        }

                        // Dopravce
                        const operatorTd = doc.querySelector('td.operator');
                        if (operatorTd) {
                            carrier = operatorTd.textContent.replace(/\n/g, '').trim().split(/\s{2,}/)[0];
                        }
                    }
                }
            } catch (error) {
                console.warn("PID Detail selhal, použije se fallback:", error);
            }
        }

        // Pokud detailní API selhalo, "stop" zůstane "Zjišťuji...", ale UI nespadne
        return { route, destination, stop, delay, carrier, isNAD };
    }

    async getRouteInfo(globalId, attributes) {
        const tripId = globalId.replace('pid_', '');
        const url = `${this.shapeUrl}?id=${tripId}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.shape || !Array.isArray(data.shape)) return null;
            
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
            if (trip.routeType === 2) continue;

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
