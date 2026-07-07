import BaseProvider from './BaseProvider.js';

export default class DukProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DÚK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/duk'; 
        this.detailUrl = 'https://grapp-bridge.onrender.com/duk/detail';

        this.tripsCache = null;
        this.segmentsCache = null;
        this.loadShapes();
    }

    async loadShapes() {
        try {
            const [tripsRes, segmentsRes] = await Promise.all([
                fetch('https://raw.githubusercontent.com/hoermalmeister/grapp-bridge/main/data/duk_trips.json'),
                fetch('https://raw.githubusercontent.com/hoermalmeister/grapp-bridge/main/data/duk_segments.json')
            ]);
            this.tripsCache = await tripsRes.json();
            this.segmentsCache = await segmentsRes.json();
            console.log(`DÚK tvary načteny ze statických dat.`);
        } catch (e) {
            console.error('Chyba při načítání DÚK tvarů:', e);
        }
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
            // Ignorujeme vlaky a chybnou lokaci
            if (trip.Traction === 5) continue;
            if (trip.Lat === 0 && trip.Lng === 0) continue;

            const lineText = trip.LineText || "";
            const routeId = trip.RouteID || ""; 

            if (!lineText) continue;

            const heading = trip.IsWaiting ? null : trip.Azimut;
            let delay = trip.DelaySign ? trip.DelaySign : 'Neznámé';

            vehicles.push({
                id: `duk_${trip.ID}`, 
                provider: this.providerName,
                lat: trip.Lat,
                lon: trip.Lng, 
                heading: heading,
                route: lineText,
                headsign: 'Neznámý cíl', 
                globalMatchId: `duk_${lineText}_${routeId}`, 
                delay: delay,
                attributes: {
                    ...trip,
                    ID: trip.ID, // Ponecháme si čisté ID pro detail
                    cisjrLine: lineText,
                    cisjrRun: routeId
                }
            });
        }
        return vehicles;
    }

    // --- STAŽENÍ HTML TEXTU Z ENDPOINTU ---
    async fetchFullDetailsHTML(id) {
        try {
            // Voláme náš GET přes Můstek
            const response = await fetch(`${this.detailUrl}?id=${id}`);
            if (!response.ok) return null;
            return await response.text(); // Vracíme čistý text (HTML), nikoliv JSON
        } catch (error) {
            console.error("Chyba při stahování DÚK detailu:", error.message);
            return null;
        }
    }

    // --- PARSOVÁNÍ DETAILU VOZIDLA ---
    async getDetails(globalId, attributes) {
        if (!attributes) return null;
        let headerRoute = `${attributes.cisjrLine}/${attributes.cisjrRun}`;
        let timetableRoute = attributes.cisjrFullLine ? `${attributes.cisjrFullLine}/${attributes.cisjrRun}` : headerRoute;
        attributes.headsign = destination;
        // Stáhneme HTML strukturu a schováme si ji i pro JŘ
        const htmlString = await this.fetchFullDetailsHTML(attributes.ID);
        
        if (!htmlString) {
            return {
                route: headerRoute,
                timetableRoute: timetableRoute, 
                destination: destination, 
                stop: currentStop,
                delay: delayText, 
                carrier: carrier, 
                isNAD: false, 
                isOdklon: false,
                isOffline: isOffline,
                _cachedHtml: htmlString 
            };
        }

        // Převedeme HTML string na virtuální DOM
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        const isOffline = doc.body.textContent.includes("Spoj nedodává data online");

        let destination = "Neznámý cíl";
        
        const headKeys = doc.querySelectorAll('.itemDetailsHeadLineKey');
        headKeys.forEach(el => {
            const keyText = el.textContent.trim();
            const valEl = el.nextElementSibling;
            if (keyText === "Cíl:" && valEl) destination = valEl.textContent.trim();
        });

        let currentStop = '...';
        let delayText = isOffline ? 'Neznámé' : '0 min';
        let carrier = 'DÚK';

        const minorKeys = doc.querySelectorAll('.itemDetailsMinorLineKey');
        minorKeys.forEach(el => {
            const keyText = el.textContent.trim();
            const valEl = el.nextElementSibling;
            
            if (keyText === "Zastávka:" && valEl) currentStop = valEl.textContent.trim();
            if (keyText === "Dopravce:" && valEl) carrier = valEl.textContent.trim();
            
            if (keyText === "Odchylka:" && valEl && !isOffline) {
                const odchylka = valEl.textContent.trim();
                if (odchylka !== "není k dispozici" && odchylka !== "") {
                    // Očištění textu např. z "+2" na pouhé "2"
                    delayText = `${parseInt(odchylka.replace('+', ''), 10)} min`;
                }
            }
        });

        attributes.headsign = destination;

        return {
            route: headerRoute, 
            timetableRoute: timetableRoute,
            destination: destination, 
            stop: currentStop,
            delay: delayText, 
            carrier: carrier, 
            isNAD: false, 
            isOdklon: false,
            isOffline: isOffline,
            _cachedHtml: htmlString 
        };
    }

    // --- PARSOVÁNÍ JÍZDNÍHO ŘÁDU ---
    async getTimetable(id, attributes, details) {
        let htmlString = details ? details._cachedHtml : null;
        
        // Bezpečnostní pojistka: pokud HTML chybí, stáhneme ho
        if (!htmlString) {
            htmlString = await this.fetchFullDetailsHTML(attributes.ID);
        }
        if (!htmlString) return [];

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        const isOffline = doc.body.textContent.includes("Spoj nedodává data online");
        
        let delayMins = 0;
        let isUnknown = isOffline;

        if (!isUnknown && details && details.delay && details.delay !== 'Neznámé') {
            delayMins = parseInt(details.delay) || 0;
        }

        // Paleta barev pro zpoždění
        let activeColor = '#58d68d'; 
        if (isUnknown) activeColor = '#7f8c8d'; 
        else if (delayMins > 15) activeColor = '#e74c3c';
        else if (delayMins > 5) activeColor = '#f39c12';
        else if (delayMins < 0) activeColor = '#bada55';

        const stops = [];
        const stopRows = doc.querySelectorAll('.itemDetailsVehicleTOStop .d-flex.flex-row');

        let pastCurrentStop = false;

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

        stopRows.forEach(row => {
            const timeDivs = row.querySelectorAll('.itemDetailsVehicleTOStopDepartureTime');
            const nameDiv = row.querySelector('.flex-fill'); 

            if (timeDivs.length >= 2 && nameDiv) {
                let arrTime = timeDivs[0].textContent.trim();
                let depTime = timeDivs[1].textContent.trim();
                
                // DÚK odděluje čas příjezdu a odjezdu svítítkem "|"
                if (arrTime === '|' || !arrTime) arrTime = depTime;
                if (depTime === '|' || !depTime) depTime = arrTime;
                if (!arrTime && !depTime) return;

                // Odříznutí čísla stanoviště, např. "Most,nádraží (2)" -> "Most,nádraží"
                let stopName = nameDiv.textContent.trim().replace(/\s*\(\d+\)$/, '');

                // DETEKCE AKTUÁLNÍ ZASTÁVKY DÍKY SVĚTLE MODRÉMU POZADÍ Z DÚKu (#ADD8E6)
                const style = row.getAttribute('style') || '';
                const isCurrentStop = style.toUpperCase().includes('#ADD8E6');
                
                if (isCurrentStop) {
                    pastCurrentStop = true; // Od této chvíle počítáme časy jako budoucí
                }

                // Pokud je zastávka projeta (není modrá a je před ní), dáme jí tvrdou zelenou
                let rowColor = (!pastCurrentStop && !isCurrentStop) ? '#58d68d' : activeColor;

                stops.push({
                    station: stopName,
                    arr: {
                        planned: arrTime,
                        // Na projeté stanice už zpoždění neaplikujeme (mají skutečný čas příjezdu fixní)
                        actual: (!pastCurrentStop && !isCurrentStop) ? arrTime : addDelay(arrTime, delayMins),
                        color: rowColor 
                    },
                    dep: {
                        planned: depTime,
                        actual: (!pastCurrentStop && !isCurrentStop) ? depTime : addDelay(depTime, delayMins),
                        color: rowColor
                    },
                    isPassing: false,
                    isNAD: false 
                });
            }
        });

        return stops;
    }

    // --- KŘIVKA TRASY ---
    async getRouteInfo(globalId, attributes, details) {
        // Pokud data ještě nejsou stažena nebo vůz nemá potřebné ID
        if (!this.tripsCache || !this.segmentsCache) return null;
        if (!attributes || !attributes.cisjrLine || !attributes.cisjrRun) return null;

        // V tuto chvíli (díky app.js) už je cisjrLine šestimístná a přesně odpovídá klíči!
        const tripKey = `${attributes.cisjrFullLine}_${attributes.cisjrRun}`;
        const segmentList = this.tripsCache[tripKey];

        if (!segmentList) {
            // Pokud spoj ve statických datech není, nevykreslíme nic (příp. můžeš vrátit fallback)
            return null; 
        }

        // Poskládáme trasu přesně ze segmentů, úplně stejně jako VDV
        const coords = [];
        for (const segId of segmentList) {
            const shape = this.segmentsCache[segId];
            if (shape) {
                // Přilepíme body segmentu do hlavní trasy
                coords.push(...shape);
            }
        }

        if (coords.length === 0) return null;
        return coords;
    }
}
