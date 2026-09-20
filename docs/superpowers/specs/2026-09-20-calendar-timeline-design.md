# 行事曆時間軸檢視 — 設計文件

日期：2026-09-20
狀態：待實作

## 目標

在現有的 LINE 提醒記事本中，除了既有的卡片式記事列表外，新增一個「行事曆」檢視：橫軸為星期一到星期日，縱軸為 24 小時制時間。記事依其提醒時間顯示在對應的格子中，並保留與列表完全一致的狀態顏色、分類顏色、重複標示、編輯與刪除操作。

## 現況

三個檔案，無建置流程、無框架、無測試框架：

- `index.html` — Tailwind CDN + Lucide CDN，全部 UI 結構
- `script.js` — 約 690 行，全域函式 + 全域 `notes` 陣列，資料存 localStorage 並同步至 GitHub Gist
- `styles.css` — 少量自訂樣式
- `gas-script.js` — Google Apps Script 端，負責實際發送 LINE 訊息並推進重複記事的 `datetime`

### 資料模型

```js
{
  id: "1699...",              // Date.now().toString()
  createdAt: "2026-01-01T...",
  updatedAt: "2026-01-01T...",
  category: "重要" | "工作" | "私事" | "已完成",
  content: "文字內容",
  datetime: "2026-09-21T14:30",  // datetime-local 格式，無時區；重複記事由 GAS 推進為「下一次」發送時間
  sent: false,
  completionStatus: "" | "completed" | "incomplete",
  lastSentAt: "2026-09-20T...",   // 選填，由 GAS 寫入
  repeat: null | {
    type: "repeat",
    frequency: "daily" | "weekly" | "monthly",
    startDate: "2026-09-01T14:30",  // datetime-local 格式
    endDate: "" | "2026-12-31T23:59",
    weekDays: [1,3,5],              // frequency==="weekly" 時存在，0=日 … 6=六
    monthDays: [1,15]               // frequency==="monthly" 時存在，1–31
  }
}
```

### 時區

`datetime` 是無時區的 `datetime-local` 字串。既有的 `createNoteCardHtml()` 內以 `new Date(str + '+08:00')` 解析，與 `gas-script.js` 的 `parseTaipeiTime` 一致。行事曆必須沿用同一套解析，不可改用 `new Date(str)`。

### 既有狀態判斷（要抽出共用）

目前埋在 `createNoteCardHtml()` 中，依序判斷：

1. `note.sent === true` → 已發送，`bg-emerald-50 border-emerald-200`，徽章 `bg-emerald-100 text-emerald-700`
2. 重複記事且 `lastSentAt >= datetime` 且未過期 → 剛發送，同上綠色
3. 已過排程時間且超過 3 分鐘 → 過期未發，`bg-rose-50 border-rose-200`，徽章 `bg-rose-100 text-rose-700`
4. 已過排程時間但在 3 分鐘內 → 等待發送，`bg-amber-50`，徽章 `bg-blue-100 text-blue-700`
5. 其餘 → 待發送，`bg-amber-50`，徽章 `bg-amber-100 text-amber-700`

### 分類顏色（既有）

重要 rose、工作 blue、私事 teal/emerald、已完成 purple。

## 需求決策

以下為與使用者確認後的決定：

| 議題 | 決定 |
|---|---|
| 重複記事呈現 | 依重複規則展開成當週所有符合的時間點，每個時間點各畫一個方塊 |
| 版面關係 | 「列表 / 行事曆」分頁切換，一次只顯示一種 |
| 搜尋與篩選 | 兩個檢視共用同一組：搜尋框 + 分類篩選 + 狀態篩選 |
| 無 `datetime` 的記事 | 行事曆不顯示 |
| 時間軸範圍 | 預設顯示 06:00 至 24:00（06、07 … 23 共 18 小時）；當週若有記事早於 06:00，起始時間自動下修到包含它 |
| 時間標籤格式 | 24 小時制（`09:00`、`13:00`） |
| 已過去的重複次數 | 時間早於現在即視為「已發送」（綠色） |
| 顯示天數 | 預設週一到週日 7 天，提供「工作天」切換為週一到週五 |
| 版面型態 | 絕對定位時間軸（同 Google 日曆），非格子堆疊 |
| 方塊高度 | 固定一小時高（資料無結束時間，不新增欄位） |
| 重疊處理 | 時間重疊的記事在該日欄內左右平分寬度 |
| 長內容 | 方塊內截斷，點擊方塊開啟詳情浮層顯示完整內容 |
| 手機（< 768px） | 自動切換為單日視圖，沿用同一套絕對定位邏輯 |

