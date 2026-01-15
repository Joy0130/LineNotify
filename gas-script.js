//專案名稱LINENotify_Github
/********************************
 * 讀取專案設定
 ********************************/
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    LINE_USER_ID: props.getProperty('LINE_USER_ID'),
    LINE_CHANNEL_ACCESS_TOKEN: props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    GITHUB_TOKEN: props.getProperty('GITHUB_TOKEN'),
    GIST_ID: props.getProperty('GIST_ID'),
    GIST_FILENAME: props.getProperty('GIST_FILENAME')
  };
}

/********************************
 * 主入口（Trigger）
 ********************************/
function main() {


    // 傳入當前時間，讓後續函式使用一致的時間基準
  if (!isWithinTimeRange(new Date())) return;

  try {
    processNotifications();
  } catch (e) {
    console.error('通知流程錯誤:', e);
  }
}

/********************************
 * 08:00 ~ 20:30 才執行
 ********************************/
function isWithinTimeRange(now) {
  // 使用 Utilities.formatDate 取得台北時區的小時和分鐘
  const taipeiHour = parseInt(Utilities.formatDate(now, 'Asia/Taipei', 'H'));
  const taipeiMinute = parseInt(Utilities.formatDate(now, 'Asia/Taipei', 'm'));

  const totalMinutes = taipeiHour * 60 + taipeiMinute;

  const startMinutes = 8 * 60; // 08:00
  const endMinutes = 20 * 60 + 30; // 20:30

  // 避免在深夜執行，減少不必要的 Gist API 呼叫
  return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
}

/********************************
 * 核心流程（已修正：解決過期仍發送問題、發送後不自動標記為 Completed）
 ********************************/
function processNotifications() {
  const raw = JSON.parse(getGistContent());
  const notes = raw.notes;
  const now = new Date();
  let updated = false;

  // 只允許延遲幾分鐘內送出，超過就視為錯過（不補發）
  const ALLOW_LATE_MINUTES = 2;

  notes.forEach(item => {
    if (!item.datetime) return;

    // 單次提醒：如果「通知已發送」(sent=true) 且沒有被手動重置，則跳過
    // 注意：這裡只檢查 sent，不檢查 completionStatus，實現邏輯分離
    const isRepeat = item.repeat && item.repeat.type === 'repeat';
    if (!isRepeat && item.sent === true) return;

    // 安全初始化
    if (!('lastPlanned' in item)) item.lastPlanned = null;
    if (!('lastSentAt' in item)) item.lastSentAt = null;

    const planned = parseTaipeiTime(item.datetime);

    // 已處理過這個排程點 → 永遠不補發
    if (item.lastPlanned === item.datetime) return;

    // 尚未到時間
    if (now < planned) return;

    // 檢查結束日期 (防止到截止時間後還重複提醒)
    if (isRepeat && item.repeat.endDate) {
      // 修正：處理可能已包含時間的 endDate
      // 如果 endDate 已經包含時間（例如 "2026-01-14T13:30"），直接使用
      // 否則加上 "T23:59:59" 作為當天的結束時間
      const endDateStr = item.repeat.endDate.includes('T') 
        ? item.repeat.endDate 
        : item.repeat.endDate + 'T23:59:59';
      const endTimestamp = parseTaipeiTime(endDateStr);
      
      // 使用當前時間 now 來判斷，而不是 planned
      // 這樣一旦當前日期超過結束日期，就立即停止發送通知
      if (now > endTimestamp) {
        // 超過結束日期，標記通知已結束
        item.sent = true;
        // item.completionStatus = 'completed'; // <--- 已移除：讓使用者自己決定是否完成
        item.updatedAt = toTaipeiISOString(now);
        updated = true;
        return; 
      }
    }

    const diffMinutes = (now.getTime() - planned.getTime()) / (1000 * 60);

    // ❌ 超過允許延遲 → 視為錯過，不補發
    if (diffMinutes > ALLOW_LATE_MINUTES) {
      item.lastPlanned = item.datetime; // 鎖住這次排程點

      if (isRepeat) {
        const ok = advanceToNextOccurrence(item, now);
        if (!ok) {
          // 重複已結束
          item.sent = true;
          // item.completionStatus = 'completed'; // <--- 已移除
        }
      }
      item.updatedAt = toTaipeiISOString(now);
      updated = true;
      return;
    }

    // ✅ 在允許延遲內 → 正常送出
    send(item);
    item.lastSentAt = toTaipeiISOString(now);
    item.lastPlanned = item.datetime;

    if (!isRepeat) {
      // 單次提醒
      item.sent = true;
      // item.completionStatus = 'completed'; // <--- 已移除：這就是你要的修改！
      
      // 如果你希望發送後預設為 "未完成" (讓介面顯示三角形)，可以取消下面這行的註解：
      // item.completionStatus = 'incomplete'; 
    } else {
      // 重複提醒：算下一次
      const next = calculateNextReminder(item);
      if (next) {
        item.datetime = next;
      } else {
        // 重複結束
        item.sent = true;
        // item.completionStatus = 'completed'; // <--- 已移除
      }
    }

    item.updatedAt = toTaipeiISOString(now);
    updated = true;
  });

  if (updated) {
    raw.lastUpdated = toTaipeiISOString(now);
    updateGistContent(raw);
  }
}

