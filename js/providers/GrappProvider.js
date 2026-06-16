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
        } catch (error) {
            console.error(`Chyba ve zdroji GRAPP:`, error);
            return []; 
        }
    }

    async getDetails(globalId) {
        const trainId = globalId.replace('grapp_', '');
        const url = `${this.detailUrl}?id=${trainId}&token=${this.currentToken}&session=${this.currentSession}`;
        try {
            const response = await fetch(url);
            const html = await response.text();
            if (html.includes("Pokus o neautorizovaný přístup")) return null;

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const findValueByLabel = (labelText) => {
                const rows = Array.from(doc.querySelectorAll('.row'));
                for (let row of rows) {
                    const cols = row.querySelectorAll('div[class^="col-"]');
                    if (cols.length >= 2 && cols[0].textContent.toLowerCase().includes(labelText.toLowerCase())) {
                        return cols[1].textContent.trim();
                    }
                }
                return null;
            };

            const route = doc.querySelector('.fontSizeBig1')?.textContent.trim() || '?';
            const carrier = doc.querySelector('.carrierRestrictionLink')?.textContent.trim() || '?';
            const destination = findValueByLabel('cílová stanice') || '?';
            const stop = findValueByLabel('potvrzená stanice') || '?';
            const isNAD = !!doc.querySelector('.standbyTitle');

            let delay = findValueByLabel('předpokládané zpoždění');
            if (!delay || delay === '-') delay = findValueByLabel('náskok') || '0 min';

            return { route, destination, stop, delay, carrier, isNAD };
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
            const html = await response.text();
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const stationRows = doc.querySelectorAll('.route .row');
            const stops = [];

            const getColorClass = (timeNode) => {
                if (!timeNode) return '#7f8c8d'; 
                const className = timeNode.className || '';
                if (className.includes('delayTo5_text')) return '#27ae60'; 
                if (className.includes('delayTo15_text')) return '#f39c12'; 
                if (className.includes('delayOver15_text') || className.includes('delayFuture_text')) return '#e74c3c'; 
                return '#fff'; 
            };

            const extractTimeBlock = (cells, startIndex) => {
                const actCell = cells[startIndex];
                const planCell = cells[startIndex + 1];
                if (!actCell && !planCell) return null;

                const actNode = actCell?.querySelector('span[class*="delay"]');
                const planNode = planCell?.querySelector('.timeTT');
                
                if (!actNode && !planNode) return null;

                return {
                    actual: actNode ? actNode.textContent.trim() : '',
                    planned: planNode ? planNode.textContent.replace(/[()]/g, '').trim() : '',
                    color: getColorClass(actNode)
                };
            };

            stationRows.forEach((row, index) => {
                const firstCol = row.querySelector('div[class*="col-"]');
                if (!firstCol) return;
                
                let stationName = firstCol.querySelector('a')?.textContent.trim();
                if (!stationName) stationName = firstCol.textContent.replace(/[\n\r]/g, '').replace(/\s+/g, ' ').trim();
                
                // ODSTRANĚNÍ BALASTU ("Informace o vlaku" na konci)
                if (!stationName || stationName.toLowerCase().includes('informace o')) return;

                const desktopCells = Array.from(row.querySelectorAll('div[class*="col-lg-1"]')).filter(el => !el.classList.contains('hidden-lg'));
                
                let arrival = null;
                let departure = null;
                
                // SŽ často dává první stanici pouze odjezd do sloupců index 2,3 (místo 0,1)
                // Musíme zjistit, kde ty časy reálně jsou
                let blockA = extractTimeBlock(desktopCells, 0);
                let blockB = extractTimeBlock(desktopCells, 2);

                if (index === 0 && !blockA && blockB) {
                    // První stanice má jen odjezd, příjezd nastavíme stejně, aby nebyla v tabulce díra
                    arrival = blockB;
                    departure = blockB;
                } else if (index === stationRows.length - 1 && blockA && !blockB) {
                    // Poslední stanice má jen příjezd
                    arrival = blockA;
                    departure = blockA;
                } else {
                    arrival = blockA;
                    departure = blockB;
                    // Fallback
                    if (!arrival && departure) arrival = departure;
                    if (!departure && arrival) departure = arrival;
                }

                stops.push({
                    station: stationName.replace(/ z$/, ''), // Odstraní to osamocené " z" (zastávka) na konci názvu, co SŽ někdy vrací
                    arr: arrival,
                    dep: departure
                });
            });

            return stops;
        } catch (error) {
            console.error("Chyba při stahování jízdního řádu:", error);
            return null;
        }
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
            