## 架構

新增 `calendar.js`，在 `index.html` 中於 `script.js` 之後載入。行事曆的渲染、週導覽狀態、重複展開都在此檔案；`script.js` 只做必要的抽出與串接。

理由：`script.js` 已近 700 行，行事曆約需 300 行，混在一起會使兩套渲染邏輯難以分辨。兩個檔案透過全域 `notes` 與少數共用函式溝通，符合此專案既有的全域函式風格，不引入模組系統。

### 模組職責

#### `script.js`（修改）

- `getNoteStatus(note, occurrenceTime)` — 新增。把上述狀態判斷抽成純函式。`occurrenceTime` 為選填的 `Date`，供行事曆傳入展開後的某一次時間點；省略時使用 `note.datetime`。回傳：
  ```js
  { key: 'sent'|'justSent'|'expired'|'waiting'|'pending',
    text: '已發送', iconName: 'check-circle',
    cardClass: 'bg-emerald-50 border border-emerald-200',
    badgeClass: 'bg-emerald-100 text-emerald-700' }
  ```
  `createNoteCardHtml()` 改用它，行為必須與現況逐字相同。
- `getFilteredNotes()` — 新增。回傳套用「搜尋關鍵字 + 分類篩選 + 狀態篩選」後的記事陣列。`renderNotes()` 改用它。
- `parseNoteDateTime(str)` — 新增。把既有的內嵌 `parseDateTime` 提升為全域函式，`calendar.js` 共用。
- `getCategoryColor(category)` — 新增。回傳該分類的 Tailwind 色碼相關字串，供列表標題與行事曆色條共用。
- `filterCategory` / `filterStatus` — 新增全域狀態變數，與既有的 `searchKeyword` 並列。
- `renderAll()` — 新增。呼叫 `renderNotes()` 與 `renderCalendar()`。所有原本呼叫 `renderNotes()` 的地方（`handleFormSubmit`、`deleteNote`、`importData`、`syncFromCloud`、`handleSearchInput`、`clearSearch`、`DOMContentLoaded`）改呼叫 `renderAll()`。
- `scrollToCategory()` — 行為調整：行事曆模式下改為設定 `filterCategory` 並重新渲染；列表模式下維持既有跳轉行為。

#### `calendar.js`（新增）

純計算（可單獨測試）：

- `expandOccurrences(note, rangeStart, rangeEnd)` — 回傳 `Date[]`，該筆記事在 `[rangeStart, rangeEnd)` 內的所有發生時間點。
- `getWeekRange(anchorDate)` — 回傳該日期所屬週的週一 00:00 與次週一 00:00。
- `getDayRange(anchorDate)` — 回傳該日 00:00 與次日 00:00，供手機單日視圖使用。
- `getVisibleRange()` — 依 `calendarMode` 與 `calendarDays` 回傳實際顯示的區間：單日模式用 `getDayRange()`；7 天模式用 `getWeekRange()`；工作天模式取 `getWeekRange()` 的週一 00:00 到週六 00:00。展開、`computeHourRange()` 與渲染一律以此區間為準，週六日的記事在工作天模式下不會被算入時間範圍。
- `computeHourRange(occurrences)` — 回傳 `{startHour, endHour}`。
- `layoutDayColumn(occurrences, startHour)` — 回傳每個時間點的版面座標 `{top, height, leftPct, widthPct}`，含重疊分欄計算。

渲染：

- `renderCalendar()` — 渲染整個行事曆區塊。
- `createOccurrenceHtml(note, occurrenceTime, layout)` — 產生單一記事方塊。
- `openOccurrencePopover(noteId, occurrenceIso, anchorEl)` / `closeOccurrencePopover()` — 詳情浮層。

導覽與狀態：

- `calendarPrev()` / `calendarNext()` / `calendarToday()` — 週（或手機上為日）導覽。
- `setCalendarDays(n)` — 切換 7 天 / 5 天（工作天），寫入 localStorage `calendarDays`。
- `switchView(view)` — 切換列表／行事曆分頁，寫入 localStorage `calendarView`。
- 模組內狀態：`calendarAnchor`（`Date`，目前顯示的週所含的任一日）、`calendarDays`（`7 | 5`）、`calendarMode`（`'week' | 'day'`，由視窗寬度決定）、`openPopoverKey`（目前開啟的浮層，`null` 表示未開啟）。

