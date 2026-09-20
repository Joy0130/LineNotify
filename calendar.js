// 行事曆模組
const HOUR_HEIGHT = 64;
const BLOCK_GAP = 4;
const MOBILE_BREAKPOINT = 768;

const WEEK_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

let calendarAnchor = new Date();
let calendarDays = 7;              // 7 = 週一到週日，5 = 工作天
let calendarMode = 'week';         // 'week' | 'day'，由視窗寬度決定
let openPopoverKey = null;         // '<noteId>|<時間戳>'，null 表示未開啟

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

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

// 依目前模式回傳實際顯示的區間
function getVisibleRange() {
    if (calendarMode === 'day') return getDayRange(calendarAnchor);
    const w = getWeekRange(calendarAnchor);
    if (calendarDays === 5) {
        return { start: w.start, end: new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + 5) };
    }
    return w;
}

function formatCalendarTitle(range, dayCount) {
    const s = range.start;
    const e = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - 1);
    if (dayCount === 1) {
        return `${s.getFullYear()} 年 ${s.getMonth() + 1} 月 ${s.getDate()} 日（${WEEK_LABELS[s.getDay()]}）`;
    }
    if (s.getMonth() === e.getMonth()) {
        return `${s.getFullYear()} 年 ${s.getMonth() + 1} 月 ${s.getDate()} – ${e.getDate()} 日`;
    }
    return `${s.getFullYear()} 年 ${s.getMonth() + 1} 月 ${s.getDate()} 日 – ${e.getMonth() + 1} 月 ${e.getDate()} 日`;
}

function createOccurrenceHtml(note, occurrenceTime, layout) {
    const status = getNoteStatus(note, occurrenceTime);
    const cat = getCategoryColor(note.category);
    const isRepeat = !!(note.repeat && note.repeat.type === 'repeat');
    const hhmm = String(occurrenceTime.getHours()).padStart(2, '0') + ':'
               + String(occurrenceTime.getMinutes()).padStart(2, '0');
    const safeContent = escapeHtml(note.content || '');
    const safeCategory = escapeHtml(note.category || '');

    const repeatIcon = isRepeat
        ? '<i data-lucide="refresh-cw" class="w-3 h-3 absolute right-1 bottom-1 text-slate-500"></i>'
        : '';

    return `<div class="cal-block group absolute overflow-hidden cursor-pointer ${status.cardClass}"
        style="top:${layout.top}px; height:${layout.height}px; left:calc(${layout.leftPct}% + 2px); width:calc(${layout.widthPct}% - 4px); border-left:3px solid ${cat.bar};"
        title="${safeContent}"
        onclick="openOccurrencePopover('${note.id}', ${occurrenceTime.getTime()}, this)">
        <div class="absolute top-0.5 right-0.5 flex gap-0.5 z-10 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="event.stopPropagation(); startEdit('${note.id}')" title="編輯" class="w-5 h-5 flex items-center justify-center bg-white/90 rounded text-amber-500 hover:bg-white"><i data-lucide="edit-2" class="w-3 h-3"></i></button>
            <button onclick="event.stopPropagation(); deleteNote('${note.id}')" title="刪除" class="w-5 h-5 flex items-center justify-center bg-white/90 rounded text-rose-500 hover:bg-white"><i data-lucide="trash-2" class="w-3 h-3"></i></button>
        </div>
        <div class="px-1.5 py-1">
            <div class="cal-clamp text-xs leading-snug text-slate-800 pr-11">${safeContent}</div>
            <div class="text-[11px] text-slate-500 truncate">${hhmm}${safeCategory ? ' · ' + safeCategory : ''}</div>
        </div>
        ${repeatIcon}
    </div>`;
}

