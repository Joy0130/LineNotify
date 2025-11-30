// Pipedream Workflow: LINE Reminder Notification Service
// 此程式碼應貼到 Pipedream 的 workflow 中執行

export default defineComponent({
  async run({ steps, $ }) {
    
    // ========== 時間區段檢查 (已停用 - 全天候執行) ==========
    
    const now = new Date();
    // 手動計算台北時間（UTC+8）
    const taipeiTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const currentHour = taipeiTime.getUTCHours();
    const currentMinute = taipeiTime.getUTCMinutes();
    
    // 已改為全天候執行，不限制時間
    //if (currentHour < 6 || currentHour >= 21) {  // 06:00 - 21:00
    // 如需恢復時間限制，請取消下方註解並設定時段
    /*
    if (currentHour < 8 || currentHour >= 18) {
      console.log(`⏸️ 非监控时段 (台北时间 ${currentHour}:${String(currentMinute).padStart(2, '0')})`);
      console.log(`ℹ️ 监控时段：每天 08:00 - 18:00`);
      return { 
        skipped: true, 
        reason: "非监控时段",
        taipeiTime: formatTaipeiTime(taipeiTime)
      };
    }
    */
    
    console.log(`✅ 開始檢查提醒 (台北時間 ${currentHour}:${String(currentMinute).padStart(2, '0')})`);
    
    // ========== 設定區 ==========
    // 請在 Pipedream 中設定以下環境變數：
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // GitHub Personal Access Token
    const GIST_ID = process.env.GIST_ID; // GitHub Gist ID

    if (!GITHUB_TOKEN || !GIST_ID) {
      console.error("❌ 請設定環境變數: GITHUB_TOKEN 和 GIST_ID");
      return { error: "缺少必要設定" };
    }

    // ========== 1. 讀取 GitHub Gist 資料 ==========
    console.log("📥 正在讀取 Gist 資料...");
    console.log(`ℹ️ Gist ID: ${GIST_ID}`);
    console.log(`ℹ️ Token 前綴: ${GITHUB_TOKEN.substring(0, 7)}...`);

    let gistResponse;
    try {
      gistResponse = await fetch(
        `https://api.github.com/gists/${GIST_ID}`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Pipedream-Workflow"
          },
        }
      );
    } catch (fetchError) {
      console.error("❌ Fetch 錯誤:", fetchError.message);
      console.error("可能原因: 1) GitHub Token 無效 2) Gist ID 錯誤 3) 網路問題");
      return { 
        error: "無法連接到 GitHub API", 
        details: fetchError.message,
        gistId: GIST_ID
      };
    }

    if (!gistResponse.ok) {
      const errorText = await gistResponse.text();
      console.error("❌ GitHub API 錯誤:", gistResponse.status);
      console.error("錯誤詳情:", errorText);
      return { 
        error: "讀取 Gist 失敗", 
        status: gistResponse.status,
        details: errorText
      };
    }

    const gistData = await gistResponse.json();
    const fileContent = gistData.files["line-reminder-data.json"].content;
    const data = JSON.parse(fileContent);

    console.log(`✅ 成功讀取資料，共 ${data.notes.length} 筆記事`);

    // ========== 2. 檢查需要發送的提醒 ==========
    let notes = data.notes;
    let hasChanges = false;
    let sentCount = 0;
    let errorCount = 0;

    console.log(`⏰ 當前 UTC 時間: ${now.toISOString()}`);
    console.log(`⏰ 當前台北時間: ${formatTaipeiTime(taipeiTime)}`);

    // 檢查每一筆記事
    const pendingNotes = notes.filter((note) => {
      if (!note.datetime || note.sent) return false;
      
      // datetime 格式: "2025-11-30T15:37" (台北時間，無時區資訊)
      // 需要將其視為台北時間並轉換為 UTC 進行比較
      const noteDateTime = new Date(note.datetime);
      
      // 如果 datetime 字串無時區資訊，JavaScript 會視為本地時間
      // 但 Pipedream 執行在 UTC 環境，所以需要調整
      // 手動加上台北時區偏移（+8小時）
      const taipeiOffset = 8 * 60 * 60 * 1000; // 8小時的毫秒數
      const noteTimeUTC = noteDateTime.getTime() - taipeiOffset;
      const noteTimeAdjusted = new Date(noteTimeUTC);
      
      const isExpired = now >= noteTimeAdjusted;
      
      console.log(`� 記事: ${note.content}`);
      console.log(`   設定時間: ${note.datetime}`);
      console.log(`   調整後UTC: ${noteTimeAdjusted.toISOString()}`);
      console.log(`   是否到期: ${isExpired}`);
      console.log(`   已發送: ${note.sent}`);
      
      return isExpired && !note.sent;
    });

    console.log(`📬 待發送記事: ${pendingNotes.length} 筆`);

    // ========== 3. 發送 LINE 通知 ==========
    if (
      pendingNotes.length > 0 &&
      data.config.userId &&
      data.config.channelToken
    ) {
      for (const note of pendingNotes) {
        try {
          const timeDiff = (now - new Date(note.datetime)) / 60000; // 分鐘差
          const prefix = timeDiff > 5 ? "【補發通知】" : "【提醒】";
          const messageText = `${prefix}${note.content}\n時間：${formatDateTime(
            note.datetime
          )}\n分類：${note.category || "未分類"}`;

          console.log(`📤 發送通知給記事: ${note.id}`);

          const lineResponse = await fetch(
            "https://api.line.me/v2/bot/message/push",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${data.config.channelToken}`,
              },
              body: JSON.stringify({
                to: data.config.userId,
                messages: [
                  {
                    type: "text",
                    text: messageText,
                  },
                ],
              }),
            }
          );

          if (lineResponse.ok) {
            console.log(`✅ 成功發送: ${note.id}`);
            sentCount++;

            // 更新記事狀態
            const noteIndex = notes.findIndex((n) => n.id === note.id);
            if (noteIndex !== -1) {
              // 檢查是否有重複設定
              if (note.repeat) {
                const nextReminder = calculateNextReminder(note);
                if (nextReminder) {
                  notes[noteIndex].datetime = nextReminder;
                  notes[noteIndex].sent = false;
                  console.log(`🔄 重複提醒，下次時間: ${nextReminder}`);
                } else {
                  notes[noteIndex].sent = true;
                  console.log(`✔️ 重複結束，標記為已發送`);
                }
              } else {
                notes[noteIndex].sent = true;
              }
              hasChanges = true;
            }
          } else {
            console.error(`❌ 發送失敗: ${note.id}`, lineResponse.status);
            errorCount++;
          }

          // 避免 LINE API rate limit，每次發送後暫停
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`❌ 發送錯誤: ${note.id}`, error.message);
          errorCount++;
        }
      }
    } else if (pendingNotes.length > 0) {
      console.log("⚠️ 有待發送記事，但缺少 LINE 設定");
    }

    // ========== 4. 更新 Gist 狀態 ==========
    if (hasChanges) {
      console.log("💾 正在更新 Gist...");

      data.notes = notes;
      data.lastChecked = now.toISOString();

      const updateResponse = await fetch(
        `https://api.github.com/gists/${GIST_ID}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            files: {
              "line-reminder-data.json": {
                content: JSON.stringify(data, null, 2),
              },
            },
          }),
        }
      );

      if (updateResponse.ok) {
        console.log("✅ Gist 更新成功");
      } else {
        console.error("❌ Gist 更新失敗:", updateResponse.status);
      }
    } else {
      console.log("ℹ️ 無需更新 Gist");
    }

    // ========== 執行結果 ==========
    const result = {
      timestamp: now.toISOString(),
      taipeiTime: formatTaipeiTime(taipeiTime),
      totalNotes: notes.length,
      pendingNotes: pendingNotes.length,
      sentCount: sentCount,
      errorCount: errorCount,
      hasChanges: hasChanges,
    };

    console.log("📊 執行結果:", JSON.stringify(result, null, 2));
    return result;
  },
});

