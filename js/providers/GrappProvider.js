import BaseProvider from './BaseProvider.js';

export default class GrappProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'GRAPP';
        // URL tvého Render můstku
        this.apiUrl = 'https://TVE-NOVE-URL.onrender.com/grapp'; 
        this.currentToken = ''; // Sem si uložíme token pro detaily
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`GRAPP Můstek vrátil chybu: ${response.status}`);

            const responseJson = await response.json();
            
            // Uložíme si aktuální token
            if (responseJson.Token) {
                this.currentToken = responseJson.Token;
            }

            // Normalizujeme samotná data
            return this.normalize(responseJson.Data);
            
        } catch (error) {
            console.error(`Chyba ve zdroji GRAPP:`, error);
            return []; 
        }
    }

    // --- NOVÁ FUNKCE PRO ZÍSKÁNÍ DETAILŮ ---
    async getDetails(globalId) {
        // Získáme čisté ID vlaku (odstraníme předponu 'grapp_')
        const trainId = globalId.replace('grapp_', '');
        
        // URL přímo na SŽ (i s naším tokenem a náhodným číslem proti cache)
        const url = `https://grapp.spravazeleznic.cz/OneTrain/MainInfo/${this.currentToken}?trainId=${trainId}&_=${Date.now()}`;
        
        // Jelikož děláme dotaz z prohlížeče, pro jistotu ho obalíme do CORS proxy. 
        // Pokud říkáš, že proxy není potřeba, můžeš `corsproxy.io` smazat.
        const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);

        try {
            const response = await fetch(proxyUrl);
            const html = await response.text();

            // Geniální trik: Necháme prohlížeč načíst HTML skrytě do paměti a pak z něj taháme data
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Pomocná funkce, která najde správný řádek tabulky podle jeho levé části
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

            // Vyzobání konkrétních dat z HTML
            const route = doc.querySelector('.fontSizeBig1')?.textContent.trim() || '?';
            const carrier = doc.querySelector('.carrierRestrictionLink')?.textContent.trim() || '?';
            const destination = findValueByLabel('cílová stanice') || '?';
            const stop = findValueByLabel('potvrzená stanice') || '?';

            // Zpoždění může být napsáno jako 'zpoždění' nebo 'náskok'
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
                id: `grapp_${train.Id}`, // Toto ID teď používáme pro getDetails!
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
