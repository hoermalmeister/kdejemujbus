import BaseProvider from './BaseProvider.js';

export default class DukProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DÚK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/duk'; 
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`DÚK Proxy chyba: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data.ItemL || []);
        } catch (error) {
            console.error("Chyba DÚK:", error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            // Ignorujeme vlaky (Traction = 5) a chybné GPS pozice (0, 0)
            if (trip.Traction === 5) continue;
            if (trip.Lat === 0 && trip.Lng === 0) continue;

            const lineText = trip.LineText || "";
            const routeId = trip.RouteID || ""; // V DÚK RouteID reprezentuje spoj

            if (!lineText) continue;

            // Pokud vozidlo čeká (IsWaiting = true), nastavíme heading na null (zobrazí se kroužek)
            const heading = trip.IsWaiting ? null : trip.Azimut;

            // Zpoždění endpoint nevrací, pouze někdy ikonu do DelaySign. Vynutíme Neznámé.
            let delay = trip.DelaySign ? trip.DelaySign : 'Neznámé';

            vehicles.push({
                id: `duk_${trip.ID}`, 
                provider: this.providerName,
                lat: trip.Lat,
                lon: trip.Lng, 
                heading: heading,
                route: lineText,
                headsign: 'Neznámý cíl', // Endpoint neposkytuje cílovou stanici
                globalMatchId: `duk_${lineText}_${routeId}`, 
                delay: delay,
                attributes: {
                    ...trip,
                    cisjrLine: lineText,
                    cisjrRun: routeId
                }
            });
        }
        return vehicles;
    }

    // Bez endpointu pro detail vygenerujeme "falešný" detail z toho, co máme
    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        return {
            route: `${attributes.cisjrLine}/${attributes.cisjrRun}`, 
            timetableRoute: `${attributes.cisjrLine}/${attributes.cisjrRun}`,
            destination: 'Neznámý cíl', 
            stop: 'Na trase...',
            delay: attributes.delay === 'Neznámé' ? 'Neznámé' : `${attributes.delay} min`, 
            carrier: 'DÚK', 
            isNAD: attributes.Traction === 254, // Traction 254 často u DÚKu značí náhradní dopravu
            isOdklon: false
        };
    }

    // Jízdní řád aktuálně z hlavního feedu poskládat nelze
    async getTimetable(id, attributes, details) {
        return [];
    }

    async getRouteInfo() {
        return null;
    }
}
