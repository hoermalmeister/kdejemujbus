import BaseProvider from './BaseProvider.js';

export default class IdsokProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IDSOK';
        // apiUrl a routeUrl už nepotřebujeme, všechno řešíme napřímo!
    }

    // --- 1. STAHOVÁNÍ POZIC VOZIDEL (Přímý přístup) ---
    async fetchData() {
        try {
            const response = await fetch('https://cestujok.cz/idspublicservices/api/service/position', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`Přímý IDSOK selhal: ${response.status}`);
            
            const rawData = await response.json();
            const dataArray = Array.isArray(rawData) ? rawData : (rawData.data || rawData.points || []);
            return this.normalize(dataArray);

        } catch (error) {
            console.error("Chyba při přímém stahování IDSOK:", error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            if (trip.vehicleType === "V") continue; // Ignorujeme vlaky

            const cisjrLine = trip.lineNumber || "";
            const cisjrRun = trip.serviceNumber || "";

            if (!cisjrLine) continue;

            const shortLineStr = String(cisjrLine).slice(-3);
            const displayRoute = parseInt(shortLineStr, 10).toString();

            let delay = trip.delay;
            if (delay === undefined || delay === null) {
                delay = 'Neznámé';
            }

            vehicles.push({
                id: trip.id, 
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon, 
                heading: trip.angle,
                route: displayRoute,
                headsign: trip.dest || 'Neznámý cíl',
                globalMatchId: `${cisjrLine}_${cisjrRun}`, 
                delay: delay,
                attributes: {
                    ...trip,
                    cisjrLine: cisjrLine,
                    cisjrRun: cisjrRun,
                    shortRoute: displayRoute
                }
            });
        }
        return vehicles;
    }

    // --- 2. STAHOVÁNÍ DETAILU A TVARU LINKY (Přímý přístup) ---
    async fetchFullDetails(id) {
        try {
            // Žádný Render! Ptáme se přímo CestujOK
            const targetUrl = `https://cestujok.cz/idspublicservices/api/servicedetail?id=${id}`;
            
            const response = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error("Chyba při přímém stahování detailu IDSOK:", error.message);
            return null;
        }
    }

    // --- 3. ZPRACOVÁNÍ DETAILŮ PRO PANEL VOZIDLA ---
    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        // Stažení čerstvých dat (zastávky a trasa)
        const fullData = await this.fetchFullDetails(attributes.id);

        let delayVal = attributes.delay;
        let delayText = '0 min';
        
        if (delayVal === 'Neznámé') {
            delayText = 'Neznámé';
        } else if (delayVal !== 0) {
            delayText = `${parseInt(delayVal) || 0} min`;
        }

        let currentStop = 'Na trase...';
        if (fullData && fullData.stations && fullData.stations.length > 0) {
            const passedStops = fullData.stations.filter(s => s.passed === true);
            if (passedStops.length > 0) {
                currentStop = passedStops[passedStops.length - 1].name;
            } else {
                currentStop = fullData.stations[0].name;
            }
        }
        
        return {
            route: `${attributes.shortRoute}/${attributes.cisjrRun}`, 
            timetableRoute: `${attributes.cisjrLine}/${attributes.cisjrRun}`,
            destination: attributes.dest || 'Neznámý cíl',
            stop: currentStop,
            delay: delayText,
            carrier: attributes.operator || 'Neznámý dopravce',
            isNAD: false, 
            isOdklon: attributes.isDetour === true, // Převezmeme info o odklonu
            _cachedFullData: fullData // Uložíme do cache pro mapu a jízdní řád!
        };
    }

// --- 4. ZPRACOVÁNÍ TVARU LINKY (WKT) ---
    parseWKT(wktString) {
        if (!wktString || typeof wktString !== 'string') return [];
        
        try {
            // Očistíme string od názvů a vnějších závorek (MULTILINESTRING i LINESTRING)
            let cleanString = wktString.replace(/MULTILINESTRING|LINESTRING/g, '')
                                       .replace(/\(/g, '')
                                       .replace(/\)/g, '')
                                       .trim();

            if (!cleanString) return [];

            const coordinates = [];
            const points = cleanString.split(',');
            
            for (const point of points) {
                const coords = point.trim().split(/\s+/);
                
                if (coords.length >= 2) {
                    const lon = parseFloat(coords[0]);
                    const lat = parseFloat(coords[1]);
                    
                    if (!isNaN(lon) && !isNaN(lat)) {
                        // WEBGL ZMĚNA: Mapbox/MapLibre/Deck.gl očekávají [longitude, latitude]!
                        // Proto posíláme první X (lon) a pak Y (lat). Už to neotáčíme.
                        coordinates.push([lon, lat]); 
                    }
                }
            }
            
            return coordinates;
        } catch (e) {
            console.error("Chyba při parsování WKT z IDSOK:", e);
            return [];
        }
    }

    async getRouteInfo(id, attributes, details) {
        if (!details || !details._cachedFullData) return null;
        
        // Z API nám chodí položka 'geometry' jako dlouhý WKT string (MULTILINESTRING)
        const geometryStr = details._cachedFullData.geometry;
        const coords = this.parseWKT(geometryStr);
        
        if (coords.length > 0) return coords;
        return null;
    }

    // --- 5. ZPRACOVÁNÍ JÍZDNÍHO ŘÁDU (STATIONS) ---
    async getTimetable(id, attributes, details) {
        let fullData = details ? details._cachedFullData : null;
        if (!fullData) {
            fullData = await this.fetchFullDetails(attributes ? attributes.id : id);
        }

        if (!fullData || !fullData.stations || fullData.stations.length === 0) {
            return [];
        }

        const stops = [];
        let isUnknown = (attributes.delay === 'Neznámé');
        let delayMins = isUnknown ? 0 : (parseInt(attributes.delay) || 0);

        let color = '#58d68d';
        if (isUnknown) color = '#7f8c8d'; 
        else if (delayMins > 15) color = '#e74c3c';
        else if (delayMins > 5) color = '#f39c12';
        else if (delayMins < 0) color = '#bada55';

        const parseTimeStr = (tStr) => {
            if (!tStr) return null;
            const pts = tStr.split(':');
            return pts[0] + ":" + pts[1]; 
        };

        const addDelay = (timeStr, delayMin) => {
            if (!timeStr) return null;
            let [h, m] = timeStr.split(':').map(Number);
            m += delayMin;
            if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
            else if (m < 0) { h -= Math.ceil(Math.abs(m) / 60); m = 60 - (Math.abs(m) % 60); }
            if (h >= 24) h %= 24;
            if (h < 0) h = (h % 24) + 24;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        for (const station of fullData.stations) {
            let plannedArr = parseTimeStr(station.arrivalTime);
            let plannedDep = parseTimeStr(station.departureTime);
            
            if (!plannedArr && plannedDep) plannedArr = plannedDep;
            if (!plannedDep && plannedArr) plannedDep = plannedArr;

            let isPast = station.passed === true;

            let actualArr = isPast ? plannedArr : addDelay(plannedArr, delayMins);
            let actualDep = isPast ? plannedDep : addDelay(plannedDep, delayMins);

            stops.push({
                station: station.name,
                arr: {
                    planned: plannedArr,
                    actual: actualArr,
                    color: isPast ? '#58d68d' : color 
                },
                dep: {
                    planned: plannedDep,
                    actual: actualDep,
                    color: isPast ? '#58d68d' : color
                },
                isPassing: false,
                isNAD: false 
            });
        }

        return stops;
    }
}
