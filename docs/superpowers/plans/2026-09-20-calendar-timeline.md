# 行事曆時間軸檢視 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在現有的 LINE 提醒記事本中新增一個 Google 日曆風格的行事曆檢視，以絕對定位的時間軸呈現記事，與既有的卡片列表共用篩選、狀態顏色與編輯刪除邏輯。

**Architecture:** 三層檔案切分。`notes-core.js` 放無 DOM 依賴的純邏輯（時間解析、狀態判定、分類顏色），`calendar.js` 放行事曆的純計算與渲染，既有的 `script.js` 只做抽出與串接。純計算函式由 `test-calendar.html` 以瀏覽器測試頁驗證。行事曆採絕對定位：每日欄是 `position: relative`，記事方塊以 `top = (小時 - startHour + 分鐘/60) × 64px` 落位，固定一小時高，時間重疊者左右平分寬度。

**Tech Stack:** 原生 JavaScript（無框架、無建置流程）、Tailwind CSS CDN、Lucide Icons CDN、localStorage、GitHub Gist 同步。

**Spec:** `docs/superpowers/specs/2026-09-20-calendar-timeline-design.md`

## Global Constraints

- 不改動資料模型：不新增 note 欄位，不改變 localStorage 與 Gist 的資料格式，既有備份檔必須能正常匯入。
- 不改動 `gas-script.js`。
- 不引入任何新的外部套件或 CDN，不引入模組系統（維持全域函式風格）。
- 時間一律以 `parseNoteDateTime()` 解析，內部以 `new Date(str + '+08:00')` 處理無時區字串，與 `gas-script.js` 的 `parseTaipeiTime` 一致。禁止直接用 `new Date(note.datetime)`。
- 所有進入 `innerHTML` 或 HTML 屬性的使用者內容一律先經 `escapeHtml()`。
- 常數：`HOUR_HEIGHT = 64`、`BLOCK_GAP = 4`、`MOBILE_BREAKPOINT = 768`。
- 測試頁 `test-calendar.html` 假設執行環境的時區為 UTC+8（台北）；在其他時區執行時，依賴本地時分的斷言會失敗，這是預期行為。
- 分類固定四種：`重要`、`工作`、`私事`、`已完成`。
- 狀態底色固定五種 preset，行事曆與列表必須來自同一份 `NOTE_STATUS_PRESETS`。
- `index.html` 的 script 載入順序必須是 `notes-core.js` → `script.js` → `calendar.js`。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `notes-core.js` | 建立 | 無 DOM 依賴的純邏輯：`parseNoteDateTime`、`NOTE_STATUS_PRESETS`、`getNoteStatus`、`getStatusBadgeHtml`、`CATEGORY_COLORS`、`getCategoryColor` |
| `calendar.js` | 建立 | 行事曆：純計算（`expandOccurrences`、`getWeekRange`、`getDayRange`、`getVisibleRange`、`computeHourRange`、`layoutDayColumn`）+ 渲染 + 導覽 + 詳情浮層 |
| `test-calendar.html` | 建立 | 瀏覽器測試頁，載入 `notes-core.js` 與 `calendar.js`，跑純函式斷言 |
| `script.js` | 修改 | 既有列表、表單、同步。抽出狀態判斷後改用 `notes-core.js`；新增 `getFilteredNotes`、`renderAll`、篩選狀態變數 |
| `index.html` | 修改 | 新增分頁按鈕、篩選下拉、行事曆區塊、浮層容器；調整 script 載入 |
| `styles.css` | 修改 | 行事曆專用的少量樣式（內容截斷、格線） |

---

## Task 1: 抽出純邏輯到 notes-core.js

**Files:**
- Create: `notes-core.js`
- Create: `test-calendar.html`
- Modify: `index.html`（script 載入）
- Modify: `script.js`（`createNoteCardHtml`、`renderNotes` 的 headerColor）

**Interfaces:**
- Consumes: 無
- Produces:
  - `parseNoteDateTime(str) -> Date | null`
  - `NOTE_STATUS_PRESETS` — 物件，鍵為 `sent | justSent | expired | waiting | pending`
  - `getNoteStatus(note, occurrenceTime?) -> { key, text, iconName, cardClass, badgeClass }`
  - `getStatusBadgeHtml(status) -> string`
  - `getCategoryColor(category) -> { header, bar, chip }`

- [ ] **Step 1: 建立測試頁與失敗的測試**

建立 `test-calendar.html`：

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>行事曆純函式測試</title>
<style>
body { font-family: system-ui, sans-serif; padding: 24px; max-width: 900px; margin: 0 auto; }
h2 { font-size: 16px; margin: 20px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
ul { list-style: none; padding: 0; margin: 0; }
li { font-size: 13px; padding: 2px 0; font-family: ui-monospace, monospace; }
#summary { position: sticky; top: 0; background: #fff; padding: 12px 0; font-size: 18px; font-weight: bold; }
</style>
</head>
<body>
<div id="summary">執行中…</div>
<p style="font-size:13px;color:#64748b;">前提：瀏覽器時區為 UTC+8（台北）。本專案的 <code>datetime</code> 是無時區字串，一律以 +08:00 解析。</p>
<div id="results"></div>

<script src="notes-core.js"></script>
<script src="calendar.js"></script>
<script>
let pass = 0, fail = 0, section = null;

function group(name) {
  const h = document.createElement('h2');
  h.textContent = name;
  document.getElementById('results').appendChild(h);
  section = document.createElement('ul');
  document.getElementById('results').appendChild(section);
}

function assert(name, cond, detail) {
  const li = document.createElement('li');
  li.textContent = (cond ? '✅ ' : '❌ ') + name + (cond ? '' : '  → ' + detail);
  li.style.color = cond ? '#047857' : '#be123c';
  section.appendChild(li);
  cond ? pass++ : fail++;
}

function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  assert(name, a === e, 'expected ' + e + ', got ' + a);
}

function D(str) { return parseNoteDateTime(str); }
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
       + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

group('parseNoteDateTime');
assert('無時區字串以 +08:00 解析', D('2026-09-21T14:30').getTime() === Date.parse('2026-09-21T14:30:00+08:00'), 'timestamp mismatch');
assert('UTC+8 環境下 getHours 為 14', D('2026-09-21T14:30').getHours() === 14, 'got ' + D('2026-09-21T14:30').getHours() + '（執行環境不是 UTC+8）');
assertEq('空字串回傳 null', D(''), null);
assertEq('無效字串回傳 null', D('not-a-date'), null);
assert('已含 Z 的字串直接解析', D('2026-09-21T06:30:00Z').getTime() === Date.parse('2026-09-21T06:30:00Z'), 'mismatch');

group('getCategoryColor');
assertEq('重要', getCategoryColor('重要').header, 'text-rose-600');
assertEq('工作', getCategoryColor('工作').header, 'text-blue-600');
assertEq('私事', getCategoryColor('私事').header, 'text-emerald-600');
assertEq('已完成', getCategoryColor('已完成').header, 'text-purple-600');
assertEq('未知分類退回重要', getCategoryColor('亂寫').header, 'text-rose-600');

