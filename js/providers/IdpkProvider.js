import BaseProvider from './BaseProvider.js';

export default class IdpkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDPK';
        // Směřujeme vše na tvůj bezpečný Můstek na Renderu
        this.apiUrl = 'https://grapp-bridge.onrender.com/idpk';
        this.detailUrl = 'https://grapp-bridge.onrender.com/idpk/detail?id=';
        this.timetableUrl = 'https://grapp-bridge.onrender.com/idpk/timetable?id=';
        this.finishedVehicles = new Set(); // Můžeme si připravit pro budoucí mazání z mapy
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`IDPK Proxy chyba: ${response.status}`);
            
            const rawData = await response.json();
            return this.normalize(rawData || []);
        } catch (error) {
            console.error("Chyba IDPK:", error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            // Bez lokace nebo u dokončených spojů nemá smysl vykreslovat
            if (!trip.lat || !trip.lng) continue;
            if (this.finishedVehicles.has(trip.id)) continue;

            const heading = null; // IDPK neposílá azimut, uděláme statický kruh
            const lineText = trip.text ? trip.text.toString().trim() : "N/A";
            
            let delayText = '0 min';
            if (trip.delay !== undefined && trip.delay !== null) {
                // IDPK občas hází obří záporná čísla pro spoje offline
                if (trip.delay < -1000) delayText = 'Neznámé';
                else delayText = `${trip.delay} min`;
            }

            vehicles.push({
                id: `idpk_${trip.id}`, // Bezpečné globální ID
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng, 
                heading: heading,
                route: lineText,
                headsign: trip.finalStopName || 'Neznámý cíl',
                delay: delayText,
                attributes: {
                    ...trip,
                    rawId: trip.id // Uchováme čisté ID pro JŘ a detail
                }
            });
        }
        return vehicles;
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        try {
            // Voláme tvůj Můstek
            const response = await fetch(`${this.detailUrl}${attributes.rawId}`);
            if (!response.ok) return null;
            const htmlString = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');

            let linka = attributes.text;
            let spoj = "";
            let zastavka = "Na trase...";
            let zpozdeni = attributes.delay < -1000 ? 'Neznámé' : `${attributes.delay} min`;

            // Vytažení dat z tabulky
            const rows = doc.querySelectorAll('table tbody tr');
            rows.forEach(row => {
                const th = row.querySelector('th');
                const td = row.querySelector('td');
                if (th && td) {
                    const key = th.textContent.trim();
                    const val = td.textContent.trim();
                    
                    if (key === "Linka") linka = val;
                    if (key === "Spoj") spoj = val;
                    if (key === "Zastávka") zastavka = val;
                    if (key === "Zpoždění") zpozdeni = val;
                }
            });

            zpozdeni = zpozdeni.replace('min.', 'min').trim();
            const fullRoute = spoj ? `${linka}/${spoj}` : linka;

            return {
                route: attributes.text, 
                timetableRoute: fullRoute, // Např. "430933/7"
                destination: attributes.finalStopName || "Neznámý cíl", 
                stop: zastavka,
                delay: zpozdeni, 
                carrier: attributes.traction === 'TRAIN' ? 'ČD/GWTR' : 'IDPK', 
                isNAD: false, 
                isOdklon: false,
                isOffline: attributes.delay < -1000,
                _cachedHtml: htmlString 
            };
        } catch (error) {
            console.error("Chyba detailu IDPK:", error);
            return null;
        }
    }

    async getTimetable(id, attributes, details) {
        if (!attributes) return [];

        try {
            // Voláme tvůj Můstek
            const response = await fetch(`${this.timetableUrl}${attributes.rawId}`);
            if (!response.ok) return [];
            const htmlString = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');

            let delayMins = 0;
            if (details && details.delay && details.delay !== 'Neznámé') {
                delayMins = parseInt(details.delay) || 0;
            }

            let activeColor = '#58d68d'; 
            if (details && details.isOffline) activeColor = '#7f8c8d'; 
            else if (delayMins > 15) activeColor = '#e74c3c';
            else if (delayMins > 5) activeColor = '#f39c12';
            else if (delayMins < 0) activeColor = '#bada55';

            const addDelay = (timeStr, delayMin) => {
                if (!timeStr || timeStr === '--:--') return null;
                let [h, m] = timeStr.split(':').map(Number);
                m += delayMin;
                if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
                else if (m < 0) { h -= Math.ceil(Math.abs(m) / 60); m = 60 - (Math.abs(m) % 60); }
                if (h >= 24) h %= 24;
                if (h < 0) h = (h % 24) + 24;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            };

            const stops = [];
            const rows = doc.querySelectorAll('#timetableCurrentContainer tbody tr');
            let pastCurrentStop = false;

            rows.forEach(row => {
                const tds = row.querySelectorAll('td');
                if (tds.length >= 3) {
                    const stopName = tds[0].textContent.trim();
                    const arrTime = tds[1].textContent.trim();
                    const depTime = tds[2].textContent.trim();

                    // IDPK má u aktuální zastávky inline CSS barvu #ff112299 (nebo něco v tom smyslu)
                    const style = row.getAttribute('style') || '';
                    const isCurrentStop = style.includes('#ff112299') || style.includes('rgba(255, 17, 34');

                    if (isCurrentStop) {
                        pastCurrentStop = true;
                    }

                    let rowColor = (!pastCurrentStop && !isCurrentStop) ? '#58d68d' : activeColor;

                    stops.push({
                        station: stopName,
                        arr: {
                            planned: arrTime,
                            actual: (!pastCurrentStop && !isCurrentStop) ? arrTime : addDelay(arrTime, delayMins),
                            color: rowColor 
                        },
                        dep: {
                            planned: depTime,
                            actual: (!pastCurrentStop && !isCurrentStop) ? depTime : addDelay(depTime, delayMins),
                            color: rowColor
                        },
                        isPassing: false,
                        isNAD: false 
                    });
                }
            });

            return stops;
        } catch (error) {
            console.error("Chyba JŘ IDPK:", error);
            return [];
        }
    }
}