function renderCalendar() {
    const view = document.getElementById('calendar-view');
    if (!view || view.classList.contains('hidden')) return;
    closeOccurrencePopover();

    calendarMode = (window.innerWidth < MOBILE_BREAKPOINT) ? 'day' : 'week';

    const range = getVisibleRange();
    const dayCount = Math.round((range.end - range.start) / 86400000);
    const filtered = getFilteredNotes();
    const today = new Date();

    // 逐日收集展開後的時間點
    const days = [];
    let allOcc = [];
    for (let i = 0; i < dayCount; i++) {
        const dayStart = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + i);
        const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
        const entries = [];
        filtered.forEach(n => {
            expandOccurrences(n, dayStart, dayEnd).forEach(t => entries.push({ note: n, time: t }));
        });
        entries.sort((a, b) => a.time - b.time);
        days.push({ date: dayStart, entries: entries });
        allOcc = allOcc.concat(entries.map(e => e.time));
    }

    const hours = computeHourRange(allOcc);
    const colHeight = (hours.endHour - hours.startHour) * HOUR_HEIGHT;
    const template = `52px repeat(${dayCount}, minmax(0, 1fr))`;

    document.getElementById('calendar-title').innerText = formatCalendarTitle(range, dayCount);

    // 日期標題列
    let head = '<div class="sticky left-0 z-30 bg-white"></div>';
    days.forEach(d => {
        const isToday = isSameDay(d.date, today);
        head += `<div class="text-center py-1.5 border-l border-slate-100 ${isToday ? 'bg-teal-50' : ''}">
            <div class="text-lg font-bold ${isToday ? 'text-teal-600' : 'text-slate-700'}">${d.date.getDate()}</div>
            <div class="text-[11px] ${isToday ? 'text-teal-600' : 'text-slate-400'}">${WEEK_LABELS[d.date.getDay()]}</div>
        </div>`;
    });
    const headEl = document.getElementById('calendar-head');
    headEl.style.gridTemplateColumns = template;
    headEl.innerHTML = head;

    // 時間軸欄
    let body = `<div class="relative sticky left-0 z-10 bg-white" style="height:${colHeight}px">`;
    for (let h = hours.startHour; h < hours.endHour; h++) {
        const labelTop = Math.max(0, (h - hours.startHour) * HOUR_HEIGHT - 7);
        body += `<div class="absolute right-1.5 text-[11px] text-slate-400" style="top:${labelTop}px">${String(h).padStart(2, '0')}:00</div>`;
    }
    body += '</div>';

    // 每日欄
    days.forEach(d => {
        const isToday = isSameDay(d.date, today);
        const layout = layoutDayColumn(d.entries.map(e => e.time), hours.startHour);
        let blocks = '';
        d.entries.forEach((e, i) => { blocks += createOccurrenceHtml(e.note, e.time, layout[i]); });
        body += `<div class="cal-col relative border-l border-slate-100 ${isToday ? 'bg-teal-50/40' : ''}" style="height:${colHeight}px">${blocks}</div>`;
    });

    if (allOcc.length === 0) {
        body += '<div class="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-sm">這段期間沒有符合條件的記事</div>';
    }

    const bodyEl = document.getElementById('calendar-body');
    bodyEl.style.gridTemplateColumns = template;
    bodyEl.innerHTML = body;

    lucide.createIcons();
}

