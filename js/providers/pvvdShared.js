// Společné čtení odpovědí portálů PVVD (IDPK – pvvd.idpk.cz, VDV – mapavdv.kr-vysocina.cz).
// Oba portály vracejí stejné HTML: údaje v <dl class="facts">, zpoždění v .delay-value
// a jízdní řád jako tabulku (zastávka, plán, očekávaný čas); sloupce se poznají podle hlavičky.
// Starší podoby (bez hlavičky, sloupce příjezd/odjezd) zůstávají podporované jako záloha.

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

// Příjezd uvedený v buňce se zastávkou („Jamné příjezd 12:54", „arrives 19:27"), když se liší
// od odjezdu. Vrátí { name, arr } – název bez poznámky a čas příjezdu (nebo null).
const ARRIVAL_IN_NAME = /\s*(?:příjezd|prijezd|přijíždí|arrives|arrival|arr\.?|př\.)\s*:?\s*(\d{1,2}:\d{2})\s*/i;
function splitStationCell(cell) {
    const note = cell.querySelector('.stop-arrival');
    const noteText = note ? note.textContent : '';
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('.stop-arrival').forEach(el => el.remove());
    let name = clone.textContent.replace(/\s+/g, ' ').trim();
    let arrSource = noteText;
    if (!note) {
        arrSource = name;
    }
    const match = ARRIVAL_IN_NAME.exec(arrSource) || /(\d{1,2}:\d{2})/.exec(noteText);
    if (!match) return { name, arr: null };
    if (!note) name = name.replace(match[0], ' ').replace(/\s+/g, ' ').trim();
    return { name, arr: match[1].padStart(5, '0') };
}

function cleanTime(cell) {
    const text = cell ? cell.textContent.trim() : '';
    return /^\d{1,2}:\d{2}/.test(text) ? text.slice(0, 5).padStart(5, '0') : null;
}

// Význam sloupců podle hlavičky tabulky (Stop | Scheduled | Expected, Zastávka | Plán | Očekávaný…).
// Bez hlavičky: 2 sloupce = zastávka + čas, 3 sloupce = zastávka + příjezd + odjezd (starší podoba).
function columnLayout(doc, cellCount) {
    const headers = [...doc.querySelectorAll('#timetableCurrentContainer thead th')]
        .map(th => th.textContent.replace(/\s+/g, ' ').trim().toLowerCase());
    const find = (re, except) => headers.findIndex(h => re.test(h) && !(except && except.test(h)));
    const EXPECTED = /expected|očekáv|předpokl|skuteč|actual|aktuáln|real/;
    if (headers.length >= 2) {
        const expected = find(EXPECTED);
        const arr = find(/příjezd|arrival|^př\.?$/, EXPECTED);
        const dep = find(/odjezd|departure|^odj\.?$/, EXPECTED);
        const plan = find(/scheduled|plán|plan|jízdní|čas|time/, EXPECTED);
        if (arr >= 0 || dep >= 0 || plan >= 0) {
            return { arr, dep: dep >= 0 ? dep : (arr >= 0 ? -1 : plan), expected };
        }
    }
    if (cellCount >= 3) return { arr: 1, dep: 2, expected: -1 };
    return { arr: -1, dep: 1, expected: -1 };
}

// Jízdní řád ve tvaru pro aplikaci. Projeté zastávky ukazují plán, aktuální a další plán + zpoždění
// (nebo očekávaný čas, pokud ho portál uvádí).
export function parsePvvdTimetable(html, delayMins, activeColor) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const trs = [...doc.querySelectorAll('#timetableCurrentContainer tbody tr')];
    const firstCells = trs.find(tr => tr.querySelectorAll('td').length >= 2)?.querySelectorAll('td').length || 2;
    const layout = columnLayout(doc, firstCells);
    const cellAt = (cells, index) => (index >= 0 && index < cells.length ? cells[index] : null);

    const rows = trs
        .map(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) return null;
            const style = row.getAttribute('style') || '';
            const station = splitStationCell(cells[0]);
            return {
                station: station.name,
                arr: cleanTime(cellAt(cells, layout.arr)),
                arrInName: station.arr,
                dep: cleanTime(cellAt(cells, layout.dep)),
                expected: cleanTime(cellAt(cells, layout.expected)),
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
        const block = (planned, expected) => planned ? {
            planned,
            actual: passed ? planned : (expected || addMinutes(planned, delayMins)),
            color: passed ? '#58d68d' : activeColor
        } : null;

        let arr = null, dep = null;
        if (row.arrInName) {
            // zastávka s delším pobytem: příjezd z poznámky, odjezd ze sloupce s časem
            arr = block(row.arrInName);
            dep = index === lastIndex ? null : block(row.dep, row.expected);
        } else if (row.arr && row.dep) {
            // samostatné sloupce příjezdu a odjezdu
            arr = index === 0 ? null : block(row.arr);
            dep = index === lastIndex ? null : block(row.dep, row.expected);
        } else if (index === lastIndex) {
            arr = block(row.arr || row.dep, row.expected);
        } else {
            dep = block(row.dep || row.arr, row.expected);
        }
        return { station: row.station, arr, dep, isPassing: false, isNAD: false };
    });
}
