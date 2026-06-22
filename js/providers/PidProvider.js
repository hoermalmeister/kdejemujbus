import BaseProvider from './BaseProvider.js';

export default class PidProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'PID';
        // Voláme rovnou napřímo, bez proxy/bridge
        this.apiUrl = 'https://mapa.pid.cz/getData.php';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`PID API vrátil chybu: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data);
        } catch (error) {
            console.error(`Chyba ve zdroji PID:`, error);
            return [];
        }
    }

    // Detaily vozidla a jízdní řády vyřešíme v další fázi
    async getDetails(globalId) { return null; }
    async getRouteInfo(globalId) { return null; }
    async getTimetable(globalId) { return null; }

    normalize(rawData) {
        // Kontrola, že máme data a že trips je pole
        if (!rawData || !rawData.trips || !Array.isArray(rawData.trips)) return [];
        
        const vehicles = [];
        
        for (const trip of rawData.trips) {
            // 1. Zahození vlaků (routeType 2)
            if (trip.routeType === 2) continue;

            // 2. Ošetření směru jízdy (bearing) - null znamená kroužek, číslo znamená úhel natočení šipky
            const heading = (trip.bearing !== undefined && trip.bearing !== null) ? trip.bearing : null;

            // 3. Ošetření headsign (cílové stanice). Pokud ji API zrovna nepošle, dáme otazník
            const headsign = trip.headsign || 'Neznámý cíl';

            vehicles.push({
                id: `pid_${trip.tripId}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon,
                heading: heading,
                route: trip.route || '?',
                headsign: headsign,
                globalMatchId: `pid_${trip.route}_${trip.tripId}`, // Unikátní identifikátor pro Deduplikátor
                delay: trip.delay || 0,
                attributes: { ...trip } // Do attributes si pro jistotu uložíme vše (vozíčkář, klima atd.)
            });
        }
        
        return vehicles;
    }
}
