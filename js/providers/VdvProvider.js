import BaseProvider from './BaseProvider.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
        // Používáme tvůj spolehlivý Můstek místo problémového corsproxy
        this.apiUrl = 'https://grapp-bridge.onrender.com/vdv';
        this.detailUrl = 'https://grapp-bridge.onrender.com/vdv/detail?id=';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`VDV API chyba: ${response.status}`);
            
            const data = await response.json();
            // Návrat k bleskovému, synchronnímu zpracování
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
        if (delayNum === -2147483648) delayText = 'Neznámé';
        else if (delayNum !== 0) delayText = delayNum > 0 ? `+${delayNum} min` : `${delayNum} min`;

        let route = shortRoute;
        let timetableRoute = fullText;

        try {
            // Teprve PO KLIKNUTÍ si stáhneme detaily ze serveru
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
                    // Propsání 3-místného a 6-místného čísla spoje do UI
                    route = `${shortRoute}/${exSpoj}`;
                    timetableRoute = `${fullText}/${exSpoj}`;
                }
            }
        } catch (e) {
            console.warn("VDV Detail selhal, použiji základní atributy.");
        }

        return {
            route: route,
            timetableRoute: timetableRoute,
            destination: destination,
            stop: stop, 
            delay: delayText,
            carrier: 'VDV Vysočina',
            isNAD: false
        };
    }

    async getRouteInfo() { return null; }
    async getTimetable() { return null; }

    normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        
        const vehicles = [];
        
        for (const trip of rawData) {
            // Ignorujeme vlaky a MHD (krátké texty)
            if (trip.traction === "TRAIN") continue;
            if (!trip.text || trip.text.length <= 3) continue;

            let delay = trip.delay;
            if (delay === -2147483648) delay = 0; // Pro barvu zpoždění na mapě použijeme 0

            let headsign = trip.finalStopName || 'Neznámý cíl';
            if (headsign.includes('N/a')) headsign = 'Neznámý cíl';
            
            // Přísně třímístná linka pro mapové ikony!
            let shortRoute = trip.text.slice(-3);

            vehicles.push({
                id: `vdv_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng,
                heading: null, // Vždycky kolečko (VDV nedává směrování)
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
