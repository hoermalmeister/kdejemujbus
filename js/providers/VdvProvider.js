import BaseProvider from './BaseProvider.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
        // API nemá CORS ochranu, můžeme z něj tahat data přímo prohlížečem!
        this.apiUrl = 'https://mapavdv.kr-vysocina.cz/Ajax/GetPoints';
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

        let route = attributes.text || '?';
        
        // VDV často posílá u cílové stanice technické nesmysly typu "-1 N/a"
        let destination = attributes.finalStopName || '?';
        if (destination.includes('N/a')) {
            destination = 'Neznámý cíl';
        }

        // Zpracování zpoždění
        let delayNum = attributes.delay;
        let delayText = '0 min';
        if (delayNum === -2147483648) {
            delayText = 'Neznámé';
        } else if (delayNum !== 0) {
            delayText = delayNum > 0 ? `+${delayNum} min` : `${delayNum} min`;
        }

        return {
            route: route,
            timetableRoute: route, 
            destination: destination,
            stop: 'Poloha na trase (VDV neposílá zastávky)', 
            delay: delayText,
            carrier: 'VDV Vysočina',
            isNAD: false
        };
    }

    // VDV v tomto základním endpointu nenabízí tvary tras ani detailní jízdní řády
    async getRouteInfo() { return null; }
    async getTimetable() { return null; }

    normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        
        const vehicles = [];
        for (const trip of rawData) {
            // Ignorujeme vlaky
            if (trip.traction === "TRAIN") continue;
            
            // Ignorujeme linky o 3 nebo méně znacích (zpravidla MHD)
            if (!trip.text || trip.text.length <= 3) continue;

            // Ošetření chybných zpoždění z VDV API
            let delay = trip.delay;
            if (delay === -2147483648) delay = 0;

            let headsign = trip.finalStopName || 'Neznámý cíl';
            if (headsign.includes('N/a')) headsign = 'Neznámý cíl';

            vehicles.push({
                id: `vdv_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng,
                heading: null, // Vždycky kroužek
                route: trip.text,
                headsign: headsign,
                globalMatchId: `vdv_${trip.text}_${trip.id}`,
                delay: delay,
                attributes: { ...trip }
            });
        }
        return vehicles;
    }
}
