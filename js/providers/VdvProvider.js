import BaseProvider from './BaseProvider.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
        this.apiUrl = 'https://grapp-bridge.onrender.com/vdv';
        this.detailUrl = 'https://grapp-bridge.onrender.com/vdv/detail?id=';
        this.timetableUrl = 'https://grapp-bridge.onrender.com/vdv/timetable?id=';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`VDV API chyba: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data);
        } catch (error) {
            console.error("Chyba VDV:", error.message);
            return [];
        }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        let fullText = attributes.text || '?';
        let shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
        
        let destination = attributes.finalStopName || '?';
        if (destination.includes('N/a')) destination = 'Neznámý cíl';

        let stop = 'Na trase...';
        
        let delayNum = attributes.delay;
        let delayText = '0 min';
        
        if (delayNum === -2147483648) {
            delayText = 'Neznámé';
            delayNum = 0;
        } else if (delayNum !== 0) {
            // Zrušeno generování +, app.js si ho přidá samo (prevence ++5 min)
            delayText = `${delayNum} min`;
        }

        let route = shortRoute;
        let timetableRoute = fullText;

        try {
            const res = await fetch(`${this.detailUrl}${attributes.id}`);
            if (res.ok) {
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                
                let exSpoj = null;
                const trs = doc.querySelectorAll('tr');
                
                trs.forEach(tr => {
                    const th = tr.querySelector('th');
                    const td = tr.querySelector('td');
                    if (th && td) {
                        const key = th.textContent.toLowerCase();
                        const val = td.textContent.trim();
                        
                        if (key.includes('linka')) fullText = val;
                        if (key.includes('spoj')) exSpoj = val;
                        if (key.includes('zast')) stop = val;
                        if (key.includes('zpo')) {
                            if (val.toLowerCase().includes('včas') || val.includes('0 min')) {
                                delayText = '0 min';
                                delayNum = 0;
                            } else {
                                let parsed = parseInt(val);
                                if (!isNaN(parsed)) {
                                    delayNum = parsed;
                                    delayText = `${parsed} min`; // Zrušeno +
                                }
                            }
                        }
                    }
                });

                shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
                if (exSpoj) {
                    route = `${shortRoute}/${exSpoj}`;
                    timetableRoute = `${fullText}/${exSpoj}`;
                }
            }
        } catch (e) {
            console.warn("VDV Detail selhal, použiji základní atributy.");
        }

        // ====================================================================
        // INTELIGENTNÍ LOGIKA ZPOŽDĚNÍ
        // ====================================================================

        // 1. ZÁPORNÉ ZPOŽDĚNÍ NA VÝCHOZÍ STANICI (Automatické načtení JŘ)
        if (delayNum < 0) {
            const tt = await this.getTimetable(globalId, attributes);
            if (tt && tt.length > 0) {
                const firstStation = tt[0].station;
                if (stop.toLowerCase() === firstStation.toLowerCase()) {
                    delayNum = 0;
                    delayText = '0 min';
                    attributes.delay = 0; // Propíše se nula i do tabulky JŘ
                }
            }
        }

        // 2. JSME V CÍLOVÉ STANICI?
        let isAtDestination = false;
        if (stop !== 'Na trase...' && destination !== 'Neznámý cíl' && stop.toLowerCase() === destination.toLowerCase()) {
            delayText = 'V cíli';
            delayNum = 0;
            attributes.delay = 0; // Jízdní řád se tváří, že zpoždění není
            isAtDestination = true;
        }

        return { 
            route, 
            timetableRoute, 
            destination, 
            stop, 
            delay: delayText, 
            carrier: 'VDV Vysočina', 
            isNAD: false,
            isAtDestination // Předáváme instrukci pro app.js
        };
    }

    async getRouteInfo() { return null; }

    async getTimetable(globalId, attributes) {
        if (!attributes || attributes.id === undefined) return null;

        try {
            const response = await fetch(`${this.timetableUrl}${attributes.id}`);
            if (!response.ok) return null;
            
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('#timetableCurrentContainer tbody tr');
            if (!rows || rows.length === 0) return null;

            const stops = [];
            // Delay už může být opraveno (na 0) v getDetails
            let delayMins = (attributes.delay !== undefined && attributes.delay !== -2147483648) ? attributes.delay : 0;

            let color = '#58d68d';
            if (delayMins > 15) color = '#e74c3c';
            else if (delayMins > 5) color = '#f39c12';
            else if (delayMins < 0) color = '#bada55';

            const extractTime = (td) => {
                if (!td) return null;
                const text = td.textContent.trim();
                return text && text !== '--:--' && text !== '' ? text : null;
            };

            const calculateActualTime = (plannedTime, delay) => {
                 if (!plannedTime) return null;
                 let parts = plannedTime.split(':');
                 if(parts.length < 2) return plannedTime;
                 let pMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
                 let aMins = pMins + delay;
                 if (aMins < 0) aMins += 24 * 60;
                 if (aMins >= 24 * 60) aMins %= (24 * 60);
                 return `${Math.floor(aMins / 60).toString().padStart(2, '0')}:${(aMins % 60).toString().padStart(2, '0')}`;
            };

            rows.forEach((row, index) => {
                const tds = row.querySelectorAll('td');
                if (tds.length < 3) return;

                const stationName = tds[0].textContent.trim();
                const pArr = extractTime(tds[1]);
                const pDep = extractTime(tds[2]);
                const aArr = calculateActualTime(pArr, delayMins);
                const aDep = calculateActualTime(pDep, delayMins);

                let arrival = null;
                let departure = null;
                const arrBlock = { planned: pArr, actual: aArr, color: color };
                const depBlock = { planned: pDep, actual: aDep, color: color };

                if (index === 0) departure = depBlock;
                else if (index === rows.length - 1) arrival = arrBlock;
                else { arrival = arrBlock; departure = depBlock; }

                stops.push({ station: stationName, isNAD: false, isPassing: false, arr: arrival, dep: departure });
            });
            
            return stops;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        const vehicles = [];
        
        for (const trip of rawData) {
            if (trip.traction === "TRAIN") continue;
            if (!trip.text || trip.text.length <= 3) continue;

            let delay = trip.delay;
            if (delay === -2147483648) delay = 0;

            let headsign = trip.finalStopName || 'Neznámý cíl';
            if (headsign.includes('N/a')) headsign = 'Neznámý cíl';
            
            let shortRoute = trip.text.slice(-3);
            let vehicleHeading = (trip.heading !== undefined && trip.heading !== null) ? Math.round(trip.heading) : null;

            vehicles.push({
                id: `vdv_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng,
                heading: vehicleHeading, 
                route: shortRoute,
                headsign: headsign,
                globalMatchId: `vdv_${trip.text}_${trip.id}`,
                delay: delay,
                attributes: { ...trip }
            });
        }
        return vehicles;
    }
}
