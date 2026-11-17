// Oblasti pro filtr na mapě. Skrytá oblast se vůbec nestahuje ani nevykresluje.
// Zdroje, které nejsou v žádné oblasti (GRAPP, JHMD, ArrivaEX), jsou vidět vždy.
export const REGIONS = [
    { id: 'stc', name: 'Střední Čechy', providers: ['PID', 'Kladno', 'DPMLB'] },
    { id: 'jz', name: 'Jihozápad', providers: ['IDPK', 'IDESKA', 'PMDP', 'MHD Tachov'] },
    { id: 'sz', name: 'Severozápad', providers: ['DÚK', 'DPKV', 'DPMÚL', 'MDT', 'DPMD'] },
    { id: 'sv', name: 'Severovýchod', providers: ['IDOL', 'IREDO', 'DPMHK', 'DPMP', 'MHD Ústí n.O.', 'MHD Jičín', 'MHD Špindlerův Mlýn'] },
    { id: 'jv', name: 'Jihovýchod', providers: ['VDV', 'IDS JMK', 'DPMJ', 'TSHB'] },
    { id: 'sm', name: 'Střední Morava', providers: ['IDSOK', 'IDZK', 'DSZO', 'TSMK'] },
    { id: 'msk', name: 'Moravskoslezsko', providers: ['ODIS'] }
];

// Ukládáme skryté oblasti, takže nově přidaná oblast bude ve výchozím stavu zobrazená
const COOKIE_NAME = 'kdejemujbus_hidden_regions';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // rok

export function loadHiddenRegions() {
    try {
        const entry = document.cookie.split('; ').find(part => part.startsWith(`${COOKIE_NAME}=`));
        if (!entry) return new Set();
        const known = new Set(REGIONS.map(r => r.id));
        return new Set(decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)).split(',').filter(id => known.has(id)));
    } catch {
        return new Set();
    }
}

export function saveHiddenRegions(hidden) {
    try {
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${COOKIE_NAME}=${encodeURIComponent([...hidden].join(','))}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
    } catch {
        // cookies zakázané – volba platí jen do zavření stránky
    }
}
