import BaseProvider from './BaseProvider.js';

export default class IdpkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDPK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/idpk';
        this.detailUrl = 'https://grapp-bridge.onrender.com/idpk/detail?id=';
        this.timetableUrl = 'https://grapp-bridge.onrender.com/idpk/timetable?id=';
        this.finishedVehicles = new Set(); 
        
        // [NOVÉ] Paměť pro minulé polohy vozidel (stejné jako u VDV)
        this.vehicleHistory = new Map(); 
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`IDPK Proxy chyba: ${response.status}`);
            
            let rawData = await response.json();

            if (typeof rawData === 'string') {
                rawData = JSON.parse(rawData);
            }

            const dataArray = Array.isArray(rawData) ? rawData : (rawData.data || rawData.points || []);
            return this.normalize(dataArray);
        } catch (error) {
            console.error("Chyba IDPK:", error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            if (!trip.lat || !trip.lng) continue;
            if (this.finishedVehicles.has(trip.id)) continue;
            
            // Filtr: Nezobrazovat vlaky a chybné entity
            if (trip.traction === 'TRAIN') continue;

            const heading = trip.bearing !== undefined ? trip.bearing : null; 
            
            if (this.finishedVehicles.has(trip.id)) {
                heading = null;
            }
            
            const lineText = trip.text ? trip.text.toString().trim() : "N/A";
            
            // Ořezání linky pro bublinu na mapě (poslední 3 znaky)
            let shortLine = lineText;
            if (shortLine.length >= 3) {
                shortLine = shortLine.slice(-3).replace(/^0+/, '') || "0"; 
            }
            
            let delayText = '0 min';
            if (trip.delay !== undefined && trip.delay !== null) {
                if (trip.delay < -1000) delayText = 'Neznámé';
                else delayText = `${trip.delay} min`;
            }

            vehicles.push({
                id: `idpk_${trip.id}`, 
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng, 
                heading: heading, // Nyní bude generovat správné šipky ihned po načtení stránky
                route: shortLine, 
                headsign: trip.finalStopName || 'Neznámý cíl',
                delay: delayText,
                globalMatchId: `idpk_${trip.id}`,
                attributes: {
                    ...trip,
                    rawId: trip.id,
                    fullLine: lineText 
                }
            });
        }
        return vehicles;
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        try {
            const response = await fetch(`${this.detailUrl}${attributes.rawId}`);
            if (!response.ok) return null;
            const htmlString = await response.text();

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');

            let linka = attributes.fullLine || attributes.text;
            let spoj = "";
            let zastavka = "Na trase...";
            let destination = attributes.finalStopName || "Neznámý cíl";

            // --- ZPOŽDĚNÍ: Přesná struktura jako u VDV ---
            let delayVal = attributes.delay;
            let delayText = '0 min';
            let delayNum = 0;

            if (delayVal < -1000) {
                delayText = 'Neznámé';
                delayNum = 'Neznámé';
            } else if (delayVal !== 0 && delayVal !== undefined && delayVal !== null) {
                delayNum = parseInt(delayVal) || 0;
                delayText = `${delayNum} min`;
            }

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
                    if (key === "Zpoždění") {
                        // Očistíme text od "min." a vytáhneme číslo
                        let parsed = parseInt(val.replace('min.', '').trim());
                        if (!isNaN(parsed)) {
                            delayNum = parsed;
                            delayText = `${parsed} min`;
                        }
                    }
                }
            });

            let isAtDestination = false;
            if (zastavka !== 'Na trase...' && destination !== 'Neznámý cíl' && zastavka.toLowerCase() === destination.toLowerCase()) {
                delayText = 'V cíli';
                delayNum = 0;
                attributes.delay = 0; // Jízdní řád se tváří, že zpoždění neexistuje
                isAtDestination = true;
                this.finishedVehicles.add(attributes.rawId); // Odstraní šipku z mapy
            }
            
            let shortLinka = String(linka);
            if (shortLinka.length >= 3) {
                shortLinka = shortLinka.slice(-3).replace(/^0+/, '') || "0";
            }
            const headerRoute = spoj ? `${shortLinka}/${spoj}` : shortLinka;
            const fullRoute = spoj ? `${linka}/${spoj}` : linka;

            return {
                route: headerRoute, 
                timetableRoute: fullRoute, 
                destination: destination, 
                stop: zastavka,
                delay: delayText, // Nyní poctivě předáváme delayText
                carrier: 'IDPK', 
                isNAD: false, 
                isOdklon: false,
                isOffline: delayNum === 'Neznámé',
                isAtDestination: isAtDestination, 
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
