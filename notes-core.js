// 無 DOM 依賴的純邏輯，供 script.js 與 calendar.js 共用

// 時區安全的日期解析（與 gas-script.js 的 parseTaipeiTime 一致）
function parseNoteDateTime(str) {
    if (!str) return null;
    const d = (str.includes('+') || str.includes('Z')) ? new Date(str) : new Date(str + '+08:00');
    return isNaN(d.getTime()) ? null : d;
}

const NOTE_STATUS_PRESETS = {
    sent:     { key: 'sent',     text: '已發送',   iconName: 'check-circle',
                cardClass: 'bg-emerald-50 border border-emerald-200',
                badgeClass: 'bg-emerald-100 text-emerald-700' },
    justSent: { key: 'justSent', text: '剛發送',   iconName: 'check-circle',
                cardClass: 'bg-emerald-50 border border-emerald-200',
                badgeClass: 'bg-emerald-100 text-emerald-700' },
    expired:  { key: 'expired',  text: '過期未發', iconName: '',
                cardClass: 'bg-rose-50 border border-rose-200',
                badgeClass: 'bg-rose-100 text-rose-700' },
    waiting:  { key: 'waiting',  text: '等待發送', iconName: 'send',
                cardClass: 'bg-amber-50 border border-transparent shadow-sm',
                badgeClass: 'bg-blue-100 text-blue-700' },
    pending:  { key: 'pending',  text: '待發送',   iconName: 'clock',
                cardClass: 'bg-amber-50 border border-transparent shadow-sm',
                badgeClass: 'bg-amber-100 text-amber-700' }
};

// GAS 每分鐘執行一次，允許 3 分鐘延遲
const ALLOW_DELAY_MINUTES = 3;

// occurrenceTime 為選填。行事曆展開重複記事時傳入該次的時間點；
// 若該時間點不等於 note.datetime（即不是「下一次」），改用簡化規則：早於現在即視為已發送。
function getNoteStatus(note, occurrenceTime) {
    const now = new Date();
    const isRepeat = !!(note.repeat && note.repeat.type === 'repeat');
    const baseTime = parseNoteDateTime(note.datetime);

    if (isRepeat && occurrenceTime && (!baseTime || occurrenceTime.getTime() !== baseTime.getTime())) {
        return occurrenceTime < now ? NOTE_STATUS_PRESETS.sent : NOTE_STATUS_PRESETS.pending;
    }

    const scheduledTime = baseTime;

    if (note.sent) return NOTE_STATUS_PRESETS.sent;

    const isExpired = !!(scheduledTime && scheduledTime < now);

    if (isRepeat && note.lastSentAt && !isExpired) {
        const lastSent = parseNoteDateTime(note.lastSentAt);
        if (lastSent && scheduledTime && lastSent >= scheduledTime) {
            return NOTE_STATUS_PRESETS.justSent;
        }
    }

    if (isExpired) {
        const delayMinutes = (now.getTime() - scheduledTime.getTime()) / 60000;
        return delayMinutes > ALLOW_DELAY_MINUTES ? NOTE_STATUS_PRESETS.expired : NOTE_STATUS_PRESETS.waiting;
    }

    return NOTE_STATUS_PRESETS.pending;
}

// 重建與改版前逐字相同的徽章 HTML
function getStatusBadgeHtml(status) {
    if (!status.iconName) return status.text;
    return `<span><i data-lucide="${status.iconName}" class="inline w-3 h-3"></i> ${status.text}</span>`;
}

// 狀態篩選下拉的三個選項，對應到 getNoteStatus() 的五個 key。
// 列表以整筆記事的狀態比對；行事曆以每一次發生的狀態比對。
function matchesStatusFilter(filterValue, statusKey) {
    if (!filterValue) return true;
    if (filterValue === 'sent')    return statusKey === 'sent' || statusKey === 'justSent';
    if (filterValue === 'pending') return statusKey === 'pending' || statusKey === 'waiting';
    if (filterValue === 'expired') return statusKey === 'expired';
    return true;
}

const CATEGORY_COLORS = {
    '重要':   { header: 'text-rose-600',    bar: '#f43f5e', chip: 'bg-rose-100 text-rose-700' },
    '工作':   { header: 'text-blue-600',    bar: '#3b82f6', chip: 'bg-blue-100 text-blue-700' },
    '私事':   { header: 'text-emerald-600', bar: '#14b8a6', chip: 'bg-teal-100 text-teal-700' },
    '已完成': { header: 'text-purple-600',  bar: '#a855f7', chip: 'bg-purple-100 text-purple-700' }
};

function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS['重要'];
}

// 記事 id 會被插入 onclick 屬性，因此必須限制為安全字元。
// 匯入的備份檔與雲端資料都可能帶入任意字串，於入口處正規化。
function makeNoteId() {
    return Date.now().toString() + Math.random().toString(36).slice(2, 8);
}

function sanitizeNoteIds(list) {
    if (!Array.isArray(list)) return [];
    const seen = Object.create(null);
    return list.map(n => {
        const note = n || {};
        let id = String(note.id == null ? '' : note.id);
        if (!/^[A-Za-z0-9_-]+$/.test(id) || seen[id]) id = makeNoteId();
        while (seen[id]) id = makeNoteId();
        seen[id] = true;
        return id === note.id ? note : Object.assign({}, note, { id: id });
    });
}