group('getNoteStatus');
const future = new Date(Date.now() + 86400000);
const past = new Date(Date.now() - 86400000);
function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
       + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
assertEq('sent=true → sent',
  getNoteStatus({ sent: true, datetime: isoLocal(past) }).key, 'sent');
assertEq('未來時間 → pending',
  getNoteStatus({ sent: false, datetime: isoLocal(future) }).key, 'pending');
assertEq('過期超過 3 分鐘 → expired',
  getNoteStatus({ sent: false, datetime: isoLocal(new Date(Date.now() - 10*60000)) }).key, 'expired');
assertEq('過期 1 分鐘內 → waiting',
  getNoteStatus({ sent: false, datetime: isoLocal(new Date(Date.now() - 60000)) }).key, 'waiting');
assertEq('重複且 lastSentAt 追上 datetime → justSent',
  getNoteStatus({ sent: false, datetime: isoLocal(future), lastSentAt: isoLocal(future),
                  repeat: { type: 'repeat', frequency: 'daily', startDate: isoLocal(past) } }).key, 'justSent');
assertEq('sent 的 cardClass',
  getNoteStatus({ sent: true, datetime: isoLocal(past) }).cardClass, 'bg-emerald-50 border border-emerald-200');
assertEq('expired 的 badgeClass',
  getNoteStatus({ sent: false, datetime: isoLocal(new Date(Date.now() - 10*60000)) }).badgeClass, 'bg-rose-100 text-rose-700');
assertEq('pending 的 cardClass',
  getNoteStatus({ sent: false, datetime: isoLocal(future) }).cardClass, 'bg-amber-50 border border-transparent shadow-sm');

group('getNoteStatus — 行事曆展開的時間點');
const repeatNote = { sent: false, datetime: isoLocal(future),
                     repeat: { type: 'repeat', frequency: 'daily', startDate: isoLocal(past) } };
assertEq('重複記事的過去時間點 → sent',
  getNoteStatus(repeatNote, new Date(Date.now() - 3*86400000)).key, 'sent');
assertEq('重複記事的未來時間點 → pending',
  getNoteStatus(repeatNote, new Date(Date.now() + 3*86400000)).key, 'pending');
assertEq('重複記事的當前 datetime 時間點走完整邏輯',
  getNoteStatus(repeatNote, D(repeatNote.datetime)).key, 'pending');

group('getStatusBadgeHtml');
assertEq('有 icon 的狀態包成 span',
  getStatusBadgeHtml(NOTE_STATUS_PRESETS.sent),
  '<span><i data-lucide="check-circle" class="inline w-3 h-3"></i> 已發送</span>');
assertEq('expired 無 icon，回傳純文字',
  getStatusBadgeHtml(NOTE_STATUS_PRESETS.expired), '過期未發');

