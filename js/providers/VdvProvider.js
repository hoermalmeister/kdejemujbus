import BaseProvider from './BaseProvider.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
        this.apiUrl = 'https://corsproxy.io/?https://mapavdv.kr-vysocina.cz/Ajax/GetPoints';
        this.detailUrl = 'https://corsproxy.io/?https://mapavdv.kr-vysocina.cz/Ajax/OpenInfoWindow?id=';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`VDV API chyba: ${response.status}`);
            
            const data = await response.json();
            // Normalizace je teď asynchronní (skenuje HTML), musíme použít await!
            return await this.normalize(data);
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

        let stop = attributes.currentStop || 'Na trase...';
        
        let delayNum = attributes.delay;
        let delayText = '0 min';
        if (delayNum === -2147483648) delayText = 'Neznámé';
        else if (delayNum !== 0) delayText = delayNum > 0 ? `+${delayNum} min` : `${delayNum} min`;

        let route = shortRoute;
        let timetableRoute = fullText;

        // Pokud jsme spoj (číslo) zjistili už při skenování zpoždění, rovnou ho použijeme
        if (attributes.spoj) {
            route = `${shortRoute}/${attributes.spoj}`;
            timetableRoute = `${fullText}/${attributes.spoj}`;
        }

        // Stejně se ale dotážeme znovu, abychom měli co nejčerstvější zastávku a oběh pro kliknuté vozidlo
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
                        const key = th.textContent.trim();
                        const val = td.textContent.trim();
                        
                        if (key === 'Linka') fullText = val;
                        if (key === 'Spoj') exSpoj = val;
                        if (key === 'Zastávka') stop = val;
                        if (key === 'Zpoždění') {
                            if (val.toLowerCase().includes('včas') || val === '0 min.') delayText = '0 min';
                            else {
                                let parsed = parseInt(val);
                                if (!isNaN(parsed)) delayText = parsed > 0 ? `+${parsed} min` : `${parsed} min`;
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

        return {
            route: route,                // Třímístná + spoj do Rozcestníku
            timetableRoute: timetableRoute, // Plná šestimístná + spoj do detailu
            destination: destination,
            stop: stop, 
            delay: delayText,
            carrier: 'VDV Vysočina',
            isNAD: false
        };
    }

    async getRouteInfo() { return null; }
    async getTimetable() { return null; }

    async normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        
        // 1. ZÁKLADNÍ FILTR: Zahodíme vlaky a MHD (krátké texty)
        const validTrips = rawData.filter(trip => {
            if (trip.traction === "TRAIN") return false;
            if (!trip.text || trip.text.length <= 3) return false;
            return true;
        });

        const results = [];
        const chunkSize = 15; // Ochrana proti zablokování z corsproxy.io (maximálně 15 souběžných žádostí)

        // 2. CHYTRÁ ITERACE: Skenujeme spoje ve skupinkách
        for (let i = 0; i < validTrips.length; i += chunkSize) {
            const chunk = validTrips.slice(i, i + chunkSize);
            
            const promises = chunk.map(async (trip) => {
                let isUnknownDelay = (trip.delay === -2147483648);
                let headsign = trip.finalStopName || 'Neznámý cíl';
                if (headsign.includes('N/a')) headsign = 'Neznámý cíl';
                let shortRoute = trip.text.slice(-3);

                const vehicleObj = {
                    id: `vdv_${trip.id}`,
                    provider: this.providerName,
                    lat: trip.lat,
                    lon: trip.lng,
                    heading: null, // Vždycky kolečko, chybí orientace
                    route: shortRoute,
                    headsign: headsign,
                    globalMatchId: `vdv_${trip.text}_${trip.id}`,
                    delay: trip.delay === -2147483648 ? 0 : trip.delay,
                    attributes: { ...trip }
                };

                // 3. ODHALOVÁNÍ FANTOMŮ S NULL ZPOŽDĚNÍM
                if (isUnknownDelay) {
                    try {
                        const res = await fetch(`${this.detailUrl}${trip.id}`);
                        if (!res.ok) return vehicleObj;
                        
                        const html = await res.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        
                        let currentStop = null;
                        let spoj = null;
                        
                        doc.querySelectorAll('tr').forEach(tr => {
                            const th = tr.querySelector('th');
                            const td = tr.querySelector('td');
                            if (th && td) {
                                if (th.textContent.trim() === 'Zastávka') currentStop = td.textContent.trim();
                                if (th.textContent.trim() === 'Spoj') spoj = td.textContent.trim();
                            }
                        });

                        // FILTR KONEČNÉ ZASTÁVKY
                        // Pokud autobus hlásí, že se nachází na zastávce, která je shodná s jeho cílem,
                        // pak už s největší pravděpodobností stojí na konečné vypnutý.
                        if (currentStop && trip.finalStopName && currentStop.trim().toLowerCase() === trip.finalStopName.trim().toLowerCase()) {
                            return null; // Autobus z mapy kompletně smažeme!
                        }

                        // Autobus žije! Uložíme zjištěné jméno zastávky i číslo spoje, 
                        // ať se to propíše do rozcestníku a urychlí načítání.
                        vehicleObj.attributes.spoj = spoj;
                        vehicleObj.attributes.currentStop = currentStop;
                        
                        if (spoj) {
                            vehicleObj.route = `${shortRoute}/${spoj}`;
                        }
                        
                    } catch (e) {
                        // Pokud CORS selže, ponecháme ho raději na mapě (Fallback)
                    }
                }

                return vehicleObj;
            });

            // Počkáme, až se skupinka 15 autobusů vyřeší, a jdeme na další
            const chunkResults = await Promise.all(promises);
            results.push(...chunkResults);
        }

        // Vrátíme pole pouze živých vozidel (smaže ty vrácené jako null)
        return results.filter(v => v !== null);
    }
}
