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
            const isGlobalNAD = !!doc.querySelector('.standbyTitle');

            let delay = findValueByLabel('předpokládané zpoždění');
            if (!delay || delay === '-') delay = findValueByLabel('náskok') || '0 min';

            return { route, destination, stop, delay, carrier, isNAD: isGlobalNAD };
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

            // Funkce pro přiřazení barev na základě tříd ze SŽ
            const getColorClass = (timeNode) => {
                if (!timeNode) return '#58d68d'; 
                const className = timeNode.className || '';
                if (className.includes('delayTo5_text')) return '#58d68d'; // do 5 minut zelená
                if (className.includes('delayTo15_text')) return '#f39c12'; // do 15 minut oranžová
                if (className.includes('delayOver15_text')) return '#e74c3c'; // nad 15 minut červená
                if (className.includes('delayFuture_text')) return '#58d68d'; // Budoucí standard
                return '#58d68d'; 
            };

            stationRows.forEach((row, index) => {
                const firstCol = row.querySelector('div[class*="col-"]');
                if (!firstCol) return;
                
                let stationName = firstCol.querySelector('a')?.textContent.trim();
                if (!stationName) stationName = firstCol.textContent.replace(/[\n\r]/g, '').replace(/\s+/g, ' ').trim();
                
                // Zahození patičky "Informace o vlaku"
                if (!stationName || stationName.toLowerCase().includes('informace o')) return;
                stationName = stationName.replace(/ z$/, '');

                // Zjištění lokální Náhradní dopravy pro tuto konkrétní stanici
                const isLocalNAD = !!row.querySelector('img.ndTransport, img[src*="nd.svg"], img[src*="ND.svg"]');

                // Vytáhneme VŠECHNY reálné a plánované časy z desktopových buněk
                const actualSpans = Array.from(row.querySelectorAll('div.text-right.hidden-xs span'));
                const plannedSpans = Array.from(row.querySelectorAll('div.leftBorder.hidden-xs span'));

                let arrActual = null, arrPlanned = null, arrColor = '#58d68d';
                let depActual = null, depPlanned = null, depColor = '#58d68d';

                // Pokud máme 2 časy, je to Příjezd a Odjezd
                if (actualSpans.length >= 2) {
                    arrActual = actualSpans[0].textContent.trim();
                    arrColor = getColorClass(actualSpans[0]);
                    depActual = actualSpans[1].textContent.trim();
                    depColor = getColorClass(actualSpans[1]);
                } else if (actualSpans.length === 1) {
                    // Pokud je 1 čas, záleží, jestli jde o první stanici (pak je to odjezd)
                    if (index === 0) {
                        depActual = actualSpans[0].textContent.trim();
                        depColor = getColorClass(actualSpans[0]);
                    } else {
                        arrActual = actualSpans[0].textContent.trim();
                        arrColor = getColorClass(actualSpans[0]);
                    }
                }

                if (plannedSpans.length >= 2) {
                    arrPlanned = plannedSpans[0].textContent.replace(/[()]/g, '').trim();
                    depPlanned = plannedSpans[1].textContent.replace(/[()]/g, '').trim();
                } else if (plannedSpans.length === 1) {
                    if (index === 0) {
                        depPlanned = plannedSpans[0].textContent.replace(/[()]/g, '').trim();
                    } else {
                        arrPlanned = plannedSpans[0].textContent.replace(/[()]/g, '').trim();
                    }
                }

                // Geniální fix pro první a poslední stanici (aby tabulka neměla prázdné díry)
                if (index === 0 && !arrActual && depActual) {
                    arrActual = depActual; arrPlanned = depPlanned; arrColor = depColor;
                }
                if (index === stationRows.length - 1 && !depActual && arrActual) {
                    depActual = arrActual; depPlanned = arrPlanned; depColor = arrColor;
                }

                stops.push({
                    station: stationName,
                    isNAD: isLocalNAD,
                    arr: { actual: arrActual, planned: arrPlanned, color: arrColor },
                    dep: { actual: depActual, planned: depPlanned, color: depColor }
                });
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
