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

        // 1. ZÁCHRANNÁ SÍŤ (Fallback)
        let route = attributes.route || '?';
        let destination = attributes.headsign || '?';
        let stop = 'Zjišťuji...';
        let delayNum = attributes.delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        let carrier = 'PID';
        let isNAD = false;

        // Proměnná pro detekci vozu, který ještě nevyjel
        let isWaiting = (attributes.inactive === true || attributes.statePosition === 'before_track');

        // Pokud vůz čeká na konečné, UI zobrazí automaticky "Bez zpoždění"
        if (isWaiting) {
            delay = '0 min'; 
        }

        // 2. STÁHNUTÍ DETAILŮ Z API A PRECIZNÍ PARSOVÁNÍ HTML
        if (attributes.vehicle !== undefined && attributes.routeType !== undefined) {
            const url = `${this.detailUrl}?route_type=${attributes.routeType}&vehicle=${attributes.vehicle}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data && data.infowindow_content) {
                        const doc = new DOMParser().parseFromString(data.infowindow_content, 'text/html');

                        // CÍLOVÁ STANICE
                        const headsignDiv = doc.querySelector('.headsign');
                        if (headsignDiv) destination = headsignDiv.textContent.trim();

                        // DOPRAVCE A PŘESNÁ LINKA/SPOJ
                        const operatorTds = doc.querySelectorAll('td.operator');
                        if (operatorTds.length > 0) {
                            carrier = operatorTds[0].textContent.replace(/\n/g, '').trim().split(/\s{2,}/)[0];
                        }
                        operatorTds.forEach(td => {
                            const text = td.textContent.replace(/\n/g, '').trim();
                            if (text.includes(' na ')) {
                                const parts = text.split(' na ');
                                if (parts.length > 1) {
                                    route = parts[1].trim(); 
                                }
                            }
                        });

                        // VÝCHOZÍ ZASTÁVKA (Načteme si ji pro jistotu vždy)
                        let fromStop = null;
                        const fromStopRow = doc.querySelector('.fromStopName');
                        if (fromStopRow) {
                            const tds = fromStopRow.querySelectorAll('td');
                            if (tds.length >= 2) fromStop = tds[1].textContent.trim();
                        }

                        // POSLEDNÍ PROJETÁ ZASTÁVKA
                        let currentStop = null;
                        const currentStopRow = doc.querySelector('.currentStop');
                        if (currentStopRow) {
                            const tds = currentStopRow.querySelectorAll('td');
                            if (tds.length >= 2) currentStop = tds[1].textContent.trim();
                        }

                        // --- LOGIKA PRO URČENÍ ZOBRAZENÉ ZASTÁVKY ---
                        if (isWaiting && fromStop) {
                            // 1. Pokud vůz ještě nevyjel, vezmeme Výchozí zastávku
                            stop = fromStop;
                        } else if (currentStop) {
                            // 2. Pokud je na cestě, vezmeme Poslední projetou zastávku
                            stop = currentStop;
                        } else if (fromStop) {
                            // 3. Extrémní záloha, pokud by currentStop chybělo
                            stop = fromStop;
                        } else {
                            stop = 'Neznámá';
                        }

                        // ZPOŽDĚNÍ / NÁSKOK
                        const currentDelayDiv = doc.querySelector('.currentDelay');
                        if (currentDelayDiv) {
                            if (currentDelayDiv.classList.contains('inactive')) {
                                delay = '0 min'; 
                            } else {
                                const delaySpan = currentDelayDiv.querySelector('span');
                                if (delaySpan) {
                                    let delayRaw = delaySpan.textContent.replace(/\u00A0/g, '').replace('min.', '').replace(/\s+/g, '');
                                    if (delayRaw !== '') {
                                        delay = delayRaw + ' min';
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn("PID Detail selhal, použije se fallback:", error);
            }
        }

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
            if (trip.routeType === 2) continue; // Zahazujeme vlaky

            // Vozy čekající na konečné (inactive) dostanou kroužek
            let heading = (trip.bearing !== undefined && trip.bearing !== null) ? trip.bearing : null;
            if (trip.inactive === true || trip.statePosition === 'before_track') {
                heading = null; 
            }

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
