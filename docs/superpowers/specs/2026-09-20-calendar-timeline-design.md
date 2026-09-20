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
| 時間軸範圍 | 預設 06:00–23:00；當週若有記事落在此範圍外，自動擴展到包含它 |
| 已過去的重複次數 | 時間早於現在即視為「已發送」（綠色） |
| 同格多筆 | 格子內垂直堆疊，格子高度自動撐開 |
| 手機（< 768px） | 自動切換為單日視圖 |

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

- `expandOccurrences(note, rangeStart, rangeEnd)` — 純函式。回傳 `Date[]`，為該筆記事在 `[rangeStart, rangeEnd)` 區間內的所有發生時間點。
- `getWeekRange(anchorDate)` — 純函式。回傳該日期所屬週的週一 00:00 與次週一 00:00。
- `computeHourRange(occurrences)` — 純函式。回傳 `{startHour, endHour}`，預設 `{6, 24}`，若有時間點小於 6 時則下修、大於等於 23 時則上修至包含。
- `renderCalendar()` — 渲染整個行事曆區塊。
- `createOccurrenceHtml(note, occurrenceTime)` — 產生單一記事方塊。
- `calendarPrev()` / `calendarNext()` / `calendarToday()` — 週（或手機上為日）導覽。
- `switchView(view)` — 切換列表／行事曆分頁，狀態寫入 localStorage `calendarView`。
- 模組內狀態：`calendarAnchor`（`Date`，目前顯示的週所包含的任一日）、`calendarMode`（`'week' | 'day'`，由視窗寬度決定）。

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
[ ◀ ] 2026/09/21 – 09/27  [ 本週 ] [ ▶ ]
┌──────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐
│      │ 一21│ 二22│ 三23│ 四24│ 五25│ 六26│ 日27│  ← sticky top
├──────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
│ 06:00│     │     │     │     │     │     │     │
│ 07:00│     │ ▮記事│     │     │     │     │     │
└──────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘
      ↑ sticky left
```

- CSS Grid：`grid-template-columns: 56px repeat(7, minmax(0, 1fr))`。
- 外層固定高度 `max-height: 70vh`，`overflow: auto`。
- 日期標題列 `position: sticky; top: 0`；時間軸欄 `position: sticky; left: 0`。兩者需設 `z-index`，左上角交會的空白格 z-index 最高。
- 今天該欄加 `bg-teal-50/40` 淡色底。
- 每個小時格最小高度 56px，內容多時自動撐高（同一小時的整列一起變高，此為 CSS Grid 的自然行為）。
- 空狀態：該週無任何記事時，網格中央疊一行提示文字。

### 記事方塊

```
┌─────────────────────┐
│▌14:30  [✎][🗑]      │  ← hover 時才出現右上角按鈕
│▌開會討論專案進度      │
│▌                 ↻  │  ← 重複記事才有
└─────────────────────┘
```

- 底色／邊框：`getNoteStatus().cardClass`
- 左側 3px 直條：分類色
- 第一行：時間 `HH:MM`（小字）
- 內容：最多兩行，`overflow: hidden` + `text-overflow: ellipsis`，`title` 屬性放完整內容
- 右下角重複圖示：`refresh-cw`，僅重複記事顯示
- Hover 時右上角浮出編輯（amber）／刪除（rose）兩顆小按鈕，`onclick` 呼叫既有的 `startEdit(note.id)` 與 `deleteNote(note.id)`。觸控裝置上按鈕恆常顯示（沿用列表既有的 `opacity-100 sm:opacity-0 group-hover:opacity-100` 手法）。

### 手機單日視圖

視窗寬度 `< 768px` 時 `calendarMode = 'day'`：

- 網格改為 `grid-template-columns: 56px 1fr`，只渲染一天。
- 導覽列改為「◀ 09/22 (一) ▶」加「今天」。
- 其餘邏輯（展開、狀態、方塊、篩選）完全共用，不另寫一套。
- 監聽 `resize` 事件，跨越 768px 門檻時重新渲染。

## 渲染時機

- 頁面載入 `DOMContentLoaded`
- 新增／編輯記事送出後
- 刪除記事後
- 匯入備份後
- 從雲端同步後
- 搜尋關鍵字、分類篩選、狀態篩選變動時
- 週／日導覽時（僅重繪行事曆）
- 視窗寬度跨越 768px 門檻時

統一由 `renderAll()` 負責前六項。

## 錯誤處理

- `datetime` 或 `repeat.startDate` 解析失敗（`isNaN(date.getTime())`）→ 該筆記事在行事曆中跳過，不拋例外、不中斷其他記事渲染。
- `weekDays` / `monthDays` 缺失或為空陣列 → 該重複記事展開為空，不顯示。
- `expandOccurrences` 的逐日走訪以區間長度為上限（一週最多 7 圈、單日 1 圈），不會有無限迴圈風險。
- 內容一律經 `escapeHtml()` 後才放進 innerHTML，`title` 屬性同樣需跳脫。

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

**`getWeekRange`**
- 傳入週三 → 回傳該週週一 00:00 與次週一 00:00
- 傳入週日 → 回傳的是該週週一（而非下週一），即週日為一週的最後一天
- 跨月、跨年邊界

**`computeHourRange`**
- 無時間點 → `{6, 24}`
- 最早 08:00 → `{6, 24}`
- 最早 03:00 → `{3, 24}`
- 最晚 23:30 → `endHour` 為 24
- 同時有 02:00 與 23:30 → `{2, 24}`

**`getNoteStatus`**
- 五種狀態各一例，且回傳的 class 字串與現行 `createNoteCardHtml()` 產生的完全相同（此為階段一「行為不變」的保證）

UI 部分以瀏覽器實際開啟確認：週導覽、sticky 標題、hover 按鈕、分頁切換、手機寬度單日視圖。

## 實作階段

1. 抽出 `getNoteStatus()`、`getFilteredNotes()`、`parseNoteDateTime()`、`getCategoryColor()`，列表改用它們 — 行為不變
2. 篩選器升級（分類 + 狀態下拉），列表生效
3. `expandOccurrences()`、`getWeekRange()`、`computeHourRange()` 與 `test-calendar.html`
4. 行事曆週視圖骨架：網格、時間軸、週導覽、sticky
5. 記事方塊：狀態底色、分類色條、重複圖示、hover 編輯刪除
6. 分頁切換 + `renderAll()` 串接
7. 手機單日視圖
8. 整體驗證

## 不做的事（YAGNI）

- 不做拖曳改時間
- 不做月視圖
- 不在行事曆中直接新增記事（點空白格不開表單）
- 不改動 `gas-script.js`
- 不改動資料模型（不新增欄位、不動同步格式），因此不影響既有備份檔與 Gist 資料
