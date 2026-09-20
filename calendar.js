// 行事曆模組
const HOUR_HEIGHT = 64;
const BLOCK_GAP = 4;
const MOBILE_BREAKPOINT = 768;

// 回傳 note 在 [rangeStart, rangeEnd) 內的所有發生時間點，由早到晚排序
function expandOccurrences(note, rangeStart, rangeEnd) {
    const base = parseNoteDateTime(note.datetime);
    const rep = note.repeat;

    if (!rep || rep.type !== 'repeat') {
        if (!base) return [];
        return (base >= rangeStart && base < rangeEnd) ? [base] : [];
    }

    // 時分取自 note.datetime（GAS 推進時保留時分），無法解析時退回 startDate
    const timeSource = base || parseNoteDateTime(rep.startDate);
    if (!timeSource) return [];
    const hh = timeSource.getHours();
    const mm = timeSource.getMinutes();

    let from = rangeStart;
    const repStart = parseNoteDateTime(rep.startDate);
    if (repStart && repStart > from) from = repStart;

    let to = rangeEnd;
    if (rep.endDate) {
        const endStr = rep.endDate.includes('T') ? rep.endDate : rep.endDate + 'T23:59:59';
        const repEnd = parseNoteDateTime(endStr);
        if (repEnd) {
            const exclusiveEnd = new Date(repEnd.getTime() + 1000);
            if (exclusiveEnd < to) to = exclusiveEnd;
        }
    }
    if (from >= to) return [];

    const out = [];
    const dayCount = Math.ceil((rangeEnd - rangeStart) / 86400000) + 1;
    for (let i = 0; i < dayCount; i++) {
        const day = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i);
        if (day >= rangeEnd) break;

        let match = false;
        if (rep.frequency === 'daily') {
            match = true;
        } else if (rep.frequency === 'weekly') {
            match = Array.isArray(rep.weekDays) && rep.weekDays.includes(day.getDay());
        } else if (rep.frequency === 'monthly') {
            match = Array.isArray(rep.monthDays) && rep.monthDays.includes(day.getDate());
        }
        if (!match) continue;

        const occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
        if (occ >= from && occ < to && occ >= rangeStart && occ < rangeEnd) out.push(occ);
    }

    out.sort((a, b) => a - b);
    return out;
}

// 週一為一週之始，回傳 [週一 00:00, 次週一 00:00)
function getWeekRange(anchorDate) {
    const d = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    const dow = d.getDay();                       // 0 = 週日
    const offset = (dow === 0) ? -6 : 1 - dow;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end };
}

// 回傳 [當日 00:00, 次日 00:00)
function getDayRange(anchorDate) {
    const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { start, end };
}

// endHour 恆為 24；startHour 為 min(6, 最早的小時)
function computeHourRange(occurrences) {
    let startHour = 6;
    occurrences.forEach(d => { if (d.getHours() < startHour) startHour = d.getHours(); });
    return { startHour: startHour, endHour: 24 };
}

// 每個時間點視為佔用 [t, t + 60 分)，有交集者同群，群內左右平分寬度
function layoutDayColumn(occurrences, startHour) {
    const items = occurrences.map((d, i) => {
        const startMin = d.getHours() * 60 + d.getMinutes();
        return { index: i, startMin: startMin, endMin: startMin + 60 };
    }).sort((a, b) => (a.startMin - b.startMin) || (a.index - b.index));

    const result = new Array(occurrences.length);
    let group = [];
    let groupEnd = -1;

    const flush = () => {
        const n = group.length;
        group.forEach((it, i) => {
            result[it.index] = {
                top: (it.startMin / 60 - startHour) * HOUR_HEIGHT,
                height: HOUR_HEIGHT - BLOCK_GAP,
                leftPct: (i / n) * 100,
                widthPct: 100 / n
            };
        });
        group = [];
        groupEnd = -1;
    };

    items.forEach(it => {
        if (group.length && it.startMin >= groupEnd) flush();
        group.push(it);
        groupEnd = Math.max(groupEnd, it.endMin);
    });
    if (group.length) flush();

    return result;
}
