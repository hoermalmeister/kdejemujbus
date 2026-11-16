// Společné čtení odpovědí portálů PVVD (IDPK – pvvd.idpk.cz, VDV – mapavdv.kr-vysocina.cz).
// Oba portály vracejí stejné HTML: údaje v <dl class="facts">, zpoždění v .delay-value
// a jízdní řád jako tabulku se dvěma sloupci (zastávka, plán). Starší podoby (tabulka
// th/td, tři sloupce s příjezdem a odjezdem) zůstávají podporované jako záloha.

const MINUS = /[−–—]/g; // typografické minus a pomlčky → "-"

function readFacts(doc) {
    const facts = {};
    const add = (keyEl, valueEl) => {
        if (keyEl && valueEl) facts[keyEl.textContent.trim().toLowerCase()] = valueEl.textContent.trim();
    };
    doc.querySelectorAll('dl.facts > div').forEach(item => add(item.querySelector('dt'), item.querySelector('dd')));
    doc.querySelectorAll('table tbody tr, tr').forEach(row => add(row.querySelector('th'), row.querySelector('td')));
    return facts;
}

function pick(facts, ...keys) {
    for (const key of keys) if (facts[key]) return facts[key];
    return null;
}

// Vrátí { line, run, stop, delay } – co se nenašlo, je null. delay je číslo v minutách.
export function parsePvvdDetail(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const facts = readFacts(doc);

    let line = pick(facts, 'linka', 'line');
    let run = pick(facts, 'spoj', 'trip');
    const lineAndRun = pick(facts, 'linka / spoj', 'line / trip');
    if (lineAndRun) {
        const [lineValue, runValue] = lineAndRun.split('/').map(part => part.trim());
        if (lineValue) line = lineValue;
        if (runValue) run = runValue;
    }

    let stop = pick(facts, 'poslední zastávka', 'last stop', 'zastávka', 'stop');
    if (stop && /n\/a/i.test(stop)) stop = null;

    let delay = null;
    const valueText = (doc.querySelector('.delay-value')?.textContent || pick(facts, 'zpoždění', 'delay') || '').replace(MINUS, '-').trim();
    const labelText = (doc.querySelector('.delay-label')?.textContent || '').toLowerCase();
    if (/včas|on time/i.test(valueText)) {
        delay = 0;
    } else {
        const parsed = parseInt(valueText.replace('+', ''), 10);
        if (!isNaN(parsed)) {
            // "náskok" bývá uvedený jen slovně, proto znaménko pojistíme podle popisku
            delay = /náskok|early|ahead/.test(labelText) ? -Math.abs(parsed) : parsed;
        }
    }

    return { line, run, stop, delay };
}

function addMinutes(time, minutes) {
    const match = /^(\d{1,2}):(\d{2})/.exec(time || '');
    if (!match) return null;
    const total = ((Number(match[1]) * 60 + Number(match[2]) + minutes) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Příjezd uvedený v buňce se zastávkou („Jamné příjezd 12:54"), když se liší od odjezdu.
// Vrátí { name, arr } – název bez poznámky a čas příjezdu (nebo null).
const ARRIVAL_IN_NAME = /\s*(?:p\u0159\u00edjezd|prijezd|arrival|arr\.?|p\u0159\.)\s*:?\s*(\d{1,2}:\d{2})\s*/i;
function splitStationCell(cell) {
    const text = cell.textContent.replace(/\s+/g, ' ').trim();
    const match = ARRIVAL_IN_NAME.exec(text);
    if (!match) return { name: text, arr: null };
    return { name: text.replace(match[0], ' ').replace(/\s+/g, ' ').trim(), arr: match[1].padStart(5, '0') };
}

function cleanTime(cell) {
    const text = cell ? cell.textContent.trim() : '';
    return /^\d{1,2}:\d{2}/.test(text) ? text.slice(0, 5).padStart(5, '0') : null;
}

// Jízdní řád ve tvaru pro aplikaci. Projeté zastávky ukazují plán, aktuální a další plán + zpoždění.
export function parsePvvdTimetable(html, delayMins, activeColor) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('#timetableCurrentContainer tbody tr')]
        .map(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) return null;
            const style = row.getAttribute('style') || '';
            const station = splitStationCell(cells[0]);
            return {
                station: station.name,
                // dva sloupce = jeden čas (odjezd, případný příjezd je v buňce se zastávkou),
                // tři sloupce = příjezd a odjezd
                arr: cells.length >= 3 ? cleanTime(cells[1]) : null,
                arrInName: station.arr,
                dep: cleanTime(cells.length >= 3 ? cells[2] : cells[1]),
                isPast: row.classList.contains('is-past'),
                isCurrent: row.classList.contains('is-current') || row.hasAttribute('aria-current')
                    || style.includes('#ff112299') || style.includes('rgba(255, 17, 34')
            };
        })
        .filter(Boolean);
    if (!rows.length) return [];

    // Vše před aktuální zastávkou je projeté, i kdyby řádek neměl třídu is-past
    const currentIndex = rows.findIndex(row => row.isCurrent);
    const lastIndex = rows.length - 1;

    return rows.map((row, index) => {
        const passed = currentIndex >= 0 ? index < currentIndex : row.isPast;
        const block = (planned) => planned ? {
            planned,
            actual: passed ? planned : addMinutes(planned, delayMins),
            color: passed ? '#58d68d' : activeColor
        } : null;

        let arr = null, dep = null;
        if (row.arrInName) {
            // zastávka s delším pobytem: příjezd z poznámky, odjezd ze sloupce s časem
            arr = block(row.arrInName);
            dep = index === lastIndex ? null : block(row.dep);
        } else if (row.arr) {
            // starší podoba se dvěma časy
            arr = index === 0 ? null : block(row.arr);
            dep = index === lastIndex ? null : block(row.dep);
        } else if (index === lastIndex) {
            arr = block(row.dep);
        } else {
            dep = block(row.dep);
        }
        return { station: row.station, arr, dep, isPassing: false, isNAD: false };
    });
}
