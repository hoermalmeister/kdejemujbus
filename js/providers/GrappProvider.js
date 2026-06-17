import BaseProvider from './BaseProvider.js';

export default class GrappProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'GRAPP';
        this.apiUrl = 'https://grapp-bridge.onrender.com/grapp'; 
        this.detailUrl = 'https://grapp-bridge.onrender.com/grapp/detail'; 
        this.timetableUrl = 'https://grapp-bridge.onrender.com/grapp/timetable';
        this.currentToken = ''; 
        this.currentSession = ''; 
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`GRAPP Můstek vrátil chybu: ${response.status}`);
            const responseJson = await response.json();
            if (responseJson.Token) this.currentToken = responseJson.Token;
            if (responseJson.SessionId) this.currentSession = responseJson.SessionId;
            return this.normalize(responseJson.Data);
        } catch (error) { return []; }
    }

    async getDetails(globalId) {
        const trainId = globalId.replace('grapp_', '');
        const url = `${this.detailUrl}?id=${trainId}&token=${this.currentToken}&session=${this.currentSession}`;
        try {
            const response = await fetch(url);
            let html = await response.text();
            if (html.includes("Pokus o neautorizovaný přístup")) return null;

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const findValueByLabel = (labels) => {
                const rows = Array.from(doc.querySelectorAll('.row'));
                for (let row of rows) {
                    const cols = row.querySelectorAll('div[class^="col-"]');
                    if (cols.length >= 2) {
                        const text = cols[0].textContent.toLowerCase();
                        if (labels.some(l => text.includes(l))) return cols[1].textContent.trim();
                    }
                }
                return null;
            };

            const route = doc.querySelector('.fontSizeBig1')?.textContent.trim() || '?';
            const carrier = doc.querySelector('.carrierRestrictionLink')?.textContent.trim() || '?';
            const destination = findValueByLabel(['cílová stanice']) || '?';
            const stop = findValueByLabel(['potvrzená stanice']) || '?';
            const isGlobalNAD = !!doc.querySelector('.standbyTitle');

            // --- SPRÁVNÁ DETEKCE ZPOŽDĚNÍ A NÁSKOKU ---
            let delayStr = '0 min';
            const delayRaw = findValueByLabel(['předpokládané zpoždění']);
            const advanceRaw = findValueByLabel(['náskok']);

            if (delayRaw && delayRaw !== '-') {
                delayStr = delayRaw; 
            } else if (advanceRaw && advanceRaw !== '-') {
                // SŽ vrací '1min', my přidáme minus -> '-1min'
                delayStr = '-' + advanceRaw.replace(/\s+/g, ''); 
            }

            return { route, destination, stop, delay: delayStr, carrier, isNAD: isGlobalNAD };
        } catch (error) { return null; }
    }

    async getRouteInfo(globalId) {
        const trainId = globalId.replace('grapp_', '');
        const url = `https://grapp-bridge.onrender.com/grapp/route?id=${trainId}&token=${this.currentToken}&session=${this.currentSession}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || data.Status !== "OK") return null;
            let allPoints = [];
            if (data.Confirmed1) allPoints = allPoints.concat(data.Confirmed1);
            if (data.InPlan1) allPoints = allPoints.concat(data.InPlan1);
            if (data.Confirmed2) allPoints = allPoints.concat(data.Confirmed2);
            if (data.InPlan2) allPoints = allPoints.concat(data.InPlan2);
            if (allPoints.length === 0) return null;
            return allPoints.map(point => [point[1], point[0]]);
        } catch (error) { return null; }
    }

    async getTimetable(globalId) {
        const trainId = globalId.replace('grapp_', '');
        const url = `${this.timetableUrl}?id=${trainId}&token=${this.currentToken}&session=${this.currentSession}`;
        
        try {
            const response = await fetch(url);
            let html = await response.text();
            
            // OPRAVA CHYBY SŽ: Přepíšeme nevalidní <div /> na validní <div></div>, aby se řádky nevnořovaly do sebe!
            html = html.replace(/<div([^>]*?)\/>/g, '<div$1></div>');
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const stationRows = doc.querySelectorAll('.route .row');
            const stops = [];

            stationRows.forEach((row, index) => {
                const firstCol = row.querySelector('div[class*="col-"]');
                if (!firstCol) return;
                
                let stationName = firstCol.querySelector('a')?.textContent.trim() || firstCol.textContent.replace(/[\n\r]/g, '').replace(/\s+/g, ' ').trim();
                if (!stationName || stationName.toLowerCase().includes('informace o')) return;
                stationName = stationName.replace(/ z$/, '');

                const isLocalNAD = !!row.querySelector('img.ndTransport, img[src*="nd.svg"], img[src*="ND.svg"]');

                // Nyní bude mít každý řádek (díky opravenému HTML) striktně JEN SVÉ mobilní buňky
                const mobileCells = Array.from(row.querySelectorAll('.hidden-lg.text-center'));
                
                const parseCell = (cell) => {
                    if (!cell) return null;
                    const actualNode = cell.querySelector('span[class*="delay"]');
                    const plannedNode = cell.querySelector('.timeTT');
                    
                    let actual = actualNode ? actualNode.textContent.trim() : null;
                    let planned = plannedNode ? plannedNode.textContent.replace(/[()]/g, '').trim() : null;
                    let color = '#58d68d'; 
                    
                    // Vlastní přesná matematika zpoždění (pro barevný náskok u konkrétní stanice)
                    if (actual && planned) {
                        let aMins = parseInt(actual.split(':')[0])*60 + parseInt(actual.split(':')[1]);
                        let pMins = parseInt(planned.split(':')[0])*60 + parseInt(planned.split(':')[1]);
                        let diff = aMins - pMins;
                        
                        if (diff < -12*60) diff += 24*60; 
                        if (diff > 12*60) diff -= 24*60;  
                        
                        if (diff < 0) color = '#bada55'; // Náskok 
                        else if (diff <= 5) color = '#58d68d'; 
                        else if (diff <= 15) color = '#f39c12'; 
                        else color = '#e74c3c'; 
                    }
                    return { actual, planned, color };
                };

                let arrival = null;
                let departure = null;

                // Spolehlivé dělení na Příjezd / Odjezd
                if (mobileCells.length >= 2) {
                    arrival = parseCell(mobileCells[0]);
                    departure = parseCell(mobileCells[1]);
                } else if (mobileCells.length === 1) {
                    if (index === 0) {
                        // PRVNÍ STANICE má jen odjezd, příjezd musí zůstat čistý (null)
                        departure = parseCell(mobileCells[0]);
                    } else if (index === stationRows.length - 1) {
                        // POSLEDNÍ STANICE má jen příjezd
                        arrival = parseCell(mobileCells[0]);
                    } else {
                        arrival = parseCell(mobileCells[0]);
                        departure = parseCell(mobileCells[0]);
                    }
                }

                stops.push({ station: stationName, isNAD: isLocalNAD, arr: arrival, dep: departure });
            });

            return stops;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.Trains) return [];
        return rawData.Trains.map(train => {
            const heading = train.Angle === -32768 ? null : train.Angle;
            const titleParts = train.Title.trim().split(' ');
            let matchId = train.Title.trim(); 
            if (titleParts.length >= 2) matchId = `${titleParts[0]} ${titleParts[1]}`;
            return {
                id: `grapp_${train.Id}`,
                provider: this.providerName,
                lat: train.GPS[0],
                lon: train.GPS[1],
                heading: heading,
                route: titleParts[0] || 'Vlak',
                headsign: train.Title.trim(),
                globalMatchId: matchId,
                delay: 0,
                attributes: { hasETCS: train.ETCS }
            };
        });
    }
}