// 注意：你需要確保 advanceToNextOccurrence 函式存在 (因為原程式碼中似乎漏貼了這個輔助函式)
// 如果你的程式碼中沒有 advanceToNextOccurrence，請將上方 if (diffMinutes > ALLOW_LATE_MINUTES) 區塊內的邏輯改為簡單的 logic:
// 或者直接把下方的 helper function 也補上以防萬一：

function advanceToNextOccurrence(item, now) {
    // 簡單遞迴嘗試推進到未來
    let next = calculateNextReminder(item);
    // 最多嘗試幾次避免無窮迴圈
    let limit = 10; 
    while (next && new Date(next + '+08:00') < now && limit > 0) {
        item.datetime = next;
        next = calculateNextReminder(item);
        limit--;
    }
    if (next) {
        item.datetime = next;
        return true;
    }
    return false;
}


/********************************
 * 計算下一次重複提醒的時間 (Pipedream 邏輯)
 ********************************/
function calculateNextReminder(note) {
  if (!note.repeat || note.repeat.type !== 'repeat') return null;

  const { frequency, weekDays, monthDays, endDate } = note.repeat;
  // 使用 parseTaipeiTime 從 note.datetime 建立一個 Date 物件
  let next = parseTaipeiTime(note.datetime);

  if (frequency === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (frequency === "weekly" && Array.isArray(weekDays)) {
    const currentDay = next.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const sortedDays = [].concat(weekDays).sort((a, b) => a - b); // 使用 concat 建立副本
    let nextDay = sortedDays.find((d) => d > currentDay);

    if (nextDay !== undefined) {
      // 下次發生在同一週
      next.setDate(next.getDate() + (nextDay - currentDay));
    } else {
      // 下次發生在下週，找到排程中的第一天
      next.setDate(next.getDate() + (7 - currentDay) + sortedDays[0]);
    }
  } else if (frequency === "monthly" && Array.isArray(monthDays)) {
    const currentDate = next.getDate();
    const sortedDates = [].concat(monthDays).sort((a, b) => a - b); // 使用 concat 建立副本
    let nextDate = sortedDates.find((d) => d > currentDate);

    if (nextDate) {
      // 下次發生在同一個月
      next.setDate(nextDate);
    } else {
      // 下次發生在下個月。先將日期設為 1，避免因月份天數不同而出錯
      next.setMonth(next.getMonth() + 1, 1);
      next.setDate(sortedDates[0]);
    }
  } else {
    return null; // 未知的頻率
  }

  // 檢查計算出的下次日期是否超過結束日期
  if (endDate) {
      // 修正：處理可能已包含時間的 endDate
      const endDateStr = endDate.includes('T') 
        ? endDate 
        : endDate + 'T23:59:59';
      const end = parseTaipeiTime(endDateStr);
      if (next > end) {
          return null; // 重複已結束
      }
  }

  // 使用 Utilities.formatDate 將 Date 物件格式化為台北時區的字串
  return Utilities.formatDate(next, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm");
}

/********************************
 * 工具函式
 ********************************/
function parseTaipeiTime(str) {
  // 確保傳入的字串包含時區資訊，讓 new Date() 能正確解析
  return new Date(str + '+08:00');
}

function toTaipeiISOString(d) {
  // 使用 Utilities.formatDate 將 Date 物件格式化為台北時區的字串
  return Utilities.formatDate(d, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm");
}
/********************************
 * LINE 發送
 ********************************/
function send(item) {
  const c = getConfig();
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + c.LINE_CHANNEL_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      to: c.LINE_USER_ID,
      messages: [{
        type: 'text',
        text: `【${item.category}】\n${item.content}`
      }]
    })
  });
}

