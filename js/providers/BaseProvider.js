export default class BaseProvider {
    constructor() {
        if (this.constructor === BaseProvider) {
            throw new Error("Abstraktní třídu BaseProvider nelze instancovat přímo.");
        }
        this.providerName = "Základní Třída";
    }

    // Polohy nesmí viset donekonečna. Limit platí včetně stažení těla odpovědi,
    // proto ho po přijetí hlaviček nerušíme.
    fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal });
    }

    // Tuto metodu musí každý provider přepsat
    async fetchData() {
        throw new Error("Metoda fetchData() musí být implementována.");
    }

    // Tuto metodu musí každý provider přepsat
    normalize(rawData) {
        throw new Error("Metoda normalize() musí být implementována.");
    }
}
