import BaseProvider from './BaseProvider.js';

export default class IredoProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IREDO';
        // URL pro seznam všech spojů v regionu (přes Můstek kvůli CORS)
        this.apiUrl = 'https://grapp-bridge.onrender.com/iredo'; 
        // Základní URL pro detail spoje (CORS tu už nevadí, použijeme proxy ze spojenky nebo můstku)
        // POZOR: I tento endpoint musí běžet přes Můstek, pokud iredo.online hází CORS
        this.detailUrl = 'https://grapp-bridge.onrender.com/iredo/detail?id=';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`IREDO API chyba: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data.connections || []);
        } catch (error) {
            console.error("Chyba IREDO:", error.message);
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            if (trip.vehicleType === "V") continue;

            const nameParts = (trip.name || "").split(' ');
            const cisjrLine = nameParts[0] || "";
            const cisjrRun = nameParts[1] || "";

            if (!cisjrLine) continue;

            let displayRoute = trip.extLineName;
            if (!displayRoute) {
                displayRoute = cisjrLine.slice(-3);
            }

            let delay = trip.delay;
            if (delay === undefined || delay === null) {
                delay = 'Neznámé';
            }

            vehicles.push({
                // Původní ID od IREDA (např. "S-662311-23"), které se hodí do detail endpointu
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
                    cisjrRun: cisjrRun
                }
            });
        }
        return vehicles;
    }

    // --- PARSOVÁNÍ WKT GEOMETRIE (Z formátu MULTILINESTRING) ---
    parseWKT(wktString) {
        if (!wktString || typeof wktString !== 'string') return [];
        try {
            // Čekáme "MULTILINESTRING((lon lat, lon lat...))" nebo "LINESTRING(lon lat...)"
            const matches = wktString.match(/\(([^()]+)\)/g);
            if (!matches) return [];
            
            const coordinates = [];
            for (const match of matches) {
                // Odstraníme závorky
                const cleanMatch = match.replace(/[()]/g, '');
                const points = cleanMatch.split(',');
                
                for (const point of points) {
                    const coords = point.trim().split(' ');
                    if (coords.length === 2) {
                        coordinates.push([parseFloat(coords[0]), parseFloat(coords[1])]);
                    }
                }
            }
            return coordinates;
        } catch (e) {
            console.error("Nepodařilo se rozparsovat WKT geometrii IREDO:", e);
            return [];
        }
    }

    // --- STAŽENÍ KOMPLETNÍCH DAT O SPOJI Z NOVÉHO ENDPOINTU ---
    async fetchFullDetails(id) {
        try {
            // PŮVODNÍ CÍL BYL: https://iredo.online/oredo/detail/${id}?geom=true
            // Pokud bude CORS problém, odkážeme to přes Můstek (stejně jako jsi udělal v VDV endpointu).
            // Příklad pro Můstek:
            const response = await fetch(`https://grapp-bridge.onrender.com/iredo/detail?id=${id}`);
            
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error("Chyba při stahování detailu IREDO:", error.message);
            return null;
        }
    }

    // --- DETAILNÍ INFORMACE PRO PANEL ---
    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        // Okamžitě stáhneme vše, protože budeme tyhle data sdílet s mapou a JŘ
        const fullData = await this.fetchFullDetails(attributes.id);

        let delayVal = attributes.delay;
        let delayText = '0 min';
        let delayNum = 0;
        
        if (delayVal === 'Neznámé') {
            delayText = 'Neznámé';
            delayNum = 'Neznámé';
        } else if (delayVal !== 0) {
            delayNum = parseInt(delayVal) || 0;
            delayText = `${delayNum} min`;
        }

        // Zjištění aktuální zastávky (poslední, co má passed: true)
        let currentStop = 'Na trase...';
        if (fullData && fullData.stations && fullData.stations.length > 0) {
            const passedStops = fullData.stations.filter(s => s.passed === true);
            if (passedStops.length > 0) {
                currentStop = `Odjel z: ${passedStops[passedStops.length - 1].name}`;
            } else {
                currentStop = `Výchozí: ${fullData.stations[0].name}`;
            }
        }

        return {
            route: `${attributes.cisjrLine}/${attributes.cisjrRun}`, // Tvůj čistý požadavek na titulku
            timetableRoute: `${attributes.cisjrLine}/${attributes.cisjrRun}`,
            destination: attributes.dest || 'Neznámý cíl',
            stop: currentStop,
            delay: delayText,
            carrier: attributes.operator || 'Neznámý dopravce',
            isNAD: false, // Tvůj požadavek (ignorujeme výluky)
            isOdklon: false,
            // Uložíme si kompletní stažená data, ať se nemusíme ptát znovu při kreslení křivky a JŘ
            _cachedFullData: fullData 
        };
    }

    // --- KŘIVKA TRASY ---
    async getRouteInfo(id, attributes, details) {
        if (!details || !details._cachedFullData) return null;
        
        // Získáme ten masivní textový řetězec geometrie
        const geometryStr = details._cachedFullData.geometry;
        
        // Rozparsujeme to do [lon, lat] pole pro MapLibre
        const coords = this.parseWKT(geometryStr);
        if (coords.length > 0) return coords;
        return null;
    }

    // --- JÍZDNÍ ŘÁD ---
    async getTimetable(id, attributes, details) {
        // Pokud z nějakého důvodu data nemáme, zkusíme je stáhnout znovu
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

        // Dispečerská paleta barev
        let color = '#58d68d';
        if (isUnknown) color = '#7f8c8d'; 
        else if (delayMins > 15) color = '#e74c3c';
        else if (delayMins > 5) color = '#f39c12';
        else if (delayMins < 0) color = '#bada55';

        const parseTimeStr = (tStr) => {
            if (!tStr) return null;
            const pts = tStr.split(':');
            return pts[0] + ":" + pts[1]; // Smaže sekundy, např "13:30:00" -> "13:30"
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
            
            // Doplnění časů, pokud v datech chybí jeden z nich
            if (!plannedArr && plannedDep) plannedArr = plannedDep;
            if (!plannedDep && plannedArr) plannedDep = plannedArr;

            // Zjištění stavu stanice
            let isPast = station.passed === true;

            // Výpočet reálného času s případným zpožděním (pouze pro budoucí zastávky)
            let actualArr = isPast ? plannedArr : addDelay(plannedArr, delayMins);
            let actualDep = isPast ? plannedDep : addDelay(plannedDep, delayMins);

            stops.push({
                station: station.name,
                arr: {
                    planned: plannedArr,
                    actual: actualArr,
                    color: isPast ? '#58d68d' : color // Zelené = už odjelo
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
