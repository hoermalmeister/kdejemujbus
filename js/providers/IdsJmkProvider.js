import BaseProvider from './BaseProvider.js';

export default class IdsJmkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDS JMK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/idsjmk';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) {
                const errorText = await response.text(); 
                throw new Error(`Můstek vrátil chybu ${response.status}: ${errorText}`);
            }
            
            const data = await response.json();
            return this.normalize(data);
        } catch (error) { 
            console.error("Chyba IDS JMK:", error.message);
            return []; 
        }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        // VYUŽITÍ CÍLE 1: Linka/Spoj
        let routeLine = attributes.LineName || '?';
        let routeId = attributes.RouteID || ''; // Zde se ukrývá číslo spoje!
        let route = routeId ? `${routeLine}/${routeId}` : routeLine;

        let destination = attributes.FinalStopName || '?';
        
        // VYUŽITÍ CÍLE 2: Vyhledání názvu podle GTFS (Připravil nám to Můstek!)
        let stop = 'Na trase...';
        if (attributes.LastStopName) {
            stop = attributes.LastStopName;
        }

        let delayNum = attributes.Delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        
        let isWaiting = attributes.IsInactive === true;
        if (isWaiting) {
            delay = '0 min'; 
            if (attributes.LastStopName) {
                stop = `Výchozí zastávka: ${attributes.LastStopName}`;
            } else {
                stop = 'Čeká na výchozí zastávce';
            }
        }

        return { 
            route: route, 
            destination: destination, 
            stop: stop, 
            delay: delay, 
            carrier: 'IDS JMK', 
            isNAD: false 
        };
    }

    async getRouteInfo(globalId, attributes) { return null; }
    async getTimetable(globalId, attributes) { return null; }

    normalize(rawData) {
        if (!rawData || !rawData.Vehicles || !Array.isArray(rawData.Vehicles)) return [];
        const vehicles = [];
        
        for (const trip of rawData.Vehicles) {
            // Vlaky S2, S3, R8 atd. z jihu rovnou zahazujeme, máme je z GRAPPu.
            if (trip.VType === 5) continue; 

            let heading = (trip.Bearing !== undefined && trip.Bearing !== null) ? trip.Bearing : null;
            if (trip.IsInactive === true) {
                heading = null; 
            }

            vehicles.push({
                id: `idsjmk_${trip.ID}`,
                provider: this.providerName,
                lat: trip.Lat,
                lon: trip.Lng,
                heading: heading,
                route: trip.LineName || '?', // Do samotné mapy posíláme pořád jen "1", "67", atd.
                headsign: trip.FinalStopName || 'Neznámý cíl',
                
                // Match ID se teď inteligentně váže na RouteID
                globalMatchId: `idsjmk_${trip.LineName}_${trip.RouteID}`, 
                
                delay: trip.Delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
