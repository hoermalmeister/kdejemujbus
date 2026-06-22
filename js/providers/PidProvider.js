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
        let routeLine = attributes.route || '?';
        let destination = attributes.headsign || '?';
        let stop = 'Zjišťuji...';
        let delayNum = attributes.delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        let carrier = 'PID';
        let isNAD = false;

        let isWaiting = (attributes.inactive === true || attributes.statePosition === 'before_track');
        if (isWaiting) delay = '0 min'; 

        // EXTRAKCE ČÍSLA SPOJE PŘÍMO Z ID (např. pid_589_182_260608 -> vytáhneme 182)
        const idParts = globalId.split('_');
        const runNum = idParts.length >= 3 ? idParts[2] : '';

        // Standardní složení do tvaru "589/182"
        let route = runNum ? `${routeLine}/${runNum}` : routeLine;

        // 2. STÁHNUTÍ DETAILŮ Z API A PRECIZNÍ PARSOVÁNÍ HTML
        if (attributes.vehicle !== undefined && attributes.routeType !== undefined) {
            const url = `${this.detailUrl}?route_type=${attributes.routeType}&vehicle=${attributes.vehicle}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data && data.infowindow_content) {
                        const doc = new DOMParser().parseFromString(data.infowindow_content, 'text/html');

                        // PARSOVÁNÍ ŘÁDKŮ TABULKY (Hledání Dopravce a Oběhu metra)
                        const trs = doc.querySelectorAll('table.vehicleWindowBody tr');
                        trs.forEach(tr => {
                            const tds = tr.querySelectorAll('td');
                            if (tds.length >= 2) {
                                const label = tds[0].textContent.trim();
                                const val = tds[1].textContent.replace(/\n/g, '').trim();
                                
                                if (label === 'Dopravce:') {
                                    carrier = val.split(/\s{2,}/)[0];
                                } else if (label === 'Oběh:') {
                                    // Detekce METRA! (Např. text "C/31" -> vezmeme pouze "C")
                                    routeLine = val.split('/')[0].trim();
                                }
                            }
                        });

                        // Nyní aktualizujeme Linku/Spoj znova, kdyby se linka změnila na "A", "B" nebo "C"
                        route = runNum ? `${routeLine}/${runNum}` : routeLine;

                        // CÍLOVÁ STANICE A PŘEJEZDY KURZŮ (Interlining)
                        const headsignDiv = doc.querySelector('.headsign');
                        if (headsignDiv) {
                            // Nahradíme <br> mezerou, ať se nám neslepí slova
                            let destText = headsignDiv.innerHTML.replace(/<br\s*\/?>/ig, ' ');
                            const tempDoc = new DOMParser().parseFromString(destText, 'text/html');
                            destText = tempDoc.body.textContent.replace(/\s+/g, ' ').trim();

                            // Magický Regex hledající strukturu "... dále jako linka ... směr ..."
                            const match = destText.match(/(.*?)dále jako linka\s+(.*?)\s+směr\s+(.*)/i);
                            if (match) {
                                let firstDest = match[1].trim();
                                let nextRoute = match[2].trim();
                                let secondDest = match[3].trim();
                                
                                // Aplikace tvého požadovaného formátu!
                                destination = `${firstDest} > ${secondDest}`;
                                route = `${route} > ${nextRoute}`; // např. "589/182 > 389"
                            } else {
                                destination = destText;
                            }
                        }

                        // VÝCHOZÍ ZASTÁVKA
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

                        // LOGIKA ZOBRAZENÉ ZASTÁVKY
                        if (isWaiting && fromStop) stop = fromStop;
                        else if (currentStop) stop = currentStop;
                        else if (fromStop) stop = fromStop;
                        else stop = 'Neznámá';

                        // ZPOŽDĚNÍ, NÁSKOK A "VČAS"
                        const currentDelayDiv = doc.querySelector('.currentDelay');
                        if (currentDelayDiv) {
                            if (currentDelayDiv.classList.contains('inactive')) {
                                delay = '0 min'; 
                            } else {
                                const delaySpan = currentDelayDiv.querySelector('span');
                                if (delaySpan) {
                                    // Očistíme text od entit a mezer a převedeme na malá písmena
                                    let delayRaw = delaySpan.textContent.replace(/\u00A0/g, '').replace('min.', '').replace(/\s+/g, '').toLowerCase();
                                    
                                    if (delayRaw.includes('včas')) {
                                        delay = '0 min'; // O zbytek se postará náš app.js (Zelená + "Bez zpoždění")
                                    } else if (delayRaw !== '') {
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