function openOccurrencePopover(noteId, occurrenceMs, anchorEl) {
    const note = notes.find(n => n.id === noteId);
    const pop = document.getElementById('calendar-popover');
    if (!note || !pop) return;

    const key = noteId + '|' + occurrenceMs;
    if (openPopoverKey === key) { closeOccurrencePopover(); return; }

    const t = new Date(occurrenceMs);
    const status = getNoteStatus(note, t);
    const cat = getCategoryColor(note.category);
    const isRepeat = !!(note.repeat && note.repeat.type === 'repeat');

    pop.innerHTML = `
        <div class="flex items-start justify-between gap-2 p-3 border-b border-slate-100">
            <span class="text-xs font-bold px-2 py-1 rounded-full ${status.badgeClass}">${getStatusBadgeHtml(status)}</span>
            <button onclick="closeOccurrencePopover()" aria-label="關閉" class="text-slate-400 hover:text-slate-600"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        <div class="p-3 space-y-2">
            <div class="text-sm text-slate-800 whitespace-pre-wrap break-all overflow-y-auto" style="max-height:240px">${escapeHtml(note.content || '')}</div>
            <div class="flex items-center gap-1 text-xs text-slate-500">
                <i data-lucide="clock" class="w-3.5 h-3.5"></i> ${formatDateTime(t.toISOString())}
            </div>
            <div><span class="text-xs font-bold px-2 py-0.5 rounded-full ${cat.chip}">${escapeHtml(note.category || '')}</span></div>
            ${isRepeat ? `<div class="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-2">${getRepeatSummaryHtml(note.repeat)}</div>` : ''}
        </div>
        <div class="flex justify-end gap-2 px-3 py-2 bg-slate-50 rounded-b-xl border-t border-slate-100">
            <button onclick="closeOccurrencePopover(); startEdit('${note.id}')" class="px-3 py-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg hover:bg-amber-100 flex items-center gap-1"><i data-lucide="edit-2" class="w-3 h-3"></i> 編輯</button>
            <button onclick="closeOccurrencePopover(); deleteNote('${note.id}')" class="px-3 py-1.5 text-xs text-rose-600 bg-rose-50 rounded-lg hover:bg-rose-100 flex items-center gap-1"><i data-lucide="trash-2" class="w-3 h-3"></i> 刪除</button>
        </div>`;

    // 先顯示才量得到寬高
    pop.classList.remove('hidden');
    const r = anchorEl.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;

    let left = r.right + 8;
    if (left + w > window.innerWidth - 8) left = r.left - w - 8;
    if (left < 8) left = 8;

    let top = r.top;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    if (top < 8) top = 8;

    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    openPopoverKey = key;
    lucide.createIcons();
}

function closeOccurrencePopover() {
    const pop = document.getElementById('calendar-popover');
    if (pop) pop.classList.add('hidden');
    openPopoverKey = null;
}

function bindCalendarGlobalEvents() {
    // 點浮層外關閉。點記事方塊本身不關，因為它的 onclick 會改開新的浮層
    document.addEventListener('click', (e) => {
        if (!openPopoverKey) return;
        const pop = document.getElementById('calendar-popover');
        if (pop && pop.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.cal-block')) return;
        closeOccurrencePopover();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeOccurrencePopover();
    });

    // 浮層是 fixed 定位，容器捲動後位置會失準，直接關閉。
    // 但浮層自己的內容區可捲動（長內容），那種捲動不該關閉浮層。
    window.addEventListener('scroll', (e) => {
        if (!openPopoverKey) return;
        const pop = document.getElementById('calendar-popover');
        if (pop && e.target instanceof Node && pop.contains(e.target)) return;
        closeOccurrencePopover();
    }, true);
}

function calendarShift(deltaDays) {
    calendarAnchor = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), calendarAnchor.getDate() + deltaDays);
    renderCalendar();
}
function calendarPrev()  { calendarShift(calendarMode === 'day' ? -1 : -7); }
function calendarNext()  { calendarShift(calendarMode === 'day' ?  1 :  7); }
function calendarToday() { calendarAnchor = new Date(); renderCalendar(); }

function setCalendarDays(n) {
    calendarDays = (n === 5) ? 5 : 7;
    localStorage.setItem('calendarDays', String(calendarDays));
    updateDaysToggleUI();
    renderCalendar();
}

function updateDaysToggleUI() {
    document.querySelectorAll('.cal-days-btn').forEach(b => {
        const on = parseInt(b.dataset.days, 10) === calendarDays;
        b.className = 'cal-days-btn px-3 py-1.5 text-xs transition-colors '
                    + (on ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    calendarDays = (localStorage.getItem('calendarDays') === '5') ? 5 : 7;
    updateDaysToggleUI();
    bindCalendarGlobalEvents();
    renderCalendar();
});
