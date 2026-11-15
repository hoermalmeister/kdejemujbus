import BaseProvider from './BaseProvider.js';
import { getGtfsRoute } from './gtfsRoutes.js';
import { parsePvvdDetail, parsePvvdTimetable } from './pvvdShared.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
        this.apiUrl = 'https://grapp-bridge-production.up.railway.app/vdv';
        this.detailUrl = 'https://grapp-bridge-production.up.railway.app/vdv/detail?id=';
        this.timetableUrl = 'https://grapp-bridge-production.up.railway.app/vdv/timetable?id=';
        this.finishedVehicles = new Set();
    }

    async fetchData() {
        try {
            const response = await this.fetchWithTimeout(this.apiUrl);
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

        let fullText = attributes.text || '?';
        let shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
        
        let destination = attributes.finalStopName || '?';
        if (destination.includes('N/a')) destination = 'Neznámý cíl';

        let stop = 'Na trase...';
        
        let delayVal = attributes.delay;
        let delayText = '0 min';
        let delayNum = 0;
        
        if (delayVal === 'Neznámé' || delayVal === -2147483648) {
            delayText = 'Neznámé';
            delayNum = 'Neznámé';
        } else if (delayVal !== 0) {
            delayNum = parseInt(delayVal) || 0;
            delayText = `${delayNum} min`;
        }

        let route = shortRoute;
        let timetableRoute = fullText;

        try {
            const res = await fetch(`${this.detailUrl}${attributes.id}`);
            if (res.ok) {
                const html = await res.text();
                // Portál VDV dnes vrací stejné HTML jako IDPK, čteme ho společným kódem
                const parsed = parsePvvdDetail(html);
                if (parsed.line) fullText = parsed.line;
                const exSpoj = parsed.run;
                if (parsed.stop) stop = parsed.stop;
                if (parsed.delay !== null && delayNum !== 'Neznámé') {
                    delayNum = parsed.delay;
                    delayText = `${parsed.delay} min`;
                }

                shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
                if (exSpoj) {
                    route = `${shortRoute}/${exSpoj}`;
                    timetableRoute = `${fullText}/${exSpoj}`;
                }
            }
        } catch (e) {
            console.warn("VDV Detail selhal, použiji základní atributy.");
        }

        // ====================================================================
        // INTELIGENTNÍ LOGIKA ZPOŽDĚNÍ
        // ====================================================================

        // 1. ZÁPORNÉ ZPOŽDĚNÍ NA VÝCHOZÍ STANICI (Automatické načtení JŘ)
        if (typeof delayNum === 'number' && delayNum < 0) {
            const tt = await this.getTimetable(globalId, attributes);
            if (tt && tt.length > 0) {
                const firstStation = tt[0].station;
                if (stop.toLowerCase() === firstStation.toLowerCase()) {
                    delayNum = 0;
                    delayText = '0 min';
                    attributes.delay = 0; // Propíše se nula i do tabulky JŘ
                }
            }
        }

        // 2. JSME V CÍLOVÉ STANICI?
        let isAtDestination = false;
        if (stop !== 'Na trase...' && destination !== 'Neznámý cíl' && stop.toLowerCase() === destination.toLowerCase()) {
            delayText = 'V cíli';
            delayNum = 0;
            isAtDestination = true;
            this.finishedVehicles.add(attributes.id);
        }

        return { 
            route, 
            timetableRoute, 
            destination, 
            stop, 
            delay: delayText, 
            carrier: 'VDV Vysočina', 
            isNAD: false,
            isAtDestination // Předáváme instrukci pro app.js
        };
    }

    async getRouteInfo(id, attributes, details) {
        return getGtfsRoute(details?.timetableRoute);
    }

    async getTimetable(globalId, attributes) {
        if (!attributes || attributes.id === undefined) return null;

        try {
            const response = await fetch(`${this.timetableUrl}${attributes.id}`);
            if (!response.ok) return null;
            
            const html = await response.text();

            let isUnknown = (attributes.delay === 'Neznámé' || attributes.delay === -2147483648);
            let delayMins = isUnknown ? 0 : (parseInt(attributes.delay) || 0);

            let color = '#58d68d';
            if (isUnknown) color = '#7f8c8d'; // Šedá barva pro neznámé
            else if (delayMins > 15) color = '#e74c3c';
            else if (delayMins > 5) color = '#f39c12';
            else if (delayMins < 0) color = '#bada55';

            const stops = parsePvvdTimetable(html, delayMins, color);
            return stops.length ? stops : null;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        const vehicles = [];
        
        for (const trip of rawData) {
            if (trip.traction === "TRAIN") continue;
            if (!trip.text || trip.text.length === 3) continue;

            if (trip.text === '795832' || trip.text === '795815') continue;

            let delay = trip.delay;
            if (delay === -2147483648) delay = 'Neznámé';

            let headsign = trip.finalStopName || 'Neznámý cíl';
            if (headsign.includes('N/a')) headsign = 'Neznámý cíl';
            
            if (trip.text === '841334' && headsign.replace(/\s+/g, '').includes('Tišnov')) {
                continue;
            }
            
            let shortRoute = trip.text.slice(-3);
            let vehicleHeading = (trip.heading !== undefined && trip.heading !== null) ? Math.round(trip.heading) : null;

            if (this.finishedVehicles.has(trip.id)) {
                vehicleHeading = null;
            }
            
            vehicles.push({
                id: `vdv_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng,
                heading: vehicleHeading, 
                route: shortRoute,
                headsign: headsign,
                globalMatchId: `vdv_${trip.text}_${trip.id}`,
                delay: delay,
                attributes: { ...trip }
            });
        }
        return vehicles;
    }
}
