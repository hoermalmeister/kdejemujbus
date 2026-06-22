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

        // IDS JMK zatím nemá napojený detailní parser, použijeme chytrou zálohu ze základních dat
        let route = attributes.LineName || '?';
        let destination = attributes.FinalStopName || '?';
        
        let delayNum = attributes.Delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        let isWaiting = attributes.IsInactive === true;
        if (isWaiting) delay = '0 min'; 

        return { 
            route: route, 
            destination: destination, 
            stop: isWaiting ? 'Výchozí zastávka (Čeká)' : 'Na trase...', 
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
            // VType 5 jsou vlaky (S2, S3, R8 atd.). Ty rovnou zahazujeme, máme je z GRAPPu.
            if (trip.VType === 5) continue; 

            // Nastavení šipky vs kroužku (pokud vůz čeká)
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
                route: trip.LineName || '?',
                headsign: trip.FinalStopName || 'Neznámý cíl',
                globalMatchId: `idsjmk_${trip.LineName}_${trip.Course}`, 
                delay: trip.Delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
