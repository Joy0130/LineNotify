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
