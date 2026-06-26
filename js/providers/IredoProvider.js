import BaseProvider from './BaseProvider.js';

export default class IredoProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'IREDO';
        this.apiUrl = 'https://iredo.online/map/mapData';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'pragma': 'no-cache',
                },
                // Zvětšený Bounding Box, aby pokryl celý východ ČR
                body: JSON.stringify({
                    "w": 14.0,
                    "s": 49.0,
                    "e": 17.0,
                    "n": 51.5,
                    "zoom": 10
                })
            });

            if (!response.ok) throw new Error(`IREDO API chyba: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data.connections || []);
        } catch (error) {
            console.error("Chyba IREDO:", error.message);
            // Poznámka: Pokud by prohlížeč blokoval CORS, bude nutné tento endpoint 
            // přesunout do tvého grapp-bridge na backendu.
            return [];
        }
    }

    normalize(rawData) {
        const vehicles = [];
        
        for (const trip of rawData) {
            // 1. Ignorujeme vlaky (zastupuje je GRAPP)
            if (trip.vehicleType === "V") continue;

            // 2. Extrakce CISJR linky a spoje z atributu "name"
            const nameParts = (trip.name || "").split(' ');
            const cisjrLine = nameParts[0] || "";
            const cisjrRun = nameParts[1] || "";

            // Pokud nemáme platnou linku, přeskočíme
            if (!cisjrLine) continue;

            // 3. Určení nápisu na šipku (extLineName nebo 3 poslední číslice)
            let displayRoute = trip.extLineName;
            if (!displayRoute) {
                displayRoute = cisjrLine.slice(-3);
            }

            // 4. Zpoždění (pokud chybí, nastavíme jako Neznámé)
            let delay = trip.delay;
            if (delay === undefined || delay === null) {
                delay = 'Neznámé';
            }

            vehicles.push({
                id: `iredo_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon, // IREDO používá 'lon', ne 'lng'
                heading: trip.angle,
                route: displayRoute,
                headsign: trip.dest || 'Neznámý cíl',
                // Tímto klíčem se spojí s PIDem (např. "642305_19")
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

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

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

        return {
            route: `Linka ${attributes.extLineName || attributes.cisjrLine.slice(-3)} (IREDO)`,
            timetableRoute: `${attributes.cisjrLine}/${attributes.cisjrRun}`,
            destination: attributes.dest || 'Neznámý cíl',
            stop: attributes.dep ? `Z výchozí: ${attributes.dep}` : 'Na trase...',
            delay: delayText,
            carrier: attributes.operator || 'Neznámý dopravce',
            isNAD: attributes.isDetour === true,
            isOdklon: false
        };
    }

    // IREDO v tomto endpointu neposkytuje JŘ, takže vrátíme null
    async getTimetable(id, attributes) {
        return null; 
    }
}
