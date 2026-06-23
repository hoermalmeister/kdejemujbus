import BaseProvider from './BaseProvider.js';

export default class IdsJmkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDS JMK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/idsjmk';
        this.routeUrl = 'https://grapp-bridge.onrender.com/idsjmk-route';
        this.timetableUrl = 'https://grapp-bridge.onrender.com/idsjmk-timetable';
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

        let routeLine = attributes.LineName || '?';
        let routeId = attributes.RouteID || ''; 
        let route = routeId ? `${routeLine}/${routeId}` : routeLine;

        let destination = attributes.FinalStopName || '?';
        let stop = attributes.LastStopName || (attributes.LastStopID ? `Zastávka ID: ${attributes.LastStopID}` : 'Na trase...');

        let delayNum = attributes.Delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        
        let isWaiting = attributes.IsInactive === true;
        if (isWaiting) {
            delay = '0 min'; 
            if (attributes.LastStopName) stop = `Výchozí zastávka: ${attributes.LastStopName}`;
            else stop = 'Čeká na výchozí zastávce';
        }

        return { route, destination, stop, delay, carrier: 'IDS JMK', isNAD: false };
    }

    async getRouteInfo(globalId, attributes) {
        if (!attributes || attributes.ServiceId === undefined || attributes.LineID === undefined || attributes.RouteID === undefined) return null;
        
        const url = `${this.routeUrl}?serviceid=${attributes.ServiceId}&lineid=${attributes.LineID}&routeid=${attributes.RouteID}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (!data || !data.Stops) return null;
            
            const coords = [];
            data.Stops.forEach(stop => {
                if (stop.Path) {
                    stop.Path.forEach(pt => {
                        // API vrací [lat, lon], MapLibre vyžaduje [lon, lat] - musíme to otočit
                        coords.push([pt[1], pt[0]]);
                    });
                }
            });
            return coords;
        } catch(e) { return null; }
    }

    async getTimetable(globalId, attributes) {
        if (!attributes || attributes.ServiceId === undefined || attributes.LineID === undefined || attributes.RouteID === undefined) return null;
        
        const url = `${this.timetableUrl}?serviceid=${attributes.ServiceId}&lineid=${attributes.LineID}&routeid=${attributes.RouteID}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (!data || !data.Routes || data.Routes.length === 0) return null;
            
            const stops = [];
            const delayMins = attributes.Delay || 0;
            
            // Barvy naprosto přesně jako v PID
            let color = '#58d68d';
            if (delayMins > 15) color = '#e74c3c';
            else if (delayMins > 5) color = '#f39c12';
            else if (delayMins < 0) color = '#bada55';

            // Převodník minut od půlnoci na krásný čas HH:MM
            const formatTime = (mins) => {
                if (mins === null || mins === undefined) return null;
                let h = Math.floor(mins / 60) % 24;
                let m = mins % 60;
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };

            const rawStops = data.Routes[0].Stops;
            
            rawStops.forEach((stop, index) => {
                const pArr = formatTime(stop.ArrivalTime);
                const pDep = formatTime(stop.Time);
                const aArr = formatTime(stop.ArrivalTime + delayMins);
                const aDep = formatTime(stop.Time + delayMins);

                let arrival = null;
                let departure = null;

                const arrBlock = { planned: pArr, actual: aArr, color: color };
                const depBlock = { planned: pDep, actual: aDep, color: color };

                if (index === 0) {
                    departure = depBlock;
                } else if (index === rawStops.length - 1) {
                    arrival = arrBlock;
                } else {
                    arrival = arrBlock;
                    departure = depBlock;
                }

                stops.push({
                    station: stop.StopName,
                    isNAD: false,
                    isPassing: false,
                    arr: arrival,
                    dep: departure
                });
            });

            return stops;
        } catch(e) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.Vehicles || !Array.isArray(rawData.Vehicles)) return [];
        const vehicles = [];
        
        for (const trip of rawData.Vehicles) {
            if (trip.VType === 5) continue; 

            let heading = (trip.Bearing !== undefined && trip.Bearing !== null) ? trip.Bearing : null;
            if (trip.IsInactive === true) heading = null; 

            vehicles.push({
                id: `idsjmk_${trip.ID}`,
                provider: this.providerName,
                lat: trip.Lat,
                lon: trip.Lng,
                heading: heading,
                route: trip.LineName || '?',
                headsign: trip.FinalStopName || 'Neznámý cíl',
                globalMatchId: `idsjmk_${trip.LineName}_${trip.RouteID}`, 
                delay: trip.Delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
