# LINE 提醒記事本 - Pipedream 雲端版設定指南

## 📋 目錄

1. [前置準備](#前置準備)
2. [步驟一：創建 GitHub Personal Access Token](#步驟一創建-github-personal-access-token)
3. [步驟二：創建 Pipedream 帳號](#步驟二創建-pipedream-帳號)
4. [步驟三：創建 Pipedream Workflow](#步驟三創建-pipedream-workflow)
5. [步驟四：設定網頁應用](#步驟四設定網頁應用)
6. [步驟五：測試驗證](#步驟五測試驗證)
7. [常見問題](#常見問題)

---

## 前置準備

### 🔑 您需要準備：

- [x] GitHub 帳號（免費）
- [x] LINE Messaging API 設定（User ID 和 Channel Access Token）
- [x] Pipedream 帳號（免費）

---

## 步驟一：創建 GitHub Personal Access Token

### 1.1 登入 GitHub

前往 [GitHub](https://github.com) 並登入您的帳號。

### 1.2 創建 Token

1. 點擊右上角頭像 → **Settings**
2. 左側選單找到 **Developer settings**
3. 點擊 **Personal access tokens** → **Tokens (classic)**
4. 點擊 **Generate new token** → **Generate new token (classic)**

### 1.3 設定 Token 權限

- **Note**: 填寫 `LINE Reminder App`
- **Expiration**: 選擇 `No expiration`（永不過期）或自訂時間
- **Select scopes**: ✅ **只勾選 `gist`**

### 1.4 生成並保存 Token

1. 點擊頁面最下方的 **Generate token**
2. **立即複製** Token（格式如：`ghp_xxxxxxxxxxxxxxxxxxxx`）
3. ⚠️ **重要**：Token 只會顯示一次，請妥善保存

---

## 步驟二：創建 Pipedream 帳號

### 2.1 註冊帳號

1. 前往 [Pipedream](https://pipedream.com)
2. 點擊 **Sign Up** 註冊帳號
3. 可使用 Google/GitHub 快速登入

### 2.2 了解免費方案限制

- ✅ 每月 **10,000 次執行**
- ✅ 無限 workflows
- ✅ 無限資料儲存

**執行頻率建議：**

- 每 3 分鐘：`10,000 / (20×24×30) ≈ 約 21 天`
- 每 5 分鐘：`10,000 / (12×24×30) ≈ 整月可用` ✅ **推薦**

---

## 步驟三：創建 Pipedream Workflow

### 3.1 創建新 Workflow

1. 登入 Pipedream 後，點擊 **New Workflow**
2. 選擇 **Start from scratch**

### 3.2 設定觸發器 (Trigger)

1. 點擊第一個步驟 **Select a Trigger**
2. 搜尋並選擇 **Schedule (Cron)**
3. 設定執行頻率：
   - **推薦**：`*/5 * * * *`（每 5 分鐘）
   - 或：`*/3 * * * *`（每 3 分鐘）
4. 點擊 **Create Source**

### 3.3 新增程式碼步驟

1. 點擊下方的 **+** 按鈕
2. 選擇 **Run Node.js code**
3. 將 `pipedream-workflow.js` 的完整程式碼貼到編輯器中

### 3.4 設定環境變數

1. 在 workflow 頁面上方找到 **Settings** 齒輪圖示
2. 點擊 **Environment Variables**
3. 新增以下兩個變數：

| 變數名稱       | 值                  | 說明                          |
| -------------- | ------------------- | ----------------------------- |
| `GITHUB_TOKEN` | `ghp_xxxxxxxxxx...` | 您在步驟一創建的 GitHub Token |
| `GIST_ID`      | 暫時留空            | 稍後由網頁自動創建後填入      |

4. 點擊 **Save**

### 3.5 部署 Workflow

1. 點擊右上角 **Deploy**
2. Workflow 將開始按照設定的頻率自動執行

---

## 步驟四：設定網頁應用

### 4.1 開啟網頁

1. 用瀏覽器開啟 `LineNotify_cloud.html`
2. 會看到提示需要完成雲端設定

### 4.2 配置設定

1. 點擊右上角 **⚙️ 設定** 按鈕
2. 填寫以下資訊：

#### LINE API 設定

- **LINE User ID**: 您的 LINE User ID（格式：`Uxxxxxxxxx...`）
- **Channel Access Token**: 您的 LINE Channel Access Token

#### GitHub 雲端同步設定

- **GitHub Personal Access Token**: 貼上步驟一創建的 Token
- **Gist ID**: **首次使用請留空**（系統會自動創建）

3. 點擊 **儲存設定**

### 4.3 首次同步

1. 儲存設定後，系統會自動創建 Gist
2. 畫面會顯示創建的 Gist ID（例如：`abc123def456...`）
3. **複製這個 Gist ID**

### 4.4 回到 Pipedream 補充 Gist ID

1. 回到 Pipedream workflow
2. 進入 **Settings** → **Environment Variables**
3. 將剛才複製的 Gist ID 填入 `GIST_ID` 欄位
4. 點擊 **Save**
5. 點擊 **Deploy** 重新部署

---

## 步驟五：測試驗證

### 5.1 建立測試記事

1. 在網頁中新增一筆記事
2. 設定提醒時間為 **5-10 分鐘後**
3. 點擊 **儲存記事**

### 5.2 確認同步

1. 點擊右上角的 🔄 按鈕，確認同步成功
2. 應該看到「已同步到雲端」的提示

### 5.3 等待 Pipedream 執行

1. 前往 Pipedream workflow 頁面
2. 查看 **Event History** 區域
3. 等待下一次執行（最多 5 分鐘）
4. 查看執行日誌，應該會看到：
   ```
   📥 正在讀取 Gist 資料...
   ✅ 成功讀取資料，共 X 筆記事
   ⏰ 當前時間: ...
   ```

### 5.4 驗證通知發送

1. 當設定的提醒時間到達後
2. Pipedream 會在下一次執行時檢測到
3. 您應該會收到 LINE 通知
4. 網頁中該記事會標記為「已發送」

---

## 常見問題

### Q1: 為什麼我沒有收到通知？

**檢查清單：**

- [ ] 確認 LINE User ID 和 Channel Access Token 設定正確
- [ ] 確認 Pipedream 的環境變數已正確設定
- [ ] 查看 Pipedream Event History 是否有錯誤訊息
- [ ] 確認提醒時間已經過了至少一個執行週期（5 分鐘）
- [ ] 檢查 Gist 中的資料是否正確同步

### Q2: Gist ID 要去哪裡找？

**方法一**：從網頁設定中複製

- 開啟網頁 → 設定 → GitHub 設定區域會顯示

**方法二**：從 GitHub 查看

1. 前往 [GitHub Gists](https://gist.github.com/)
2. 找到名稱為 "LINE Reminder App Data" 的 Gist
3. 查看 URL，最後一段就是 Gist ID（例如：`https://gist.github.com/username/abc123...`）

### Q3: 可以調整檢查頻率嗎？

可以！在 Pipedream workflow 的觸發器設定中修改 Cron 表達式：

| 頻率       | Cron 表達式    | 每月可用 |
| ---------- | -------------- | -------- |
| 每 3 分鐘  | `*/3 * * * *`  | 約 21 天 |
| 每 5 分鐘  | `*/5 * * * *`  | 整月 ✅  |
| 每 10 分鐘 | `*/10 * * * *` | 整月     |
| 每 15 分鐘 | `*/15 * * * *` | 整月     |

### Q4: 如何跨裝置使用？

1. 在新裝置開啟 `LineNotify_cloud.html`
2. 進入設定，填入：
   - 相同的 GitHub Token
   - 相同的 Gist ID
3. 點擊同步，資料就會載入

### Q5: 資料會不會遺失？

- ✅ 資料儲存在 GitHub Gist（雲端）
- ✅ 瀏覽器也有本地備份（`localStorage`）
- ✅ 可以隨時匯出備份檔（JSON）

### Q6: Pipedream 免費額度用完怎麼辦？

**選項一**：降低檢查頻率

- 改為每 10-15 分鐘檢查一次

**選項二**：升級 Pipedream 付費方案

- 每月 $19 起

**選項三**：改用其他方案

- GitHub Actions（完全免費，但設定較複雜）
- Render/Railway 等後端服務

### Q7: 可以在手機上使用嗎？

可以！

1. 將 `LineNotify_cloud.html` 部署到免費託管服務：
   - GitHub Pages
   - Netlify
   - Vercel
2. 用手機瀏覽器開啟網址
3. 輸入相同的設定即可同步使用

---

## 🎉 完成！

恭喜您完成設定！現在您的 LINE 提醒記事本已經可以：

✅ 不需要保持瀏覽器開啟
✅ 24/7 自動檢查提醒
✅ 自動發送 LINE 通知
✅ 跨裝置同步資料
✅ 完全免費

如有任何問題，請檢查上方的常見問題或查看 Pipedream 執行日誌。
