import BaseProvider from './BaseProvider.js';

export default class GrappProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'GRAPP';
        
        // URL pro hlavní data
        this.apiUrl = 'https://grapp-bridge.onrender.com/grapp'; 
        this.detailUrl = 'https://grapp-bridge.onrender.com/grapp/detail'; 
        
        this.currentToken = ''; 
        this.currentSession = ''; 
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`GRAPP Můstek vrátil chybu: ${response.status}`);

            const responseJson = await response.json();
            
            // Uložíme si bezpečnostní klíče pro pozdější rozkliknutí
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
        
        // ZAVOLÁME NÁŠ RENDER SERVER A PŘEDÁME MU VŠE POTŘEBNÉ
        const url = `${this.detailUrl}?id=${trainId}&token=${this.currentToken}&session=${this.currentSession}`;
        
        try {
            const response = await fetch(url);
            const html = await response.text();

            // Pokud SŽ pošle neautorizovaný přístup, vyhodíme chybu
            if (html.includes("Pokus o neautorizovaný přístup")) {
                console.warn("Session SŽ vypršela.");
                return null;
            }

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

            let delay = findValueByLabel('předpokládané zpoždění');
            if (!delay || delay === '-') delay = findValueByLabel('náskok') || '0 min';

            return { route, destination, stop, delay, carrier };

        } catch (error) {
            console.error("Chyba při stahování detailů vlaku:", error);
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