常數：`HOUR_HEIGHT = 64`（每小時像素高）、`BLOCK_GAP = 4`（方塊間隙）、`MOBILE_BREAKPOINT = 768`。

### 重複展開規則

`expandOccurrences(note, rangeStart, rangeEnd)`：

1. 若 `note.datetime` 為空 → 回傳 `[]`。
2. 若 `note.repeat` 為空或 `type !== 'repeat'` → 解析 `note.datetime`，落在區間內回傳單元素陣列，否則回傳 `[]`。
3. 重複記事：
   - 時分取自 `note.datetime`（GAS 推進時保留時分）；若 `note.datetime` 無法解析則退而取自 `repeat.startDate`。
   - 有效區間 = `[max(rangeStart, repeat.startDate), min(rangeEnd, repeat.endDate))`。`endDate` 若不含 `T` 則視為當日 23:59:59（與 `gas-script.js` 一致）；`endDate` 為空視為無限期。
   - 逐日走訪有效區間，依 `frequency` 判斷該日是否符合：
     - `daily` — 全部符合
     - `weekly` — `weekDays` 包含該日 `getDay()`
     - `monthly` — `monthDays` 包含該日 `getDate()`
   - 符合的日期組出帶時分的 `Date` 推入結果。
4. 結果依時間排序後回傳。

注意：`monthly` 若選了 31 日，在只有 30 天的月份自然不會有符合日，不做進位處理（與 GAS 行為不完全相同，但行事曆僅為顯示，以不虛構不存在的日期為準）。

### 狀態顏色

行事曆方塊的底色一律來自 `getNoteStatus(note, occurrenceTime)`，與列表卡片同源。對展開出來的重複次數，`occurrenceTime` 早於現在即落入「已發送」分支（綠色），晚於現在則為「待發送」（黃色）。

## 版面

### 分頁與篩選列

記事列表區塊上方新增：

```
[ 記事列表 (N) ]                    [ 列表 | 行事曆 ]
[ 重要 ][ 工作 ][ 私事 ][ 已完成 ]
[ 🔍 搜尋...            ] [ 分類 ▾ ] [ 狀態 ▾ ]
```

- 分頁按鈕：兩顆，選中者 teal 底白字，未選中者白底灰字。
- 分類下拉：全部／重要／工作／私事／已完成。
- 狀態下拉：全部／待發送／已發送／過期未發。（「剛發送」與「等待發送」為極短暫的中間狀態，分別併入「已發送」與「待發送」篩選。）
- 篩選為 AND 關係，套用於兩個檢視。

### 行事曆區塊

```
[今天] [◀] [▶]  2026 年 9 月 14 – 20 日            [ 7 天 | 工作天 ]
┌────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│    │  14  │  15  │  16  │  17  │  18  │  19  │  20  │  ← sticky top
│    │ 週一 │ 週二 │ 週三 │ 週四 │ 週五 │ 週六 │ 週日 │
├────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│09:00                                                 │
│    │      │      │      │ ▮TBC │      │      │      │
│10:00 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│    │ ▮廠商│      │▮交件│▮回診│      │      │      │
│11:00                                                 │
└────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
  ↑ sticky left
```

採絕對定位的時間軸版面，不是格子堆疊。

**外框**：`max-height: 70vh`、`overflow: auto`。日期標題列 `position: sticky; top: 0`，時間軸欄 `position: sticky; left: 0`，左上角交會的空白格 z-index 最高。

**欄位**：`grid-template-columns: 52px repeat(N, minmax(0, 1fr))`，`N` 為 7 或 5（工作天）或 1（手機單日）。

**每日欄**：`position: relative`，高度 `(endHour - startHour) × HOUR_HEIGHT`。格線用單一個 `repeating-linear-gradient` 畫出整點實線與半小時虛線，不產生額外 DOM 節點。今天該欄加淡色底 `bg-teal-50/40`，標題的日期數字與星期改用 teal 色。

**時間軸欄**：同樣 `position: relative`，每個整點一個絕對定位的標籤，`top = (h - startHour) × HOUR_HEIGHT - 7`，靠右對齊，使標籤跨在格線上（同範例圖）。格式為 24 小時制 `09:00`。

