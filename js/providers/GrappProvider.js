import BaseProvider from './BaseProvider.js';

export default class GrappProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'GRAPP';
        this.apiUrl = 'https://grapp-bridge.onrender.com/grapp'; 
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`GRAPP Můstek vrátil chybu: ${response.status}`);

            const rawData = await response.json();
            return this.normalize(rawData);
            
        } catch (error) {
            console.error(`Chyba ve zdroji GRAPP:`, error);
            return []; 
        }
    }

    normalize(rawData) {
        if (!rawData || !rawData.Trains) return [];

        return rawData.Trains.map(train => {
            const heading = train.Angle === -32768 ? null : train.Angle;
            const titleParts = train.Title.trim().split(' ');
            
            let matchId = train.Title.trim(); 
            if (titleParts.length >= 2) {
                matchId = `${titleParts[0]} ${titleParts[1]}`;
            }

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
                attributes: {
                    hasETCS: train.ETCS
                }
            };
        });
    }
}
