import BaseProvider from './BaseProvider.js';

export default class VdvProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'VDV';
    }

    async fetchData() {
        try {
            const targetUrl = `https://mapavdv.kr-vysocina.cz/Ajax/GetPoints?t=${Date.now()}`;
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`VDV API chyba: ${response.status}`);
            
            const data = await response.json();
            return this.normalize(data);
        } catch (error) {
            console.error("Chyba VDV:", error.message);
            return [];
        }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        let fullText = attributes.text || '?';
        let shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
        
        let destination = attributes.finalStopName || '?';
        if (destination.includes('N/a')) destination = 'Neznámý cíl';

        let stop = 'Na trase...';
        
        let delayNum = attributes.delay;
        let delayText = '0 min';
        if (delayNum === -2147483648) delayText = 'Neznámé';
        else if (delayNum !== 0) delayText = delayNum > 0 ? `+${delayNum} min` : `${delayNum} min`;

        let route = shortRoute;
        let timetableRoute = fullText;

        try {
            const targetUrl = `https://mapavdv.kr-vysocina.cz/Ajax/OpenInfoWindow?id=${attributes.id}&t=${Date.now()}`;
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

            const res = await fetch(proxyUrl);
            if (res.ok) {
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                
                let exSpoj = null;
                const trs = doc.querySelectorAll('tr');
                
                trs.forEach(tr => {
                    const th = tr.querySelector('th');
                    const td = tr.querySelector('td');
                    if (th && td) {
                        // NEPRŮSTŘELNÁ KONTROLA: Vše na malá písmena, ignorujeme přesnou diakritiku a mezery
                        const key = th.textContent.toLowerCase();
                        const val = td.textContent.trim();
                        
                        if (key.includes('linka')) fullText = val;
                        if (key.includes('spoj')) exSpoj = val;
                        if (key.includes('zast')) stop = val;
                        if (key.includes('zpo')) {
                            if (val.toLowerCase().includes('včas') || val.includes('0 min')) {
                                delayText = '0 min';
                            } else {
                                let parsed = parseInt(val);
                                if (!isNaN(parsed)) delayText = parsed > 0 ? `+${parsed} min` : `${parsed} min`;
                            }
                        }
                    }
                });

                shortRoute = fullText.length >= 3 ? fullText.slice(-3) : fullText;
                if (exSpoj) {
                    route = `${shortRoute}/${exSpoj}`;
                    timetableRoute = `${fullText}/${exSpoj}`;
                }
            }
        } catch (e) {
            console.warn("VDV Detail selhal, použiji základní atributy.");
        }

        return { route, timetableRoute, destination, stop, delay, carrier: 'VDV Vysočina', isNAD: false };
    }

    async getRouteInfo() { return null; }

    async getTimetable(globalId, attributes) {
        if (!attributes || attributes.id === undefined) return null;

        const targetUrl = `https://mapavdv.kr-vysocina.cz/Ajax/GetTimetable?vehicleNumber=${attributes.id}&currentStopId=0&t=${Date.now()}`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        try {
            const response = await fetch(proxyUrl);
            if (!response.ok) return null;
            
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('#timetableCurrentContainer tbody tr');
            if (!rows || rows.length === 0) return null;

            const stops = [];
            let delayMins = (attributes.delay !== undefined && attributes.delay !== -2147483648) ? attributes.delay : 0;

            let color = '#58d68d';
            if (delayMins > 15) color = '#e74c3c';
            else if (delayMins > 5) color = '#f39c12';
            else if (delayMins < 0) color = '#bada55';

            const extractTime = (td) => {
                if (!td) return null;
                const text = td.textContent.trim();
                return text && text !== '--:--' && text !== '' ? text : null;
            };

            const calculateActualTime = (plannedTime, delay) => {
                 if (!plannedTime) return null;
                 let parts = plannedTime.split(':');
                 if(parts.length < 2) return plannedTime;
                 let pMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
                 let aMins = pMins + delay;
                 if (aMins < 0) aMins += 24 * 60;
                 if (aMins >= 24 * 60) aMins %= (24 * 60);
                 return `${Math.floor(aMins / 60).toString().padStart(2, '0')}:${(aMins % 60).toString().padStart(2, '0')}`;
            };

            rows.forEach((row, index) => {
                const tds = row.querySelectorAll('td');
                if (tds.length < 3) return;

                const stationName = tds[0].textContent.trim();
                const pArr = extractTime(tds[1]);
                const pDep = extractTime(tds[2]);
                const aArr = calculateActualTime(pArr, delayMins);
                const aDep = calculateActualTime(pDep, delayMins);

                let arrival = null;
                let departure = null;
                const arrBlock = { planned: pArr, actual: aArr, color: color };
                const depBlock = { planned: pDep, actual: aDep, color: color };

                if (index === 0) departure = depBlock;
                else if (index === rows.length - 1) arrival = arrBlock;
                else { arrival = arrBlock; departure = depBlock; }

                stops.push({ station: stationName, isNAD: false, isPassing: false, arr: arrival, dep: departure });
            });
            
            return stops;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !Array.isArray(rawData)) return [];
        const vehicles = [];
        
        for (const trip of rawData) {
            if (trip.traction === "TRAIN") continue;
            if (!trip.text || trip.text.length <= 3) continue;

            let delay = trip.delay;
            if (delay === -2147483648) delay = 0;

            let headsign = trip.finalStopName || 'Neznámý cíl';
            if (headsign.includes('N/a')) headsign = 'Neznámý cíl';
            
            let shortRoute = trip.text.slice(-3);

            vehicles.push({
                id: `vdv_${trip.id}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lng,
                heading: null, 
                route: shortRoute,
                headsign: headsign,
                globalMatchId: `vdv_${trip.text}_${trip.id}`,
                delay: delay,
                attributes: { ...trip }
            });
        }
        return vehicles;
    }
}