const s = document.getElementById('summary');
s.textContent = fail === 0 ? ('✅ 全部通過（' + pass + '）') : ('❌ ' + fail + ' 失敗 / ' + pass + ' 通過');
s.style.color = fail === 0 ? '#047857' : '#be123c';
</script>
</body>
</html>
```

- [ ] **Step 2: 確認測試失敗**

建立空的 `calendar.js`（本任務只需讓測試頁能載入，內容留空一行註解）：

```bash
echo "// 行事曆模組" > calendar.js
```

在瀏覽器開啟 `test-calendar.html`。
預期：頁面頂端顯示紅字失敗，主控台出現 `parseNoteDateTime is not defined`。

- [ ] **Step 3: 建立 notes-core.js**

```javascript
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

    if (isRepeat && occurrenceTime && baseTime && occurrenceTime.getTime() !== baseTime.getTime()) {
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

const CATEGORY_COLORS = {
    '重要':   { header: 'text-rose-600',    bar: '#f43f5e', chip: 'bg-rose-100 text-rose-700' },
    '工作':   { header: 'text-blue-600',    bar: '#3b82f6', chip: 'bg-blue-100 text-blue-700' },
    '私事':   { header: 'text-emerald-600', bar: '#14b8a6', chip: 'bg-teal-100 text-teal-700' },
    '已完成': { header: 'text-purple-600',  bar: '#a855f7', chip: 'bg-purple-100 text-purple-700' }
};

function getCategoryColor(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS['重要'];
}
```

- [ ] **Step 4: 在 index.html 載入新檔案**

把 `index.html` 最後的：

```html
    <script src="script.js?v=20260808"></script>
```

改成：

```html
    <script src="notes-core.js?v=20260920"></script>
    <script src="script.js?v=20260920"></script>
    <script src="calendar.js?v=20260920"></script>
```

- [ ] **Step 5: 重跑測試，確認全部通過**

重新整理 `test-calendar.html`。
預期：頂端顯示綠字「全部通過」，無紅色項目。

- [ ] **Step 6: 讓 createNoteCardHtml 改用共用邏輯**

在 `script.js` 中，把 `createNoteCardHtml` 開頭到「`/* ========= UI 其他顯示 ========= */`」之前的整段（內嵌的 `parseDateTime`、`now`、`isRepeat`、`scheduledTime`、`isExpired`、`repeatJustSent`、`cardStyle`、`statusClass`、`statusText` 與整串 if/else）刪掉，換成：

```javascript
function createNoteCardHtml(note) {
    const isRepeat = note.repeat && note.repeat.type === 'repeat';
    const status = getNoteStatus(note);
    const cardStyle = status.cardClass;
    const statusClass = status.badgeClass;
    const statusText = getStatusBadgeHtml(status);
```

`createNoteCardHtml` 其餘部分（`repeatIcon`、`repeatSummary`、`completionIcon` 與 return 的樣板）完全不動。

- [ ] **Step 7: 讓 renderNotes 的分類標題色改用共用邏輯**

在 `script.js` 的 `renderNotes()` 中，把：

```javascript
                let headerColor = 'text-slate-600';
                if (cat === '重要') headerColor = 'text-rose-600';
                else if (cat === '工作') headerColor = 'text-blue-600';
                else if (cat === '私事') headerColor = 'text-emerald-600';
                else if (cat === '已完成') headerColor = 'text-purple-600';
```

換成：

```javascript
                const headerColor = getCategoryColor(cat).header;
```

- [ ] **Step 8: 目視確認列表外觀與改前完全一致**

在瀏覽器開啟 `index.html`。逐項確認：
- 每張卡片的底色、狀態徽章文字與圖示與改動前相同
- 「過期未發」徽章沒有圖示，其餘四種有圖示
- 四個分類標題的顏色正確（重要紅、工作藍、私事綠、已完成紫）
- 主控台無錯誤

- [ ] **Step 9: Commit**

```bash
git add notes-core.js calendar.js test-calendar.html index.html script.js
git commit -m "refactor: 抽出狀態判斷與分類顏色到 notes-core.js" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 分類與狀態篩選器

**Files:**
- Modify: `index.html`（搜尋列旁新增兩個下拉）
- Modify: `script.js`（`filterCategory`、`filterStatus`、`getFilteredNotes`、`handleFilterChange`、`renderNotes`、`clearSearch`）

**Interfaces:**
- Consumes: `getNoteStatus(note)` from Task 1
- Produces:
  - `getFilteredNotes() -> Array<note>`
  - 全域變數 `filterCategory`（`'' | '重要' | '工作' | '私事' | '已完成'`）
  - 全域變數 `filterStatus`（`'' | 'pending' | 'sent' | 'expired'`）
  - `handleFilterChange()`

- [ ] **Step 1: 在 index.html 加入兩個篩選下拉**

把搜尋框那個 `<div class="relative px-1">…</div>` 整塊，換成：

```html
        <div class="flex flex-col sm:flex-row gap-2 px-1">
            <div class="relative flex-1">
                <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
                <input type="text" id="note-search" placeholder="搜尋記事內容或分類..." oninput="handleSearchInput(this.value)" class="w-full py-2 pl-10 pr-10 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none bg-white text-sm">
                <button type="button" id="search-clear-btn" onclick="clearSearch()" class="hidden absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>
            <select id="filter-category" onchange="handleFilterChange()" class="py-2 px-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none bg-white text-sm">
                <option value="">所有分類</option>
                <option value="重要">重要</option>
                <option value="工作">工作</option>
                <option value="私事">私事</option>
                <option value="已完成">已完成</option>
            </select>
            <select id="filter-status" onchange="handleFilterChange()" class="py-2 px-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none bg-white text-sm">
                <option value="">所有狀態</option>
                <option value="pending">待發送</option>
                <option value="sent">已發送</option>
                <option value="expired">過期未發</option>
            </select>
        </div>
```

- [ ] **Step 2: 在 script.js 新增篩選狀態與 getFilteredNotes**

在 `script.js` 最上方的 `let searchKeyword = '';` 下一行加入：

```javascript
let filterCategory = '';
let filterStatus = '';
```

在 `handleSearchInput` 函式前面加入：

```javascript
// 列表與行事曆共用的篩選結果
function getFilteredNotes() {
    const kw = searchKeyword.toLowerCase();
    return notes.filter(n => {
        if (kw) {
            const hit = (n.content || '').toLowerCase().includes(kw)
                     || (n.category || '').toLowerCase().includes(kw);
            if (!hit) return false;
        }
        if (filterCategory && (n.category || '重要') !== filterCategory) return false;
        if (filterStatus) {
            const key = getNoteStatus(n).key;
            if (filterStatus === 'sent'    && key !== 'sent'    && key !== 'justSent') return false;
            if (filterStatus === 'pending' && key !== 'pending' && key !== 'waiting')  return false;
            if (filterStatus === 'expired' && key !== 'expired') return false;
        }
        return true;
    });
}

function handleFilterChange() {
    filterCategory = document.getElementById('filter-category').value;
    filterStatus = document.getElementById('filter-status').value;
    renderAll();
}
```

- [ ] **Step 3: 新增 renderAll 並讓 renderNotes 改用 getFilteredNotes**

在 `script.js` 的 `renderNotes()` 前面加入：

```javascript
// 列表與行事曆的統一重繪入口
function renderAll() {
    renderNotes();
    if (typeof renderCalendar === 'function') renderCalendar();
}
```

在 `renderNotes()` 中，把：

```javascript
    const visibleNotes = searchKeyword
        ? notes.filter(n => {
            const kw = searchKeyword.toLowerCase();
            return (n.content || '').toLowerCase().includes(kw) || (n.category || '').toLowerCase().includes(kw);
        })
        : notes;
```

換成：

```javascript
    const visibleNotes = getFilteredNotes();
    const hasFilter = !!(searchKeyword || filterCategory || filterStatus);
```

同一函式中，把空狀態的那行：

```javascript
        emptyState.querySelector('p').innerText = searchKeyword ? `找不到符合「${searchKeyword}」的記事` : '目前沒有任何記事，試著新增一筆吧！';
```

換成：

```javascript
        emptyState.querySelector('p').innerText = hasFilter ? '找不到符合目前篩選條件的記事' : '目前沒有任何記事，試著新增一筆吧！';
```

以及把分組的判斷條件：

```javascript
        if (searchKeyword) {
```

換成：

```javascript
        if (hasFilter) {
```

- [ ] **Step 4: 讓所有重繪點改呼叫 renderAll**

在 `script.js` 中，把下列七處的 `renderNotes();` 改成 `renderAll();`：

- `DOMContentLoaded` 事件處理器內
- `syncFromCloud()` 內
- `importData()` 內
- `handleFormSubmit()` 內
- `deleteNote()` 內
- `handleSearchInput()` 內
- `clearSearch()` 內

```bash
grep -n "renderNotes();" script.js
```

確認只剩 `renderAll()` 內部那一處呼叫 `renderNotes();`。

- [ ] **Step 5: 目視測試篩選行為**

開啟 `index.html`，逐項確認：
- 分類選「工作」→ 只剩工作分類的記事，計數正確
- 狀態選「待發送」→ 只剩黃色卡片
- 分類 + 狀態同時選 → 兩個條件都套用（AND）
- 搜尋 + 分類同時用 → 兩個條件都套用
- 任一篩選啟用時，列表改為不分組的平鋪；全部清空時恢復分組
- 全部清空後，記事數量與未篩選前相同

- [ ] **Step 6: Commit**

```bash
git add index.html script.js
git commit -m "feat: 新增分類與狀態篩選器並抽出 getFilteredNotes" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: expandOccurrences — 重複記事展開

**Files:**
- Modify: `calendar.js`
- Modify: `test-calendar.html`

**Interfaces:**
- Consumes: `parseNoteDateTime(str)` from Task 1
- Produces: `expandOccurrences(note, rangeStart, rangeEnd) -> Date[]` — 回傳該筆記事在 `[rangeStart, rangeEnd)` 內、由早到晚排序的所有發生時間點

- [ ] **Step 1: 寫失敗的測試**

在 `test-calendar.html` 的 `group('getStatusBadgeHtml');` 那一整段之後、`const s = document.getElementById('summary');` 之前，插入：

```javascript
group('expandOccurrences');

// 固定一個週一到次週一的區間：2026-09-14(一) ~ 2026-09-21(一)
const W_START = new Date(2026, 8, 14, 0, 0, 0, 0);
const W_END   = new Date(2026, 8, 21, 0, 0, 0, 0);
function expandIso(note) { return expandOccurrences(note, W_START, W_END).map(iso); }

assertEq('單次記事落在區間內',
  expandIso({ datetime: '2026-09-16T14:30' }),
  ['2026-09-16 14:30']);

assertEq('單次記事落在區間外',
  expandIso({ datetime: '2026-09-30T14:30' }), []);

assertEq('無 datetime 回傳空陣列',
  expandIso({ datetime: '' }), []);

assertEq('repeat 但 type 不是 repeat，視為單次',
  expandIso({ datetime: '2026-09-16T14:30', repeat: { type: 'none' } }),
  ['2026-09-16 14:30']);

assertEq('daily 展開整週 7 天，時分一致',
  expandIso({ datetime: '2026-09-14T09:00',
              repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-09-01T09:00', endDate: '' } }),
  ['2026-09-14 09:00','2026-09-15 09:00','2026-09-16 09:00','2026-09-17 09:00',
   '2026-09-18 09:00','2026-09-19 09:00','2026-09-20 09:00']);

assertEq('weekly 選週一三五',
  expandIso({ datetime: '2026-09-14T08:15',
              repeat: { type: 'repeat', frequency: 'weekly', weekDays: [1,3,5], startDate: '2026-09-01T08:15', endDate: '' } }),
  ['2026-09-14 08:15','2026-09-16 08:15','2026-09-18 08:15']);

assertEq('weekly 缺 weekDays 回傳空陣列',
  expandIso({ datetime: '2026-09-14T08:15',
              repeat: { type: 'repeat', frequency: 'weekly', startDate: '2026-09-01T08:15', endDate: '' } }), []);

assertEq('monthly 選 16 日，該週含 16 日',
  expandIso({ datetime: '2026-09-16T20:00',
              repeat: { type: 'repeat', frequency: 'monthly', monthDays: [16], startDate: '2026-09-01T20:00', endDate: '' } }),
  ['2026-09-16 20:00']);

assertEq('monthly 選 1 日，該週不含 1 日',
  expandIso({ datetime: '2026-10-01T20:00',
              repeat: { type: 'repeat', frequency: 'monthly', monthDays: [1], startDate: '2026-09-01T20:00', endDate: '' } }), []);

assertEq('startDate 在週三，週一週二不展開',
  expandIso({ datetime: '2026-09-16T09:00',
              repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-09-16T09:00', endDate: '' } }),
  ['2026-09-16 09:00','2026-09-17 09:00','2026-09-18 09:00','2026-09-19 09:00','2026-09-20 09:00']);

assertEq('endDate 在週三，週四之後不展開',
  expandIso({ datetime: '2026-09-14T09:00',
              repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-09-01T09:00', endDate: '2026-09-16T09:00' } }),
  ['2026-09-14 09:00','2026-09-15 09:00','2026-09-16 09:00']);

assertEq('endDate 不含 T，視為當日 23:59:59，該日仍展開',
  expandIso({ datetime: '2026-09-14T09:00',
              repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-09-01T09:00', endDate: '2026-09-16' } }),
  ['2026-09-14 09:00','2026-09-15 09:00','2026-09-16 09:00']);

assertEq('endDate 為空視為無限期',
  expandIso({ datetime: '2026-09-14T23:30',
              repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-01-01T23:30', endDate: '' } }).length, 7);

assertEq('datetime 無法解析時時分退回 startDate',
  expandIso({ datetime: '', repeat: { type: 'repeat', frequency: 'daily', startDate: '2026-09-15T07:45', endDate: '2026-09-16' } }),
  ['2026-09-15 07:45','2026-09-16 07:45']);

assertEq('startDate 與 endDate 都無效的重複記事回傳空陣列',
  expandIso({ datetime: '2026-09-14T09:00',
              repeat: { type: 'repeat', frequency: 'daily', startDate: 'bad', endDate: 'bad' } }),
  ['2026-09-14 09:00','2026-09-15 09:00','2026-09-16 09:00','2026-09-17 09:00',
   '2026-09-18 09:00','2026-09-19 09:00','2026-09-20 09:00']);

assertEq('結果依時間由早到晚排序',
  expandIso({ datetime: '2026-09-14T09:00',
              repeat: { type: 'repeat', frequency: 'weekly', weekDays: [5,1,3], startDate: '2026-09-01T09:00', endDate: '' } }),
  ['2026-09-14 09:00','2026-09-16 09:00','2026-09-18 09:00']);
```

- [ ] **Step 2: 確認測試失敗**

重新整理 `test-calendar.html`。
預期：`expandOccurrences` 區段全紅，主控台出現 `expandOccurrences is not defined`。

- [ ] **Step 3: 實作 expandOccurrences**

把 `calendar.js` 的內容換成：

```javascript
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
```

- [ ] **Step 4: 確認測試通過**

重新整理 `test-calendar.html`。
預期：頂端顯示綠字「全部通過」。

- [ ] **Step 5: Commit**

```bash
git add calendar.js test-calendar.html
git commit -m "feat: 新增 expandOccurrences 重複記事展開" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 版面計算函式

**Files:**
- Modify: `calendar.js`
- Modify: `test-calendar.html`

**Interfaces:**
- Consumes: `HOUR_HEIGHT`, `BLOCK_GAP` from Task 3
- Produces:
  - `getWeekRange(anchorDate) -> { start: Date, end: Date }`
  - `getDayRange(anchorDate) -> { start: Date, end: Date }`
  - `computeHourRange(occurrences) -> { startHour: number, endHour: number }`
  - `layoutDayColumn(occurrences, startHour) -> Array<{ top, height, leftPct, widthPct }>`（順序與傳入的 `occurrences` 對應）

- [ ] **Step 1: 寫失敗的測試**

在 `test-calendar.html` 的 `expandOccurrences` 測試之後、`const s = document.getElementById('summary');` 之前，插入：

```javascript
group('getWeekRange / getDayRange');
function rangeIso(r) { return [iso(r.start), iso(r.end)]; }

assertEq('傳入週三，回傳該週週一到次週一',
  rangeIso(getWeekRange(new Date(2026, 8, 16, 13, 45))),
  ['2026-09-14 00:00', '2026-09-21 00:00']);

assertEq('傳入週一本身',
  rangeIso(getWeekRange(new Date(2026, 8, 14, 0, 0))),
  ['2026-09-14 00:00', '2026-09-21 00:00']);

assertEq('傳入週日，回傳的是該週週一而非下週一',
  rangeIso(getWeekRange(new Date(2026, 8, 20, 23, 59))),
  ['2026-09-14 00:00', '2026-09-21 00:00']);

assertEq('跨月邊界',
  rangeIso(getWeekRange(new Date(2026, 8, 1, 10, 0))),
  ['2026-08-31 00:00', '2026-09-07 00:00']);

assertEq('跨年邊界',
  rangeIso(getWeekRange(new Date(2027, 0, 1, 10, 0))),
  ['2026-12-28 00:00', '2027-01-04 00:00']);

assertEq('getDayRange 回傳當日到次日',
  rangeIso(getDayRange(new Date(2026, 8, 16, 13, 45))),
  ['2026-09-16 00:00', '2026-09-17 00:00']);

group('computeHourRange');
assertEq('無時間點 → 6 到 24', computeHourRange([]), { startHour: 6, endHour: 24 });
assertEq('最早 08:00 → 起始仍為 6',
  computeHourRange([new Date(2026, 8, 16, 8, 0)]), { startHour: 6, endHour: 24 });
assertEq('最早 03:00 → 起始下修到 3',
  computeHourRange([new Date(2026, 8, 16, 3, 20)]), { startHour: 3, endHour: 24 });
assertEq('最早 00:10 → 起始下修到 0',
  computeHourRange([new Date(2026, 8, 16, 0, 10)]), { startHour: 0, endHour: 24 });
assertEq('同時有 02:00 與 23:30 → 2 到 24',
  computeHourRange([new Date(2026, 8, 16, 23, 30), new Date(2026, 8, 16, 2, 0)]),
  { startHour: 2, endHour: 24 });

group('layoutDayColumn');
function at(h, m) { return new Date(2026, 8, 16, h, m); }

assertEq('單筆 09:00，startHour 6',
  layoutDayColumn([at(9, 0)], 6),
  [{ top: 192, height: 60, leftPct: 0, widthPct: 100 }]);

assertEq('單筆 10:30 落在 10 點下方 32px',
  layoutDayColumn([at(10, 30)], 6)[0].top, 288);

assertEq('10:30 與 10:45 重疊 → 各佔一半',
  layoutDayColumn([at(10, 30), at(10, 45)], 6).map(l => [l.leftPct, l.widthPct]),
  [[0, 50], [50, 50]]);

assertEq('09:00 與 10:00 相鄰但不重疊 → 各佔滿',
  layoutDayColumn([at(9, 0), at(10, 0)], 6).map(l => l.widthPct),
  [100, 100]);

assertEq('三筆互相重疊 → 各佔三分之一',
  layoutDayColumn([at(9, 0), at(9, 20), at(9, 40)], 6).map(l => Math.round(l.widthPct * 100) / 100),
  [33.33, 33.33, 33.33]);

assertEq('09:00、09:30、11:00 → 前兩筆同群，第三筆獨立',
  layoutDayColumn([at(9, 0), at(9, 30), at(11, 0)], 6).map(l => l.widthPct),
  [50, 50, 100]);

assertEq('傳入順序顛倒時，回傳值仍對應原索引',
  layoutDayColumn([at(10, 45), at(10, 30)], 6).map(l => l.leftPct),
  [50, 0]);

assert('23:00 的方塊不超出欄位總高',
  layoutDayColumn([at(23, 0)], 6)[0].top + layoutDayColumn([at(23, 0)], 6)[0].height <= (24 - 6) * 64,
  'overflow');
```

- [ ] **Step 2: 確認測試失敗**

重新整理 `test-calendar.html`。
預期：新增的三個區段全紅，主控台出現 `getWeekRange is not defined`。

- [ ] **Step 3: 實作四個函式**

在 `calendar.js` 的 `expandOccurrences` 之後加入：

```javascript
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
```

- [ ] **Step 4: 確認測試通過**

重新整理 `test-calendar.html`。
預期：頂端顯示綠字「全部通過」。

- [ ] **Step 5: Commit**

```bash
git add calendar.js test-calendar.html
git commit -m "feat: 新增行事曆版面計算函式" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 行事曆骨架 — 網格、時間軸、導覽

**Files:**
- Modify: `index.html`（新增行事曆區塊與浮層容器）
- Modify: `styles.css`（格線與截斷樣式）
- Modify: `calendar.js`（狀態、`getVisibleRange`、`renderCalendar`、導覽）

**Interfaces:**
- Consumes: `getFilteredNotes()` from Task 2；`expandOccurrences`, `getWeekRange`, `getDayRange`, `computeHourRange`, `layoutDayColumn` from Tasks 3–4
- Produces:
  - `getVisibleRange() -> { start: Date, end: Date }`
  - `renderCalendar()`
  - `calendarPrev()` / `calendarNext()` / `calendarToday()` / `setCalendarDays(n)`
  - `closeOccurrencePopover()`
  - `isSameDay(a, b) -> boolean`、`WEEK_LABELS`
  - 模組狀態 `calendarAnchor`、`calendarDays`、`calendarMode`、`openPopoverKey`

本任務先把區塊直接顯示在列表下方（尚未分頁），以便單獨驗證網格。Task 8 才會包進分頁並預設隱藏。

- [ ] **Step 1: 在 index.html 新增行事曆區塊**

在 `<div id="empty-state" …></div>` 那一行之後、`</main>` 之前，插入：

```html
        <div id="calendar-view">
            <div class="flex items-center gap-2 mb-3 flex-wrap">
                <button onclick="calendarToday()" class="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white hover:bg-slate-50">今天</button>
                <button onclick="calendarPrev()" aria-label="上一頁" class="w-8 h-8 flex items-center justify-center border border-slate-200 rounded-lg bg-white hover:bg-slate-50"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                <button onclick="calendarNext()" aria-label="下一頁" class="w-8 h-8 flex items-center justify-center border border-slate-200 rounded-lg bg-white hover:bg-slate-50"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                <span id="calendar-title" class="text-base font-bold text-slate-700 ml-1"></span>
                <span class="flex-1"></span>
                <div id="calendar-days-toggle" class="flex border border-slate-200 rounded-lg overflow-hidden">
                    <button onclick="setCalendarDays(7)" data-days="7" class="cal-days-btn px-3 py-1.5 text-xs">7 天</button>
                    <button onclick="setCalendarDays(5)" data-days="5" class="cal-days-btn px-3 py-1.5 text-xs">工作天</button>
                </div>
            </div>
            <div id="calendar-scroll" class="bg-white rounded-xl border border-slate-200 overflow-auto" style="max-height:70vh">
                <div id="calendar-head" class="grid sticky top-0 z-20 bg-white border-b border-slate-200"></div>
                <div id="calendar-body" class="grid relative"></div>
            </div>
        </div>
```

在 `</main>` 之後、`<!-- 重複設定彈跳視窗 -->` 之前，插入浮層容器：

```html
    <div id="calendar-popover" class="hidden fixed z-40 w-72 bg-white rounded-xl shadow-2xl border border-slate-200"></div>
```

- [ ] **Step 2: 在 styles.css 加入格線與截斷樣式**

在 `styles.css` 末尾加入：

```css
/* 行事曆格線：整點實線、半小時虛線。
   數值必須與 calendar.js 的 HOUR_HEIGHT (64) 保持一致。 */
.cal-col {
    background-image:
        repeating-linear-gradient(to bottom, #e2e8f0 0 1px, transparent 1px 64px),
        repeating-linear-gradient(to bottom, transparent 0 32px, #f1f5f9 32px 33px, transparent 33px 64px);
}

/* 行事曆記事方塊的內容截斷 */
.cal-clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-all;
}
```

- [ ] **Step 3: 在 calendar.js 加入狀態、共用小工具與 getVisibleRange**

在 `calendar.js` 的常數宣告（`MOBILE_BREAKPOINT`）之後、`expandOccurrences` 之前插入：

```javascript
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
```

在 `layoutDayColumn` 之後加入：

```javascript
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
```

- [ ] **Step 4: 為 getVisibleRange 補上測試**

在 `test-calendar.html` 的 `layoutDayColumn` 測試之後、`const s = document.getElementById('summary');` 之前，插入：

```javascript
group('getVisibleRange');
function visibleIso(mode, days, anchor) {
  const savedMode = calendarMode, savedDays = calendarDays, savedAnchor = calendarAnchor;
  calendarMode = mode; calendarDays = days; calendarAnchor = anchor;
  const r = getVisibleRange();
  calendarMode = savedMode; calendarDays = savedDays; calendarAnchor = savedAnchor;
  return [iso(r.start), iso(r.end)];
}

assertEq('7 天模式與 getWeekRange 相同',
  visibleIso('week', 7, new Date(2026, 8, 16)),
  ['2026-09-14 00:00', '2026-09-21 00:00']);

assertEq('工作天模式結束於該週週六 00:00',
  visibleIso('week', 5, new Date(2026, 8, 16)),
  ['2026-09-14 00:00', '2026-09-19 00:00']);

assertEq('單日模式與 getDayRange 相同',
  visibleIso('day', 7, new Date(2026, 8, 16, 13, 45)),
  ['2026-09-16 00:00', '2026-09-17 00:00']);

assert('工作天模式下週六 10:00 的記事不落在區間內',
  expandOccurrences({ datetime: '2026-09-19T10:00' },
                    new Date(2026, 8, 14), new Date(2026, 8, 19)).length === 0,
  '週六記事不該被算入工作天區間');
```

重新整理 `test-calendar.html`，預期 `getVisibleRange` 區段全部通過。

- [ ] **Step 5: 實作 renderCalendar**

在 `calendar.js` 末尾加入：

```javascript
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
        body += `<div class="absolute right-1.5 text-[11px] text-slate-400" style="top:${(h - hours.startHour) * HOUR_HEIGHT - 7}px">${String(h).padStart(2, '0')}:00</div>`;
    }
    body += '</div>';

    // 每日欄
    days.forEach(d => {
        const isToday = isSameDay(d.date, today);
        body += `<div class="cal-col relative border-l border-slate-100 ${isToday ? 'bg-teal-50/40' : ''}" style="height:${colHeight}px"></div>`;
    });

    if (allOcc.length === 0) {
        body += '<div class="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 text-sm">這段期間沒有符合條件的記事</div>';
    }

    const bodyEl = document.getElementById('calendar-body');
    bodyEl.style.gridTemplateColumns = template;
    bodyEl.innerHTML = body;

    lucide.createIcons();
}

function closeOccurrencePopover() {
    const pop = document.getElementById('calendar-popover');
    if (pop) pop.classList.add('hidden');
    openPopoverKey = null;
}
```

- [ ] **Step 6: 實作導覽與初始化**

在 `calendar.js` 末尾加入：

```javascript
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
    renderCalendar();
});
```

- [ ] **Step 7: 目視驗證網格**

在桌面寬度（≥ 768px）開啟 `index.html`，逐項確認：
- 列表下方出現行事曆，標題顯示本週日期範圍（例如「2026 年 9 月 14 – 20 日」）
- 有 8 欄：52px 的時間軸欄 + 週一到週日共 7 欄
- 時間軸從 `06:00` 排到 `23:00`，標籤靠右、跨在整點格線上
- 每小時一條實線、中間一條較淡的半小時線
- 今天那一欄的標題有淡青底、數字與星期是青色，欄位本身也有淡青底
- 區塊內容超過 70vh 時可捲動，捲動時日期標題列固定在頂端
- 目前沒有記事方塊（下一個任務才畫），中央顯示「這段期間沒有符合條件的記事」
- 點「下一頁」→ 日期前進一週；點「上一頁」→ 後退一週；點「今天」→ 回到本週
- 點「工作天」→ 只剩週一到週五 5 欄，按鈕變青底白字；重新整理頁面後仍維持工作天
- 點「7 天」→ 恢復 7 欄
- 主控台無錯誤

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css calendar.js
git commit -m "feat: 新增行事曆週視圖骨架與週導覽" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 記事方塊

**Files:**
- Modify: `calendar.js`（`createOccurrenceHtml`，並在 `renderCalendar` 中渲染方塊）

**Interfaces:**
- Consumes: `getNoteStatus`, `getCategoryColor` from Task 1；`layoutDayColumn` from Task 4；既有的 `escapeHtml`, `startEdit`, `deleteNote`
- Produces: `createOccurrenceHtml(note, occurrenceTime, layout) -> string`

- [ ] **Step 1: 實作 createOccurrenceHtml**

在 `calendar.js` 的 `renderCalendar` 之前加入：

```javascript
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
```

- [ ] **Step 2: 在 renderCalendar 中渲染方塊**

在 `renderCalendar()` 的「每日欄」迴圈中，把：

```javascript
    days.forEach(d => {
        const isToday = isSameDay(d.date, today);
        body += `<div class="cal-col relative border-l border-slate-100 ${isToday ? 'bg-teal-50/40' : ''}" style="height:${colHeight}px"></div>`;
    });
```

換成：

```javascript
    days.forEach(d => {
        const isToday = isSameDay(d.date, today);
        const layout = layoutDayColumn(d.entries.map(e => e.time), hours.startHour);
        let blocks = '';
        d.entries.forEach((e, i) => { blocks += createOccurrenceHtml(e.note, e.time, layout[i]); });
        body += `<div class="cal-col relative border-l border-slate-100 ${isToday ? 'bg-teal-50/40' : ''}" style="height:${colHeight}px">${blocks}</div>`;
    });
```

- [ ] **Step 3: 暫時讓 openOccurrencePopover 可被呼叫**

浮層在 Task 7 才實作。先在 `calendar.js` 的 `closeOccurrencePopover` 之前加入暫時版本，避免點擊方塊時拋錯：

```javascript
// Task 7 會以真正的浮層取代這個版本
function openOccurrencePopover(noteId, occurrenceMs, anchorEl) {
    console.log('popover placeholder', noteId, new Date(occurrenceMs));
}
```

- [ ] **Step 4: 準備測試資料並目視驗證**

在 `index.html` 的表單中建立以下記事（或直接用現有資料），確保本週涵蓋：
1. 一筆未來時間的單次記事，分類「工作」→ 預期黃底、藍色左條
2. 一筆已過期超過 3 分鐘且 `sent` 為 false 的記事 → 預期紅底
3. 一筆每天重複的記事（開始日期設在上週）→ 預期本週每天都有一個方塊，過去幾天是綠底、未來幾天是黃底，每個方塊右下角有重複圖示
4. 兩筆時間相距 15 分鐘的記事（例如 10:30 與 10:45）→ 預期左右各佔一半寬度
5. 一筆內容很長（超過 60 字）的記事 → 預期顯示兩行後截斷，滑鼠停留時瀏覽器原生 tooltip 顯示全文

逐項確認：
- 方塊垂直位置正確：10:30 的方塊上緣在 10:00 線下方約半格處
- 方塊高度為一小時
- 底色與列表中同一筆記事的卡片底色相同
- 左側 3px 色條顏色對應分類（重要紅、工作藍、私事青、已完成紫）
- 第二行顯示「HH:MM · 分類」
- 滑鼠移入方塊時右上角浮出編輯與刪除按鈕
- 點編輯 → 捲到表單並帶入該筆記事內容；點刪除 → 跳出確認，確認後方塊與列表卡片同時消失
- 點方塊本體 → 主控台印出 `popover placeholder`，且不會同時觸發編輯或刪除
- 主控台無錯誤

- [ ] **Step 5: Commit**

```bash
git add calendar.js
git commit -m "feat: 行事曆記事方塊，含狀態底色、分類色條與重疊分欄" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 詳情浮層

**Files:**
- Modify: `calendar.js`（`openOccurrencePopover` 正式版、`bindCalendarGlobalEvents`）

**Interfaces:**
- Consumes: `getNoteStatus`, `getStatusBadgeHtml`, `getCategoryColor` from Task 1；既有的 `escapeHtml`, `formatDateTime`, `getRepeatSummaryHtml`, `startEdit`, `deleteNote`, 全域 `notes`
- Produces: `openOccurrencePopover(noteId, occurrenceMs, anchorEl)`、`bindCalendarGlobalEvents()`

- [ ] **Step 1: 以正式版取代 Task 6 的暫時 openOccurrencePopover**

把 `calendar.js` 中 Task 6 留下的：

```javascript
// Task 7 會以真正的浮層取代這個版本
function openOccurrencePopover(noteId, occurrenceMs, anchorEl) {
    console.log('popover placeholder', noteId, new Date(occurrenceMs));
}
```

整段換成：

```javascript
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
```

- [ ] **Step 2: 加入關閉浮層的全域事件**

在 `calendar.js` 的 `closeOccurrencePopover` 之後加入：

```javascript
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

    // 浮層是 fixed 定位，容器捲動後位置會失準，直接關閉
    window.addEventListener('scroll', closeOccurrencePopover, true);
}
```

在 `calendar.js` 的 `DOMContentLoaded` 處理器中，`updateDaysToggleUI();` 之後加入一行：

```javascript
    bindCalendarGlobalEvents();
```

- [ ] **Step 3: 目視驗證浮層**

開啟 `index.html`，在行事曆中逐項確認：
- 點任一方塊 → 浮層出現在方塊右側，顯示狀態徽章、完整內容、完整日期時間、分類標籤
- 內容很長的記事 → 浮層中完整顯示，超過 240px 高時浮層內部可捲動，不會撐破視窗
- 重複記事 → 浮層底部顯示重複規則摘要（與列表卡片底部的文字相同）
- 方塊靠近視窗右緣時 → 浮層翻到方塊左側；靠近底部時 → 浮層往上收，不會被截掉
- 再點同一個方塊 → 浮層關閉
- 點另一個方塊 → 浮層換到新位置，只有一個浮層存在
- 點浮層外的空白處 → 關閉
- 按 Esc → 關閉
- 點浮層右上角 × → 關閉
- 捲動行事曆內容 → 浮層關閉
- 浮層中的「編輯」→ 浮層關閉且表單帶入該筆記事
- 浮層中的「刪除」→ 浮層關閉，確認後記事消失，行事曆重繪
- 方塊右上角的編輯／刪除小按鈕仍可單獨使用，且不會連帶開啟浮層
- 主控台無錯誤

- [ ] **Step 4: Commit**

```bash
git add calendar.js
git commit -m "feat: 行事曆記事詳情浮層" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 分頁切換

**Files:**
- Modify: `index.html`（分頁按鈕、`#list-view` 外層、`#calendar-view` 預設隱藏）
- Modify: `calendar.js`（`switchView`、`viewTabClass`、初始化）
- Modify: `script.js`（`scrollToCategory` 在行事曆模式改為篩選）

**Interfaces:**
- Consumes: `renderCalendar()`, `closeOccurrencePopover()` from Tasks 5 & 7
- Produces: `switchView(view)` — `view` 為 `'list' | 'calendar'`；`viewTabClass(active) -> string`

- [ ] **Step 1: 在 index.html 加入分頁按鈕**

在列表區塊標題那一行的 `<h2 …>記事列表 …</h2>` 之後，插入：

```html
            <div class="flex border border-slate-200 rounded-lg overflow-hidden self-start">
                <button id="tab-list" onclick="switchView('list')" class="px-4 py-1.5 text-sm">列表</button>
                <button id="tab-calendar" onclick="switchView('calendar')" class="px-4 py-1.5 text-sm">行事曆</button>
            </div>
```

- [ ] **Step 2: 把列表內容包進 #list-view**

把：

```html
<div id="notes-container" class="space-y-8"></div>
<div id="empty-state" class="hidden text-center py-12 bg-white rounded-xl border-2 border-dashed border-slate-200 text-slate-400"><p>目前沒有任何記事，試著新增一筆吧！</p></div>
```

換成：

```html
        <div id="list-view">
            <div id="notes-container" class="space-y-8"></div>
            <div id="empty-state" class="hidden text-center py-12 bg-white rounded-xl border-2 border-dashed border-slate-200 text-slate-400"><p>目前沒有任何記事，試著新增一筆吧！</p></div>
        </div>
```

並把 Task 5 加入的 `<div id="calendar-view">` 改成預設隱藏：

```html
        <div id="calendar-view" class="hidden">
```

- [ ] **Step 3: 實作 switchView**

在 `calendar.js` 的 `updateDaysToggleUI` 之後加入：

```javascript
function viewTabClass(active) {
    return 'px-4 py-1.5 text-sm transition-colors '
         + (active ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50');
}

function switchView(view) {
    const isCal = (view === 'calendar');
    document.getElementById('list-view').classList.toggle('hidden', isCal);
    document.getElementById('calendar-view').classList.toggle('hidden', !isCal);
    document.getElementById('tab-list').className = viewTabClass(!isCal);
    document.getElementById('tab-calendar').className = viewTabClass(isCal);
    localStorage.setItem('calendarView', view);
    closeOccurrencePopover();
    if (isCal) renderCalendar();
}
```

把 `calendar.js` 的 `DOMContentLoaded` 處理器中的 `renderCalendar();` 那一行換成：

```javascript
    switchView(localStorage.getItem('calendarView') === 'calendar' ? 'calendar' : 'list');
```

- [ ] **Step 4: 讓分類按鈕在行事曆模式改為篩選**

在 `script.js` 的 `scrollToCategory` 函式最前面插入：

```javascript
function scrollToCategory(categoryName) {
    const calView = document.getElementById('calendar-view');
    if (calView && !calView.classList.contains('hidden')) {
        // 行事曆模式：按鈕改為切換分類篩選（再按一次取消）
        filterCategory = (filterCategory === categoryName) ? '' : categoryName;
        document.getElementById('filter-category').value = filterCategory;
        renderAll();
        return;
    }
```

其餘既有內容（`const targetId = …` 之後）完全不動。

- [ ] **Step 5: 目視驗證分頁**

開啟 `index.html`，逐項確認：
- 預設顯示列表，「列表」分頁是青底白字
- 點「行事曆」→ 列表消失、行事曆出現，分頁樣式對調
- 重新整理頁面 → 停留在行事曆分頁
- 點「列表」→ 回到列表，重新整理後停留在列表
- 在行事曆分頁按「工作」分類按鈕 → 分類下拉變成「工作」，行事曆只剩工作分類的方塊；再按一次「工作」→ 取消篩選
- 在列表分頁按「工作」分類按鈕 → 維持原本的捲動跳轉行為，不會套用篩選
- 搜尋框輸入關鍵字 → 行事曆與列表的結果一致
- 在行事曆分頁新增一筆記事 → 方塊立刻出現，切回列表也看得到
- 主控台無錯誤

- [ ] **Step 6: Commit**

```bash
git add index.html calendar.js script.js
git commit -m "feat: 列表與行事曆分頁切換" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 手機單日視圖

**Files:**
- Modify: `calendar.js`（`renderCalendar` 中隱藏天數切換、視窗寬度變化時重繪）

**Interfaces:**
- Consumes: `calendarMode`, `getVisibleRange()`, `renderCalendar()` from Task 5
- Produces: 無新公開函式

`renderCalendar()` 已經依視窗寬度設定 `calendarMode`，`getVisibleRange()` 與 `formatCalendarTitle()` 也已處理單日情形，本任務只補上 UI 細節與寬度變化的重繪。

- [ ] **Step 1: 單日模式隱藏天數切換**

在 `renderCalendar()` 中，緊接在：

```javascript
    calendarMode = (window.innerWidth < MOBILE_BREAKPOINT) ? 'day' : 'week';
```

之後加入：

```javascript
    document.getElementById('calendar-days-toggle').classList.toggle('hidden', calendarMode === 'day');
```

- [ ] **Step 2: 視窗寬度跨越門檻時重繪**

在 `calendar.js` 的 `bindCalendarGlobalEvents()` 末尾加入：

```javascript
    let lastIsMobile = window.innerWidth < MOBILE_BREAKPOINT;
    window.addEventListener('resize', () => {
        const nowMobile = window.innerWidth < MOBILE_BREAKPOINT;
        if (nowMobile === lastIsMobile) return;
        lastIsMobile = nowMobile;
        renderCalendar();
    });
```

- [ ] **Step 3: 目視驗證單日視圖**

在瀏覽器開發者工具中把視窗寬度調到 375px（或用裝置模擬），逐項確認：
- 行事曆只剩兩欄：時間軸欄 + 一天
- 標題顯示「2026 年 9 月 16 日（週三）」格式
- 「7 天 / 工作天」切換按鈕隱藏
- 點「下一頁」→ 前進一天；點「上一頁」→ 後退一天；點「今天」→ 回到今天
- 記事方塊佔滿整欄寬度，同時段重疊時仍左右平分
- 點方塊可開浮層，浮層不會超出畫面左右兩側
- 方塊右上角的編輯／刪除按鈕在觸控模式下恆常顯示
- 把寬度拉回 1200px → 自動變回 7 欄週視圖，且天數切換按鈕重新出現
- 再縮回 375px → 變回單日
- 主控台無錯誤

- [ ] **Step 4: Commit**

```bash
git add calendar.js
git commit -m "feat: 行事曆手機單日視圖" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: 整體驗證與文件

**Files:**
- Modify: `README.md`（補上新檔案與行事曆說明）

**Interfaces:**
- Consumes: 前九個任務的全部產出
- Produces: 無

- [ ] **Step 1: 重跑純函式測試**

在瀏覽器開啟 `test-calendar.html`。
預期：頂端綠字「全部通過」，無任何紅色項目。若有失敗，先修到全綠再往下走。

- [ ] **Step 2: 資料相容性驗證**

- 用「備份與還原」匯出一份備份檔
- 清空瀏覽器的 localStorage
- 重新整理頁面，匯入剛才的備份檔
- 確認列表與行事曆都正確顯示，記事筆數與匯出前相同
- 確認匯出的 JSON 中沒有任何新增的欄位（與改動前的備份檔結構相同）

- [ ] **Step 3: 端對端驗收**

對照需求逐項確認：
- 行事曆橫軸為星期一到星期日，縱軸為 24 小時制時間
- 新增一筆記事後，同時出現在列表與行事曆
- 行事曆中的方塊顯示內容、分類色（左側色條）、狀態（底色）
- 重複記事在行事曆中展開為多個方塊，且每個方塊右下角有重複圖示
- 行事曆可以用搜尋、分類、狀態篩選，結果與列表一致
- 行事曆方塊的底色與列表卡片依發送狀態顯示相同顏色
- 滑鼠移入方塊會顯示編輯與刪除圖示，點選後走既有的編輯與刪除邏輯
- 內容很長的記事可透過點擊方塊開啟的浮層看到全文

- [ ] **Step 4: 更新 README**

在 `README.md` 的檔案結構說明中，補上三個新檔案與行事曆功能。在「功能」相關段落加入：

```markdown
### 行事曆檢視

記事列表上方可切換「列表 / 行事曆」。行事曆以週視圖呈現，橫軸為星期一到星期日（可切換為工作天），
縱軸為 24 小時制時間軸，預設顯示 06:00 至 24:00，當週若有更早的記事會自動往上擴展。

- 重複記事會依重複規則展開為當週所有符合的時間點
- 方塊底色代表發送狀態，左側色條代表分類，右下角圖示代表重複
- 時間重疊的記事在該日欄內左右平分寬度
- 點擊方塊可開啟詳情浮層看完整內容，並可直接編輯或刪除
- 螢幕寬度小於 768px 時自動切換為單日視圖

### 檔案結構

- `index.html` — 頁面結構
- `styles.css` — 自訂樣式
- `notes-core.js` — 無 DOM 依賴的純邏輯（時間解析、狀態判定、分類顏色）
- `script.js` — 記事列表、表單、雲端同步
- `calendar.js` — 行事曆的計算與渲染
- `test-calendar.html` — 純函式測試頁，用瀏覽器直接開啟即可執行
- `gas-script.js` — Google Apps Script 端的發送邏輯
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: 補上行事曆檢視說明與檔案結構" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
