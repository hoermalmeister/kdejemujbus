import BaseProvider from './BaseProvider.js';

export default class DukProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DÚK';
        this.apiUrl = 'https://grapp-bridge-production.up.railway.app/duk'; 
        this.detailUrl = 'https://grapp-bridge-production.up.railway.app/duk/detail';

        // KOMPLETNĚ ODSTRANĚNA CACHE NA TVARY LINEK.
        // Už nemusíme čekat na loadShapes() !
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
        
        // Seznam linek, které chceme na mapě úplně ignorovat (pro jistotu malými písmeny)
        const ignoredLines = ['400', '369', 's560'];
        
        for (const trip of rawData) {
            // Ignorujeme vlaky a chybnou lokaci
            if (trip.Traction === 5) continue;
            if (trip.Lat === 0 && trip.Lng === 0) continue;

            const lineText = trip.LineText ? trip.LineText.toString().trim() : "";
            const routeId = trip.RouteID || ""; 

            if (!lineText) continue;

            // Převedeme na malá písmena, aby to spolehlivě zachytilo "S560" i "s560"
            if (ignoredLines.includes(lineText.toLowerCase())) {
                continue; // Spoj se úplně přeskočí a do mapy vůbec nedoputuje
            }

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
                    ID: trip.ID, 
                    cisjrLine: lineText,
                    cisjrRun: routeId
                }
            });
        }
        return vehicles;
    }

    async fetchFullDetailsHTML(id) {
        try {
            const response = await fetch(`${this.detailUrl}?id=${id}`);
            if (!response.ok) return null;
            return await response.text();
        } catch (error) {
            console.error("Chyba při stahování DÚK detailu:", error.message);
            return null;
        }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        const htmlString = await this.fetchFullDetailsHTML(attributes.ID);
        
        // SPRÁVNÉ NASTAVENÍ NÁZVU (Hlavička 3místná, Timetable 6místná)
        let headerRoute = `${attributes.cisjrLine}/${attributes.cisjrRun}`;
        let timetableRoute = attributes.cisjrFullLine ? `${attributes.cisjrFullLine}/${attributes.cisjrRun}` : headerRoute;

        if (!htmlString) {
            return {
                route: headerRoute, 
                timetableRoute: timetableRoute,
                destination: 'Neznámý cíl', 
                stop: 'Na trase...',
                delay: 'Neznámé', 
                carrier: 'DÚK', 
                isNAD: false, 
                isOdklon: false,
                _cachedHtml: null
            };
        }

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

        let currentStop = 'Na trase...';
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

    async getTimetable(id, attributes, details) {
        let htmlString = details ? details._cachedHtml : null;
        
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
                
                if (arrTime === '|' || !arrTime) arrTime = depTime;
                if (depTime === '|' || !depTime) depTime = arrTime;
                if (!arrTime && !depTime) return;

                let stopName = nameDiv.textContent.trim().replace(/\s*\(\d+\)$/, '');
                const style = row.getAttribute('style') || '';
                const isCurrentStop = style.toUpperCase().includes('#ADD8E6');
                
                if (isCurrentStop) {
                    pastCurrentStop = true; 
                }

                let rowColor = (!pastCurrentStop && !isCurrentStop) ? '#58d68d' : activeColor;

                stops.push({
                    station: stopName,
                    arr: {
                        planned: arrTime,
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

    // --- NOVÁ FUNKCE: Přímé stahování tvaru z Dukfinder.sap1k.cz ---
    async getRouteInfo(globalId, attributes, details) {
        // Potřebujeme buď plné číslo linky ze slovníku (app.js to dodá jako cisjrFullLine),
        // nebo se aspoň pokusíme použít to krátké zobrazené číslo a cisjrRun
        if (!attributes || !attributes.cisjrRun) return null;

        const routeId = attributes.cisjrFullLine || attributes.cisjrLine; 
        const tripId = attributes.cisjrRun;

        if (!routeId || !tripId) return null;

        try {
            const response = await fetch('https://dukfinder.sap1k.cz/api/GetTripGeometry', {
                method: 'POST',
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'origin': 'https://dukfinder.sap1k.cz',
                    'referer': 'https://dukfinder.sap1k.cz/mapa',
                    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                },
                // Tělo přesně podle Dukfinder API požadavků
                body: JSON.stringify({
                    line_displayed: String(routeId),
                    trip: parseInt(tripId, 10)
                })
            });

            if (!response.ok) {
                console.warn(`Nepodařilo se stáhnout trasu DÚK (${routeId}/${tripId}): ${response.status}`);
                return null;
            }

            const rawRoute = await response.json();
            
            if (!Array.isArray(rawRoute) || rawRoute.length === 0) return null;

            // Dukfinder vrací rovnou objekty se správnými jmény: {lat: 50.1, lng: 14.2}
            // Pro MapLibre / WebGL musíme vrátit prosté pole v pořadí [lng, lat]
            const maplibCoordinates = rawRoute.map(point => [point.lng, point.lat]);
            
            return maplibCoordinates;

        } catch (error) {
            console.error("Chyba při stahování trasy z Dukfinderu:", error);
            return null;
        }
    }
}
