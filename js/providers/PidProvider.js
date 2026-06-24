import BaseProvider from './BaseProvider.js';

export default class PidProvider extends BaseProvider {
    constructor() {
        super();
        this.providerName = 'PID';
        this.apiUrl = 'https://grapp-bridge.onrender.com/pid';
        this.detailUrl = 'https://grapp-bridge.onrender.com/pid/detail';
        this.shapeUrl = 'https://grapp-bridge.onrender.com/pid/shape';
        this.timetableUrl = 'https://grapp-bridge.onrender.com/pid/timetable';
    }

    async fetchData() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`PID Můstek vrátil chybu: ${response.status}`);
            const data = await response.json();
            return this.normalize(data);
        } catch (error) { return []; }
    }

    async getDetails(globalId, attributes) {
        if (!attributes) return null;

        let routeLine = attributes.route || '?';
        let destination = attributes.headsign || '?';
        let stop = 'Zjišťuji...';
        let delaySecs = attributes.delay || 0;
        let delayMins = Math.round(delaySecs / 60);
        let delay = delayMins === 0 ? '0 min' : `${delayMins} min`;
        let carrier = 'PID';
        let isNAD = false;

        let isWaiting = (attributes.inactive === true || attributes.statePosition === 'before_track');
        if (isWaiting) delay = '0 min'; 

        const idParts = globalId.split('_');
        const runNum = idParts.length >= 3 ? idParts[2] : '';
        
        // Klasická krátká linka pro mapu a nadpis panelu
        let route = runNum ? `${routeLine}/${runNum}` : routeLine;

        let timetableRoute = (attributes.cisjrLine && attributes.cisjrTrip) 
            ? `${attributes.cisjrLine}/${attributes.cisjrTrip}` 
            : route;

        if (attributes.vehicle !== undefined && attributes.routeType !== undefined) {
            const url = `${this.detailUrl}?route_type=${attributes.routeType}&vehicle=${attributes.vehicle}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.infowindow_content) {
                        const doc = new DOMParser().parseFromString(data.infowindow_content, 'text/html');

                        const trs = doc.querySelectorAll('table.vehicleWindowBody tr');
                        trs.forEach(tr => {
                            const tds = tr.querySelectorAll('td');
                            if (tds.length >= 2) {
                                const label = tds[0].textContent.trim();
                                const val = tds[1].textContent.replace(/\n/g, '').trim();
                                if (label === 'Dopravce:') carrier = val.split(/\s{2,}/)[0];
                                else if (label === 'Oběh:') routeLine = val.split('/')[0].trim();
                            }
                        });

                        route = runNum ? `${routeLine}/${runNum}` : routeLine;
                        if (!attributes.cisjrLine) timetableRoute = route; 

                        const headsignDiv = doc.querySelector('.headsign');
                        if (headsignDiv) {
                            let destText = headsignDiv.innerHTML.replace(/<br\s*\/?>/ig, ' ');
                            const tempDoc = new DOMParser().parseFromString(destText, 'text/html');
                            destText = tempDoc.body.textContent.replace(/\s+/g, ' ').trim();

                            const match = destText.match(/(.*?)dále jako linka\s+(.*?)\s+směr\s+(.*)/i);
                            if (match) {
                                destination = `${match[1].trim()} > ${match[3].trim()}`;
                                route = `${route} > ${match[2].trim()}`; 
                                if (!attributes.cisjrLine) timetableRoute = route;
                            } else {
                                destination = destText;
                            }
                        }

                        let fromStop = null;
                        const fromStopRow = doc.querySelector('.fromStopName');
                        if (fromStopRow) {
                            const tds = fromStopRow.querySelectorAll('td');
                            if (tds.length >= 2) fromStop = tds[1].textContent.trim();
                        }

                        let currentStop = null;
                        const currentStopRow = doc.querySelector('.currentStop');
                        if (currentStopRow) {
                            const tds = currentStopRow.querySelectorAll('td');
                            if (tds.length >= 2) currentStop = tds[1].textContent.trim();
                        }

                        if (isWaiting && fromStop) stop = fromStop;
                        else if (currentStop) stop = currentStop;
                        else if (fromStop) stop = fromStop;
                        else stop = 'Neznámá';

                        const currentDelayDiv = doc.querySelector('.currentDelay');
                        if (currentDelayDiv && !currentDelayDiv.classList.contains('inactive')) {
                            const delaySpan = currentDelayDiv.querySelector('span');
                            if (delaySpan) {
                                let delayRaw = delaySpan.textContent.replace(/\u00A0/g, '').replace('min.', '').replace(/\s+/g, '').toLowerCase();
                                if (delayRaw.includes('včas')) delay = '0 min';
                                else if (delayRaw !== '') delay = delayRaw + ' min';
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn("PID Detail selhal, použije se fallback.");
            }
        }

        // Musíme ji poslat ven, aby si ji app.js mohlo přečíst!
        return { route, timetableRoute, destination, stop, delay, carrier, isNAD };
    }

    async getRouteInfo(globalId, attributes) {
        const tripId = globalId.replace('pid_', '');
        const url = `${this.shapeUrl}?id=${tripId}`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.shape || !Array.isArray(data.shape)) return null;
            return data.shape.map(point => [point.lon, point.lat]);
        } catch (error) { return null; }
    }

    async getTimetable(globalId, attributes) {
        if (!attributes) return null;
        const actualId = attributes.tripId || attributes.id || attributes.trip_id;
        if (!actualId) return null;
        
        const vehicle = attributes.vehicle || '';
        const url = `${this.timetableUrl}?trip_id=${actualId}&vehicle=${vehicle}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.html) return null;

            const doc = new DOMParser().parseFromString(data.html, 'text/html');
            const rows = doc.querySelectorAll('table.timetable tbody tr');
            const stops = [];

            const roundTime = (timeStr) => {
                if (!timeStr) return null;
                const parts = timeStr.split(':');
                if (parts.length === 3) {
                    let h = parseInt(parts[0], 10);
                    let m = parseInt(parts[1], 10);
                    let s = parseInt(parts[2], 10);
                    if (s >= 46) {
                        m += 1;
                        if (m >= 60) { m = 0; h = (h + 1) % 24; }
                    }
                    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                } else if (parts.length === 2) {
                    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
                }
                return timeStr;
            };

            const extractTimes = (td) => {
                return td.innerHTML.split(/<br\s*\/?>/i).map(str => {
                    return str.replace(/<[^>]*>/g, '').replace(/[()]/g, '').trim();
                }).filter(t => t);
            };

            const createBlock = (plannedRaw, actualRaw) => {
                let planned = roundTime(plannedRaw);
                let actual = roundTime(actualRaw);

                if (!actual && planned) {
                    let delayS = attributes.delay || 0;
                    let isWait = (attributes.inactive === true || attributes.statePosition === 'before_track');
                    if (isWait) delayS = 0; 
                    let delayM = Math.round(delayS / 60);
                    let pParts = planned.split(':');
                    let pMins = parseInt(pParts[0], 10) * 60 + parseInt(pParts[1], 10);
                    let aMins = pMins + delayM;

                    if (aMins < 0) aMins += 24 * 60;
                    if (aMins >= 24 * 60) aMins %= (24 * 60);

                    let aH = Math.floor(aMins / 60).toString().padStart(2, '0');
                    let aM = (aMins % 60).toString().padStart(2, '0');
                    actual = `${aH}:${aM}`;
                }

                let color = '#58d68d'; 
                if (actual && planned) {
                    let aMins = parseInt(actual.split(':')[0])*60 + parseInt(actual.split(':')[1]);
                    let pMins = parseInt(planned.split(':')[0])*60 + parseInt(planned.split(':')[1]);
                    let diff = aMins - pMins;
                    if (diff < -12*60) diff += 24*60; 
                    if (diff > 12*60) diff -= 24*60;  
                    if (diff < 0) color = '#bada55'; 
                    else if (diff <= 5) color = '#58d68d'; 
                    else if (diff <= 15) color = '#f39c12'; 
                    else color = '#e74c3c'; 
                }
                return { actual, planned, color };
            };

            rows.forEach((row, index) => {
                const tds = row.querySelectorAll('td');
                if (tds.length < 4) return;
                
                const stationName = tds[1].textContent.trim();
                const pTimes = extractTimes(tds[2]); 
                const aTimes = extractTimes(tds[3]); 

                let arrival = null;
                let departure = null;

                if (pTimes.length >= 2) {
                    arrival = createBlock(pTimes[0], aTimes[0]);
                    departure = createBlock(pTimes[1], aTimes[1]);
                } else {
                    const singleBlock = createBlock(pTimes[0], aTimes[0]);
                    if (index === 0) departure = singleBlock;
                    else if (index === rows.length - 1) arrival = singleBlock;
                    else { arrival = singleBlock; departure = singleBlock; }
                }

                stops.push({ station: stationName, isNAD: false, isPassing: false, arr: arrival, dep: departure });
            });

            return stops;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.trips) return [];
        
        const tripsArray = Array.isArray(rawData.trips) ? rawData.trips : Object.values(rawData.trips);
        const vehicles = [];
        
        for (const trip of tripsArray) {
            if (trip.routeType === 2) continue; 

            let heading = (trip.bearing !== undefined && trip.bearing !== null) ? trip.bearing : null;
            if (trip.inactive === true || trip.statePosition === 'before_track') heading = null; 

            const actualId = trip.tripId || trip.id || trip.trip_id;
            if (!actualId) continue;
            
            const cisjrLine = trip.cisjrLine;
            const cisjrTrip = trip.cisjrTrip;
            const matchId = (cisjrLine && cisjrTrip) ? `${cisjrLine}_${cisjrTrip}` : `pid_${trip.route}_${actualId}`;

            vehicles.push({
                id: `pid_${actualId}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon,
                heading: heading,
                route: trip.route || '?',
                headsign: trip.headsign || 'Neznámý cíl',
                globalMatchId: matchId, 
                delay: trip.delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