// ========== 輔助函數 ==========

function formatTaipeiTime(taipeiTime) {
  // taipeiTime 已經是 UTC+8 的時間物件，使用 UTC 方法讀取即可
  const year = taipeiTime.getUTCFullYear();
  const month = String(taipeiTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipeiTime.getUTCDate()).padStart(2, "0");
  const hours = String(taipeiTime.getUTCHours()).padStart(2, "0");
  const minutes = String(taipeiTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(taipeiTime.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} (台北時間)`;
}

function formatDateTime(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function calculateNextReminder(note) {
  if (!note.repeat) return null;

  const { frequency, weekDays, monthDays, endDate } = note.repeat;
  let next = new Date(note.datetime);

  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (frequency === "weekly") {
    const currentDay = next.getDay();
    const sortedDays = [...weekDays].sort((a, b) => a - b);
    const nextDay = sortedDays.find((d) => d > currentDay);

    if (nextDay !== undefined) {
      next.setDate(next.getDate() + (nextDay - currentDay));
    } else {
      next.setDate(next.getDate() + (7 - currentDay) + sortedDays[0]);
    }
  } else if (frequency === "monthly") {
    const currentDate = next.getDate();
    const sortedDates = [...monthDays].sort((a, b) => a - b);
    const nextDate = sortedDates.find((d) => d > currentDate);

    if (nextDate) {
      next.setDate(nextDate);
    } else {
      next.setMonth(next.getMonth() + 1, 1);
      next.setDate(sortedDates[0]);
    }
  }

  // 檢查是否超過結束日期
  if (endDate && next > new Date(endDate)) {
    return null;
  }

  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  const hours = String(next.getHours()).padStart(2, "0");
  const minutes = String(next.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
