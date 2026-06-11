export default class BaseProvider {
    constructor() {
        if (this.constructor === BaseProvider) {
            throw new Error("Abstraktní třídu BaseProvider nelze instancovat přímo.");
        }
        this.providerName = "Základní Třída";
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
