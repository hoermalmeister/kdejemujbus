const PROVIDER_PRIORITY = [
    'GRAPP', 'PID', 'DÚK', 'IDOL', 'IREDO', 'IDS JMK', 'IDSOK', 'IDZK', 
    'ODIS', 'IDPK', 'VDV', 'PMDP', 'DPMML', 'DPMD', 'DPMP', 'DPMHK', 
    'DPKV', 'DPMJ', 'TSHB', 'DPMLB'
];

export default class Deduplicator {
    constructor() {
        this.vehicles = new Map();
    }

    processData(allFetchedVehicles) {
        const newVehiclesState = new Map();

        for (const vehicle of allFetchedVehicles) {
            if (!vehicle.globalMatchId) continue;

            const matchId = vehicle.globalMatchId; 

            if (!newVehiclesState.has(matchId)) {
                newVehiclesState.set(matchId, vehicle);
                continue;
            }

            const existingVehicle = newVehiclesState.get(matchId);
            const existingPriority = PROVIDER_PRIORITY.indexOf(existingVehicle.provider);
            const newPriority = PROVIDER_PRIORITY.indexOf(vehicle.provider);

            if (newPriority === -1) continue;

            if (newPriority < existingPriority) {
                newVehiclesState.set(matchId, vehicle);
            }
        }

        this.vehicles = newVehiclesState;
    }

    getCleanData() {
        return Array.from(this.vehicles.values());
    }
}