**方塊定位**：
- `top = (小時 - startHour + 分鐘 / 60) × HOUR_HEIGHT`
- `height = HOUR_HEIGHT - BLOCK_GAP`（固定一小時高）
- 起點在 23:00 的方塊剛好延伸到 24:00，不會溢出。

**重疊分欄**（`layoutDayColumn`）：
1. 每個時間點視為佔用區間 `[t, t + 60 分鐘)`。
2. 依開始時間排序，掃描式分群：與目前群組中任一區間有交集者併入同群，否則另起新群。
3. 群內 `n` 筆，第 `i` 筆（0-based）的 `leftPct = i / n × 100`、`widthPct = 1 / n × 100`。

**導覽列**：`[今天]`、`[◀]`、`[▶]`、當前日期範圍標題、右側「7 天 / 工作天」分段按鈕。

**空狀態**：該週（或該日）無任何記事時，在網格上疊一行置中提示文字，格線仍照常顯示。

### 記事方塊

```
┌─────────────────────┐
│▌            [✎][🗑]│  ← hover 時才出現
│▌廠商介紹公共系統…    │
│▌10:00 · 工作     ↻ │  ← ↻ 僅重複記事
└─────────────────────┘
```

- 底色／邊框：`getNoteStatus(note, occurrenceTime).cardClass`，與列表卡片同源
- 左側 3px 直條：分類色（重要 rose／工作 blue／私事 teal／已完成 purple）
- 內容：`overflow: hidden`，`-webkit-line-clamp: 2`，`title` 屬性放完整內容（需跳脫）
- 第二行小字：`HH:MM · 分類`
- 右下角 `refresh-cw` 圖示：僅重複記事顯示
- Hover 時右上角浮出編輯（amber）／刪除（rose）小按鈕，`onclick` 呼叫既有的 `startEdit(id)` 與 `deleteNote(id)`，並 `event.stopPropagation()` 以免同時觸發詳情浮層。觸控裝置上恆常顯示（沿用列表既有的 `opacity-100 sm:opacity-0 group-hover:opacity-100` 手法）
- 整個方塊可點擊，開啟詳情浮層

### 詳情浮層

解決長內容在方塊中被截斷的問題。

- 觸發：點擊記事方塊本體
- 定位：貼齊方塊右側；右側空間不足則翻到左側；垂直方向夾在視窗範圍內避免溢出。寬度約 280px
- 內容：
  - 狀態徽章（沿用 `getNoteStatus().badgeClass` 與 `text`）
  - 完整內容，`white-space: pre-wrap`、`word-break: break-all`；超過約 240px 高時浮層內部捲動
  - 完整日期時間（`formatDateTime()`）
  - 分類標籤（分類色）
  - 重複規則摘要（重複記事才有，直接呼叫既有的 `getRepeatSummaryHtml(note.repeat)`）
  - 編輯／刪除兩顆按鈕，呼叫既有的 `startEdit(id)` / `deleteNote(id)`；編輯會捲動到表單，因此按下後先關閉浮層
- 關閉：點浮層外、按 Esc、點右上角 ×
- 同時只允許開啟一個浮層
- 行事曆重新渲染（篩選、導覽、資料變動）時一律關閉浮層

### 手機單日視圖

視窗寬度 `< 768px` 時 `calendarMode = 'day'`：

- `grid-template-columns: 52px 1fr`，只渲染一天，區間由 `getDayRange()` 決定
- 導覽列改為「[今天] [◀] 09/16 (三) [▶]」，隱藏 7 天／工作天切換
- 展開、版面計算、方塊、浮層、篩選邏輯完全共用，不另寫一套
- 監聽 `resize`，跨越 768px 門檻時重新渲染

## 渲染時機

- 頁面載入 `DOMContentLoaded`
- 新增／編輯記事送出後
- 刪除記事後
- 匯入備份後
- 從雲端同步後
- 搜尋關鍵字、分類篩選、狀態篩選變動時
- 週／日導覽時（僅重繪行事曆）
- 視窗寬度跨越 768px 門檻時
- 切換 7 天 / 工作天時（僅重繪行事曆）

任何一次行事曆重繪都必須先關閉詳情浮層。

統一由 `renderAll()` 負責前六項。

## 錯誤處理