/********************************
 * Gist I/O
 ********************************/
function getGistContent() {
  const c = getConfig();
  const res = UrlFetchApp.fetch(`https://api.github.com/gists/${c.GIST_ID}`, {
    headers: { Authorization: 'token ' + c.GITHUB_TOKEN }
  });
  return JSON.parse(res.getContentText()).files[c.GIST_FILENAME].content;
}

function updateGistContent(data) {
  const c = getConfig();
  UrlFetchApp.fetch(`https://api.github.com/gists/${c.GIST_ID}`, {
    method: 'patch',
    headers: { Authorization: 'token ' + c.GITHUB_TOKEN },
    payload: JSON.stringify({
      files: {
        [c.GIST_FILENAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    })
  });
}

/********************************
 * 診斷和修正已過期的重複提醒
 * 使用方法：在 Google Apps Script 中直接執行此函數
 ********************************/
function fixExpiredRepeats() {
  const raw = JSON.parse(getGistContent());
  const notes = raw.notes;
  const now = new Date();
  let fixedCount = 0;
  
  console.log(`=== 開始診斷 (當前時間: ${toTaipeiISOString(now)}) ===`);
  
  notes.forEach((item, index) => {
    // 只檢查重複提醒
    const isRepeat = item.repeat && item.repeat.type === 'repeat';
    if (!isRepeat) return;
    
    // 只檢查還沒標記為已發送的
    if (item.sent === true) return;
    
    // 檢查是否有結束日期
    if (!item.repeat.endDate) {
      console.log(`記事 #${index + 1}: "${item.content}" - 沒有結束日期`);
      return;
    }
    
    // 解析結束日期
    const endDateStr = item.repeat.endDate.includes('T') 
      ? item.repeat.endDate 
      : item.repeat.endDate + 'T23:59:59';
    const endTimestamp = parseTaipeiTime(endDateStr);
    
    console.log(`記事 #${index + 1}: "${item.content}"`);
    console.log(`  - 結束時間: ${endDateStr}`);
    console.log(`  - 當前狀態: sent=${item.sent}`);
    console.log(`  - 當前 datetime: ${item.datetime}`);
    
    // 檢查是否已過期
    if (now > endTimestamp) {
      console.log(`  ✅ 已過期，需要修正`);
      item.sent = true;
      item.updatedAt = toTaipeiISOString(now);
      fixedCount++;
    } else {
      console.log(`  ⏳ 尚未過期`);
    }
  });
  
  console.log(`\n=== 診斷完成 ===`);
  console.log(`共修正 ${fixedCount} 筆記事`);
  
  if (fixedCount > 0) {
    raw.lastUpdated = toTaipeiISOString(now);
    updateGistContent(raw);
    console.log(`已更新 Gist 內容`);
  } else {
    console.log(`沒有需要修正的記事`);
  }
  
  return `修正了 ${fixedCount} 筆記事`;
}