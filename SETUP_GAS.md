# Google Apps Script (GAS) 雲端版詳細設定指南

本指南將引導您完成 **後端自動化** 的架設。完成後，您的 LINE 提醒記事本將具備 **24 小時自動發送通知** 的能力，不再依賴電腦開機。

## 步驟 1：準備 GitHub Token 與 Gist ID

如果您已經在前端網頁 (v22) 完成了雲端設定並成功同步，您應該已經有了這兩樣東西。如果還沒有，請先依照以下步驟取得：

### GitHub Token

1. 前往 **GitHub Settings** > **Developer settings** > **Personal access tokens (Classic)**
2. **Note** 填寫：`LINE Reminder GAS`
3. **重要**：勾選 `gist` (Create gists) 權限。
4. 點擊 **Generate token** 並複製起來 (以 `ghp_` 開頭)。

### Gist ID

這是您資料庫的「地址」。

- 如果您已經用前端網頁按過「同步」，可以在網頁設定中看到 Gist ID。
- 或者前往 gist.github.com，點擊您的 `line-reminder-data.json`，網址最後一串亂碼即為 ID。

## 步驟 2：建立 Google Apps Script 專案

1. 前往 Google Apps Script。
2. 點擊左上角的 **「新專案」**。
3. 將預設的 `myFunction` 程式碼全部刪除。
4. 將 `gas-script.js` 的內容完整複製貼上到編輯器中。
5. 按下 `Ctrl + S` (或磁片圖示) 儲存，專案名稱可命名為 `LINENotify_Github`。

## 步驟 3：設定環境變數 (Script Properties)

為了安全起見，我們不將密碼直接寫在程式碼裡，而是設定在環境變數中。

1. 在 GAS 編輯器左側選單，點擊 **「專案設定」** (齒輪圖示 ⚙️)。
2. 捲動到最下方找到 **「指令碼屬性」** (Script Properties)。
3. 點擊 **「編輯指令碼屬性」** -> **「新增指令碼屬性」**，依序新增以下三項：

| 屬性 (Property) | 值 (Value) | 說明 |
|----------------|------------|------|
| `GIST_FILENAME` | `gist名稱.json` | 您的 Gist 的 JSON 檔名稱  |
| `GITHUB_TOKEN` | `ghp_xxxx...` | 您的 GitHub Personal Access Token |
| `GIST_ID` | `abc123...` | 您的 Gist ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | `EyJ...` | 您的 LINE Channel Access Token (長字串) |
| `LINE_USER_ID` | `U...` | 您的 LINE UserID (長字串) |

4. 點擊 **「儲存指令碼屬性」**。

## 步驟 4：測試執行

在設定自動化之前，我們先手動執行一次確保沒問題。

1. 回到 **「編輯器」** (程式碼圖示 `<>`)。
2. 確保上方工具列的函式選單選擇的是 `main`。
3. 點擊 **「執行」** 按鈕。
4. **授權權限**：
   - 首次執行會跳出「需要授權」視窗 -> 點擊「審查權限」。
   - 選擇您的 Google 帳號。
   - 出現「Google 未驗證此應用程式」警示 -> 點擊左下角「進階」-> 點擊「前往... (不安全)」。
   - 點擊「允許」。
5. 查看下方 **「執行記錄」**：
   - 如果顯示 `檢查 x 則記事...` 且無錯誤，表示連線成功！
   - 如果您有設定一個「幾分鐘前」的測試提醒，此時您的手機應該會收到 LINE 通知。

## 步驟 5：設定自動化觸發器 (Triggers)

這是最後一步，讓程式自動在背景跑。

1. 在 GAS 左側選單，點擊 **「觸發條件」** (鬧鐘圖示 ⏰)。
2. 點擊右下角的 **「新增觸發條件」** 按鈕。
3. 設定如下：
   - **執行的函式**：`main`
   - **部署作業**：`上端`
   - **事件來源**：`時間驅動` (Time-driven)
   - **時間型觸發條件**：`分鐘計時器` (Minutes timer)
   - **間隔**：`每 5 分鐘` (或是每 10 分鐘，視您的需求與額度而定)
4. 點擊 **「儲存」**。

## 🎉 完成！

恭喜！現在您的 LINE 提醒記事本已經是 **「雲端全自動版」** 了。

- **操作方式**：在電腦或手機瀏覽器開啟 `LineNotify_cloud.html`，新增或修改記事。
- **同步**：網頁會自動將資料同步到 GitHub Gist。
- **通知**：Google Apps Script 會每 5 分鐘去 Gist 檢查一次，時間到了就發送 LINE 給您。

電腦關機，通知依然準時送達！