- `datetime` 或 `repeat.startDate` 解析失敗（`isNaN(date.getTime())`）→ 該筆記事在行事曆中跳過，不拋例外、不中斷其他記事渲染。
- `weekDays` / `monthDays` 缺失或為空陣列 → 該重複記事展開為空，不顯示。
- `expandOccurrences` 的逐日走訪以區間長度為上限（一週最多 7 圈、單日 1 圈），不會有無限迴圈風險。
- 內容一律經 `escapeHtml()` 後才放進 innerHTML，`title` 屬性同樣需跳脫。
- 詳情浮層開啟後，若該筆記事被刪除或篩選掉，重繪時浮層一併關閉，不會留下指向不存在記事的浮層。

## 測試

專案無測試框架。新增 `test-calendar.html`，以瀏覽器開啟即執行，頁面顯示每個斷言的通過／失敗。涵蓋純函式：

**`expandOccurrences`**
- 單次記事落在區間內 → 1 個時間點
- 單次記事落在區間外 → 0 個
- 無 `datetime` → 0 個
- `daily` 整週 → 7 個，時分皆等於 `datetime` 的時分
- `weekly` 選週一三五 → 3 個，且落在正確的日期
- `monthly` 選 15 日，該週含 15 日 → 1 個；不含 → 0 個
- `startDate` 在本週三 → 週一、週二不展開
- `endDate` 在本週三 → 週四之後不展開
- `endDate` 不含 `T` → 視為當日 23:59:59，該日仍展開
- `endDate` 為空 → 不限制
- 時區：`"2026-09-21T14:30"` 解析後 `getHours()` 在 UTC+8 環境下為 14

**`getWeekRange` / `getDayRange`**
- 傳入週三 → 回傳該週週一 00:00 與次週一 00:00
- 傳入週日 → 回傳的是該週週一（而非下週一），即週日為一週的最後一天
- 跨月、跨年邊界
- `getDayRange` 傳入任一時刻 → 回傳當日 00:00 與次日 00:00

**`getVisibleRange`**
- 7 天模式 → 與 `getWeekRange` 相同
- 工作天模式 → 結束時間為該週週六 00:00，週六 10:00 的記事不落在區間內
- 單日模式 → 與 `getDayRange` 相同

**`computeHourRange`**
- 無時間點 → `{6, 24}`
- 最早 08:00 → `{6, 24}`（不因為沒有 06、07 的記事就上修起始時間）
- 最早 03:00 → `{3, 24}`
- 最早 00:10 → `{0, 24}`
- 同時有 02:00 與 23:30 → `{2, 24}`

**`layoutDayColumn`**
- 單筆 09:00 → `top = (9 - startHour) × 64`、`height = 60`、`leftPct = 0`、`widthPct = 100`
- 單筆 10:30 → `top` 為 10 點位置再加 32
- 兩筆 10:30 與 10:45（區間交集）→ 各佔 50% 寬，`leftPct` 分別為 0 與 50
- 兩筆 09:00 與 10:00（區間相鄰但不交集）→ 各佔 100% 寬
- 三筆互相重疊 → 各佔 33.33% 寬
- 09:00、09:30、11:00 → 前兩筆同群各 50%，第三筆獨立 100%
- 起點 23:00、`endHour = 24` → `top + height` 不超過欄位總高

**`getNoteStatus`**
- 五種狀態各一例，且回傳的 class 字串與現行 `createNoteCardHtml()` 產生的完全相同（此為階段一「行為不變」的保證）

UI 部分以瀏覽器實際開啟確認：週導覽、sticky 標題、hover 按鈕、分頁切換、手機寬度單日視圖。

## 實作階段

1. 抽出 `getNoteStatus()`、`getFilteredNotes()`、`parseNoteDateTime()`、`getCategoryColor()`，列表改用它們 — 行為不變
2. 篩選器升級（分類 + 狀態下拉），列表生效
3. 純計算函式 `expandOccurrences()`、`getWeekRange()`、`computeHourRange()`、`layoutDayColumn()` 與 `test-calendar.html`
4. 行事曆骨架：外框、sticky 日期標題列、時間軸欄、格線、週導覽、7 天／工作天切換
5. 記事方塊：絕對定位、狀態底色、分類色條、重複圖示、內容截斷、hover 編輯刪除
6. 詳情浮層
7. 分頁切換 + `renderAll()` 串接
8. 手機單日視圖
9. 整體驗證

## 不做的事（YAGNI）

- 不做拖曳改時間
- 不做月視圖
- 不在行事曆中直接新增記事（點空白格不開表單）
- 不改動 `gas-script.js`
- 不改動資料模型（不新增欄位、不動同步格式），因此不影響既有備份檔與 Gist 資料
