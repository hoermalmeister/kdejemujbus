import BaseProvider from './BaseProvider.js';

export default class IdsJmkProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDS JMK';
        this.apiUrl = 'https://grapp-bridge-production.up.railway.app/idsjmk';
        this.routeUrl = 'https://grapp-bridge-production.up.railway.app/idsjmk-route';
        this.timetableUrl = 'https://grapp-bridge-production.up.railway.app/idsjmk-timetable';
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(this.apiUrl);
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
        
        let lastKnownName = attributes.LastStopName;
        let isFallback = false;

        // Pokud vozidlo projelo technickým waypointem, najdeme v JŘ poslední pojmenovanou zastávku
        if (!lastKnownName && attributes.LastStopID) {
            try {
                const url = `${this.timetableUrl}?serviceid=${attributes.ServiceId}&lineid=${attributes.LineID}&routeid=${attributes.RouteID}`;
                const res = await fetch(url);
                const ttData = await res.json();
                
                if (ttData && ttData.Routes && ttData.Routes.length > 0) {
                    const allStops = ttData.Routes[0].Stops;
                    const currentIndex = allStops.findIndex(s => s.StopId == attributes.LastStopID);
                    
                    if (currentIndex !== -1) {
                        for (let i = currentIndex - 1; i >= 0; i--) {
                            if (allStops[i].HasName) {
                                lastKnownName = allStops[i].StopName;
                                isFallback = true;
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Nepodařilo se načíst JŘ pro zjištění fallback zastávky");
            }
        }

        let stop = 'Na trase...';
        if (lastKnownName) {
            stop = isFallback ? `${lastKnownName}` : lastKnownName;
        } else if (attributes.LastStopID) {
            stop = `${attributes.LastStopID}`; 
        }

        let delayNum = attributes.Delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        
        let isWaiting = attributes.IsInactive === true;
        if (isWaiting) {
            delay = '0 min'; 
            if (lastKnownName) stop = `${lastKnownName}`;
            else stop = 'Čeká na výchozí zastávce';
        }

        // Šestimístnou linku CIS JŘ dohledává můstek (RouteID je číslo spoje)
        const timetableRoute = attributes.FullLine && routeId ? `${attributes.FullLine}/${routeId}` : route;
        return { route, timetableRoute, destination, stop, delay, carrier: 'IDS JMK', isNAD: false };
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
                        // OTOČENÍ SOUŘADNIC: IDS JMK dává [lat, lon], MapLibre žádá [lon, lat]
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
            
            let color = '#58d68d';
            if (delayMins > 15) color = '#e74c3c';
            else if (delayMins > 5) color = '#f39c12';
            else if (delayMins < 0) color = '#bada55';

            const formatTime = (mins) => {
                if (mins === null || mins === undefined) return null;
                let h = Math.floor(mins / 60) % 24;
                let m = mins % 60;
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };

            // Aktuální spoj a za ním navazující spoje téhož vozidla: dokud má předchozí spoj
            // ContinuesWithPassengers, vůz pokračuje s cestujícími dalším spojem z odpovědi
            const routes = data.Routes;
            let startIndex = routes.findIndex(r => r.IsCurrentRoute);
            if (startIndex < 0) startIndex = 0;
            const chain = [routes[startIndex]];
            for (let i = startIndex + 1; i < routes.length && chain[chain.length - 1].ContinuesWithPassengers; i++) {
                chain.push(routes[i]);
            }

            const isLastRoute = (routeIndex) => routeIndex === chain.length - 1;
            chain.forEach((route, routeIndex) => {
                // ODSTRANĚNÍ NEVIDITELNÝCH TECHNICKÝCH BODŮ (Waypointů na dálnici atd.)
                const visibleStops = (route.Stops || []).filter(s => s.IsVisible === true);

                visibleStops.forEach((stop, index) => {
                    const arrBlock = { planned: formatTime(stop.ArrivalTime), actual: formatTime(stop.ArrivalTime + delayMins), color };
                    const depBlock = { planned: formatTime(stop.Time), actual: formatTime(stop.Time + delayMins), color };
                    const isFirst = index === 0;
                    const isLast = index === visibleStops.length - 1;

                    // Přestupní zastávka mezi spoji: jeden řádek s příjezdem z předchozího
                    // a odjezdem z navazujícího spoje
                    // (poslední řádek je oddělovač, zastávka je hned před ním)
                    const previous = stops[stops.length - 2];
                    if (isFirst && routeIndex > 0 && previous && previous.stopId === stop.StopId) {
                        previous.dep = depBlock;
                        return;
                    }
                    const isContinuation = routeIndex > 0;

                    stops.push({
                        station: stop.StopName,
                        stopId: stop.StopId,
                        isContinuation,
                        isNAD: false,
                        isPassing: false,
                        arr: isFirst && routeIndex === 0 ? null : arrBlock,
                        dep: isLast ? null : depBlock
                    });
                });

                // Oddělovač před navazujícím spojem
                if (!isLastRoute(routeIndex)) {
                    const next = chain[routeIndex + 1];
                    const sameLine = next.LineId === attributes.LineID && attributes.LineName;
                    stops.push({
                        station: sameLine ? `↳ pokračuje dalším spojem linky ${attributes.LineName}` : '↳ pokračuje dalším spojem',
                        isSeparator: true,
                        isNAD: false,
                        isPassing: true,
                        arr: null,
                        dep: null
                    });
                }
            });

            return stops;
        } catch(e) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.Vehicles || !Array.isArray(rawData.Vehicles)) return [];
        const vehicles = [];
        
        for (const trip of rawData.Vehicles) {
            // Vlaky zahazujeme (Máme je v GRAPPu)
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
                // Se šestimístnou linkou se spoj spáruje se stejným spojem z jiných zdrojů
                globalMatchId: trip.FullLine ? `${trip.FullLine}_${trip.RouteID}` : `idsjmk_${trip.LineName}_${trip.RouteID}`,
                delay: trip.Delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
