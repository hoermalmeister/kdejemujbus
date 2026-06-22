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
        let delayNum = attributes.delay || 0;
        let delay = delayNum === 0 ? '0 min' : `${delayNum} min`;
        let carrier = 'PID';
        let isNAD = false;

        let isWaiting = (attributes.inactive === true || attributes.statePosition === 'before_track');
        if (isWaiting) delay = '0 min'; 

        const idParts = globalId.split('_');
        const runNum = idParts.length >= 3 ? idParts[2] : '';
        let route = runNum ? `${routeLine}/${runNum}` : routeLine;

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
                                
                                if (label === 'Dopravce:') {
                                    carrier = val.split(/\s{2,}/)[0];
                                } else if (label === 'Oběh:') {
                                    routeLine = val.split('/')[0].trim();
                                }
                            }
                        });

                        route = runNum ? `${routeLine}/${runNum}` : routeLine;

                        // CÍLOVÁ STANICE A PŘEJEZDY KURZŮ
                        const headsignDiv = doc.querySelector('.headsign');
                        if (headsignDiv) {
                            let destText = headsignDiv.innerHTML.replace(/<br\s*\/?>/ig, ' ');
                            const tempDoc = new DOMParser().parseFromString(destText, 'text/html');
                            destText = tempDoc.body.textContent.replace(/\s+/g, ' ').trim();

                            const match = destText.match(/(.*?)dále jako linka\s+(.*?)\s+směr\s+(.*)/i);
                            if (match) {
                                // Explicitní proměnné podle tvého návrhu
                                let firstDest = match[1].trim();
                                let nextRoute = match[2].trim();
                                let secondDest = match[3].trim();
                                
                                destination = `${firstDest} > ${secondDest}`;
                                route = `${route} > ${nextRoute}`; 
                            } else {
                                destination = destText;
                            }
                        }

                        // ZASTÁVKY
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

                        // ZPOŽDĚNÍ, NÁSKOK A "VČAS"
                        const currentDelayDiv = doc.querySelector('.currentDelay');
                        if (currentDelayDiv) {
                            if (currentDelayDiv.classList.contains('inactive')) {
                                delay = '0 min'; 
                            } else {
                                const delaySpan = currentDelayDiv.querySelector('span');
                                if (delaySpan) {
                                    let delayRaw = delaySpan.textContent.replace(/\u00A0/g, '').replace('min.', '').replace(/\s+/g, '').toLowerCase();
                                    
                                    // Explicitní zápis podle tvého návrhu
                                    if (delayRaw.includes('včas')) {
                                        delay = '0 min'; // O zbytek se postará náš app.js (Zelená + "Bez zpoždění")
                                    } else if (delayRaw !== '') {
                                        delay = delayRaw + ' min';
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn("PID Detail selhal, použije se fallback:", error);
            }
        }

        return { route, destination, stop, delay, carrier, isNAD };
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
        if (!attributes || !attributes.tripId) return null;
        
        const tripId = attributes.tripId;
        const vehicle = attributes.vehicle || '';
        const url = `${this.timetableUrl}?trip_id=${tripId}&vehicle=${vehicle}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data || !data.html) return null;

            const doc = new DOMParser().parseFromString(data.html, 'text/html');
            const rows = doc.querySelectorAll('table.timetable tbody tr');
            const stops = [];

            rows.forEach((row, index) => {
                const tds = row.querySelectorAll('td');
                if (tds.length < 4) return;
                
                const stationName = tds[1].textContent.trim();
                let planned = tds[2].textContent.replace(/[()]/g, '').trim(); 
                let actualRaw = tds[3].textContent.trim();
                
                let actual = null;
                if (actualRaw) {
                    const parts = actualRaw.split(':');
                    if (parts.length >= 2) {
                        actual = `${parts[0]}:${parts[1]}`;
                    }
                }

                const parseBlock = () => {
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

                const timeObj = parseBlock();
                let arrival = null;
                let departure = null;

                if (index === 0) {
                    departure = timeObj;
                } else if (index === rows.length - 1) {
                    arrival = timeObj;
                } else {
                    arrival = timeObj;
                    departure = timeObj;
                }

                stops.push({
                    station: stationName,
                    isNAD: false,
                    isPassing: false,
                    arr: arrival,
                    dep: departure
                });
            });

            return stops;
        } catch (error) { return null; }
    }

    normalize(rawData) {
        if (!rawData || !rawData.trips || !Array.isArray(rawData.trips)) return [];
        const vehicles = [];
        
        for (const trip of rawData.trips) {
            if (trip.routeType === 2) continue; 

            let heading = (trip.bearing !== undefined && trip.bearing !== null) ? trip.bearing : null;
            if (trip.inactive === true || trip.statePosition === 'before_track') {
                heading = null; 
            }

            const headsign = trip.headsign || 'Neznámý cíl';

            vehicles.push({
                id: `pid_${trip.tripId}`,
                provider: this.providerName,
                lat: trip.lat,
                lon: trip.lon,
                heading: heading,
                route: trip.route || '?',
                headsign: headsign,
                globalMatchId: `pid_${trip.route}_${trip.tripId}`, 
                delay: trip.delay || 0,
                attributes: { ...trip } 
            });
        }
        return vehicles;
    }
}
