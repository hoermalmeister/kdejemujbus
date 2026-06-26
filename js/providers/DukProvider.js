import BaseProvider from './BaseProvider.js';

export default class DukProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'DÚK';
        this.apiUrl = 'https://grapp-bridge.onrender.com/duk'; 
        this.detailUrl = 'https://grapp-bridge.onrender.com/duk/detail'; 
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
                id: `duk_${trip.ID}`, // Ponecháme si čisté ID pro stahování detailu
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
                    cisjrLine: lineText,
                    cisjrRun: routeId
                }
            });
        }
        return vehicles;
    }

    // --- STAŽENÍ A PARSOVÁNÍ HTML DETAILU ---
    async fetchFullDetails(id) {
        try {
            // ZMĚNA: Používáme čistý GET, id předáváme do URL
            const response = await fetch(`${this.detailUrl}?id=${id}`);
            
            if (!response.ok) return null;
            
            const htmlString = await response.text();
            if (!htmlString) return null;

            // Převedeme HTML string na skutečný DOM dokument pro snadné hledání
            const parser = new DOMParser();
            return parser.parseFromString(htmlString, 'text/html');
        } catch (error) {
            console.error("Chyba při stahování DÚK detailu:", error.message);
            return null;
        }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        const doc = await this.fetchFullDetails(attributes.ID);
        if (!doc) {
            // Nouzový fallback, pokud selže API
            return {
                route: `${attributes.cisjrLine}/${attributes.cisjrRun}`, 
                timetableRoute: `${attributes.cisjrLine}/${attributes.cisjrRun}`,
                destination: 'Neznámý cíl', 
                stop: 'Na trase...',
                delay: 'Neznámé', 
                carrier: 'DÚK', 
                isNAD: false, 
                isOdklon: false,
                _cachedDoc: null
            };
        }

        // 1. Zda vozidlo komunikuje
        const isOffline = doc.body.textContent.includes("Spoj nedodává data online");

        // 2. Extraktivní hledání podle nadpisů (itemDetailsHeadLineKey)
        let linkoSpoj = `${attributes.cisjrLine}/${attributes.cisjrRun}`;
        let destination = "Neznámý cíl";
        
        const headKeys = doc.querySelectorAll('.itemDetailsHeadLineKey');
        headKeys.forEach(el => {
            const keyText = el.textContent.trim();
            const valEl = el.nextElementSibling;
            if (keyText === "LinkoSpoj:" && valEl) linkoSpoj = valEl.textContent.trim();
            if (keyText === "Cíl:" && valEl) destination = valEl.textContent.trim();
        });

        // 3. Extraktivní hledání v minor detailech
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
                // Ošetříme text "+2", "-1", atd.
                if (odchylka !== "není k dispozici" && odchylka !== "") {
                    // Odřízneme plusko, abychom z toho dostali čisté číslo pro aplikaci
                    delayText = `${parseInt(odchylka.replace('+', ''), 10)} min`;
                }
            }
        });

        // Aktualizujeme si hlavičkovou destinaci i ve vozidle (aby se mohla případně objevit i na mapě)
        attributes.headsign = destination;

        return {
            route: linkoSpoj, 
            timetableRoute: linkoSpoj,
            destination: destination, 
            stop: currentStop,
            delay: delayText, 
            carrier: carrier, 
            isNAD: false, 
            isOdklon: false,
            _cachedDoc: doc // Předáme si rozparsované HTML do další funkce
        };
    }

    async getTimetable(id, attributes, details) {
        const doc = details ? details._cachedDoc : null;
        if (!doc) return [];

        const isOffline = doc.body.textContent.includes("Spoj nedodává data online");
        
        // Zpoždění pro celý jízdní řád
        let delayMins = 0;
        let isUnknown = isOffline;

        if (!isUnknown && details.delay && details.delay !== 'Neznámé') {
            delayMins = parseInt(details.delay) || 0;
        }

        let color = '#58d68d'; // Zelená (na čas)
        if (isUnknown) color = '#7f8c8d'; // Šedá (offline)
        else if (delayMins > 15) color = '#e74c3c';
        else if (delayMins > 5) color = '#f39c12';
        else if (delayMins < 0) color = '#bada55';

        const stops = [];
        
        // Hledání všech řádků v jízdním řádu (mají společnou třídu itemDetailsVehicleTOStopDepartureTime)
        // DÚK generuje řádky uvnitř <div class="itemDetailsVehicleTOStop"> -> <div class="d-flex flex-row">
        const stopRows = doc.querySelectorAll('.itemDetailsVehicleTOStop .d-flex.flex-row');

        stopRows.forEach(row => {
            const timeDivs = row.querySelectorAll('.itemDetailsVehicleTOStopDepartureTime');
            // Poslední flex-fill div je jméno stanice
            const nameDiv = row.querySelector('.flex-fill'); 

            if (timeDivs.length >= 2 && nameDiv) {
                // DÚK odděluje příjezd a odjezd. Někde je prázdno nebo znak "|".
                let arrTime = timeDivs[0].textContent.trim();
                let depTime = timeDivs[1].textContent.trim();
                
                if (arrTime === '|' || !arrTime) arrTime = depTime;
                if (depTime === '|' || !depTime) depTime = arrTime;
                
                // Pokud nemáme ani jeden čas, přeskočíme to
                if (!arrTime && !depTime) return;

                // Určení, zda už stanice byla (světle modré pozadí značí, že je to aktuální, co je nad tím, už bylo)
                // U DÚKu si s tím poradíme tak, že pokud má řádek transparentní pozadí a nemá font-weight-bold
                // (a ještě nebyla modrá stanice nalezená), považujeme ji za minulou. 
                // Nicméně mnohem spolehlivější je opětovné porovnání "color".
                
                // Zda je zastávka už projeta (Zelená = prošlo, aktuální podle zpoždění = budoucí)
                // U DÚK svítí modré pozadí aktuální / budoucí zastávky. Všechny již projeté jsou transparentní s klasickým textem.
                // Pro zjednodušení si označíme "isPast" podle toho, zda je to první stanice, aktuální apod. (uděláme odhad)
                
                // Očistíme název zastávky od zóny, např "Most,nádraží (2)" -> "Most,nádraží"
                let stopName = nameDiv.textContent.trim().replace(/\s*\(\d+\)$/, '');

                // Pomocná metoda pro výpočet času se zpožděním
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

                stops.push({
                    station: stopName,
                    arr: {
                        planned: arrTime,
                        actual: addDelay(arrTime, delayMins),
                        // Protože DÚK jednoznačně neurčuje past stanice, nastavíme barvu podle aktuálního stavu zpoždění
                        color: color 
                    },
                    dep: {
                        planned: depTime,
                        actual: addDelay(depTime, delayMins),
                        color: color
                    },
                    isPassing: false,
                    isNAD: false 
                });
            }
        });

        // Vyladění barev projetých stanic: Projdeme JŘ od začátku a vše až k "aktuální zastávce" obarvíme zeleně
        if (details.stop && details.stop !== 'Na trase...') {
            let foundCurrent = false;
            for (let s of stops) {
                // Normalizujeme jména pro snazší porovnání
                const sName = s.station.replace(/\s/g, '').toLowerCase();
                const curName = details.stop.replace(/\s/g, '').replace(/\s*\(\d+\)$/, '').toLowerCase();
                
                if (sName.includes(curName) || curName.includes(sName)) {
                    foundCurrent = true;
                    // Aktuální zastávka svítí stále aktuálním zpožděním (oranžová/červená)
                }
                
                if (!foundCurrent) {
                    s.arr.color = '#58d68d'; // Zelená - už projel
                    s.dep.color = '#58d68d';
                    // Reálný čas u projetých necháme stejný jako plánovaný, protože DÚK nevrací historická data
                    s.arr.actual = s.arr.planned; 
                    s.dep.actual = s.dep.planned;
                }
            }
        }

        return stops;
    }

    async getRouteInfo() {
        return null; // DÚK API křivku trasy nevrací
    }
}
