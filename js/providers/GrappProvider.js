import BaseProvider from './BaseProvider.js';

export default class GrappProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'GRAPP';
        // Obalíme původní URL do CORS proxy
        const originalUrl = 'https://grapp.spravazeleznic.cz/post/trains/GetTrainsWithFilter/CDBD03CC6A1C48724FEDBEBB5B874C4A637A38540B347906BDD1C00AD1A49E4A';
        this.apiUrl = 'https://corsproxy.io/?' + encodeURIComponent(originalUrl);
        
        this.payload = {
            "CarrierCode":["991919","992230","992719","991687","993030","990010","993188","993246","993386","993295","991950","992693","991638","991976","993089","993162","991257","992636","546001","991935","991562","993444","993303","991026","991125","993345","992644","992842","991927","993170","991810","994376","993337","993204","542005","993436","f_o_r_e_i_g_n"],
            "PublicKindOfTrain":["LE","Ex","Sp","rj","TL","EC","SC","Os","TLX","IC","EN","R","RJ","NJ","LET","ES"],
            "FreightKindOfTrain":[],"KindOfExtraordinary":[],"TrainRunning":false,"PMD":false,"TrainNoChange":0,
            "BckTrain":false,"TrainOutOfOrder":false,"Delay":["0","30","5","60","15","61"],"DelayMin":-99999,
            "DelayMax":-99999,"SearchByTrainNumber":true,"SearchByTrainName":true,"SearchByTRID":false,
            "SearchByVehicleNumber":false,"SearchTextType":"0","SearchPhrase":"","SelectedTrain":-1,
            "RequestedBy":-1,"OrderedBy":"","UnRestriction":true,"PlRestriction":true,"GPS":null,"ETCS":false
        };
    }

    async fetchData() {
        try {
            console.log(`[${this.providerName}] Stahuji data...`);
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.payload)
            });

            if (!response.ok) throw new Error(`HTTP chyba: ${response.status}`);

            const rawData = await response.json();
            return this.normalize(rawData);
            
        } catch (error) {
            console.error(`[${this.providerName}] Chyba stahování:`, error.message);
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
                attributes: { hasETCS: train.ETCS }
            };
        });
    }
}
