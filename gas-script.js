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
 * 核心流程（已修正）
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

    // 單次提醒如果已完成，直接跳過（避免影響既有「已發送」資料）
    const isRepeat = item.repeat && item.repeat.type === 'repeat';
    if (!isRepeat && item.sent === true) return;

    // 安全初始化（不破壞既有資料）
    if (!('lastPlanned' in item)) item.lastPlanned = null;
    if (!('lastSentAt' in item)) item.lastSentAt = null;

    const planned = parseTaipeiTime(item.datetime);

    // 已處理過這個排程點 → 永遠不補發
    if (item.lastPlanned === item.datetime) return;

    // 尚未到時間
    if (now < planned) return;

    const diffMinutes = (now.getTime() - planned.getTime()) / (1000 * 60);

    // ❌ 超過允許延遲 → 視為錯過，不補發
    if (diffMinutes > ALLOW_LATE_MINUTES) {
      item.lastPlanned = item.datetime; // 鎖住這次排程點，避免之後又被補發

      if (isRepeat) {
        // 推進到下一次（直到下一次 >= now 或結束）
        const ok = advanceToNextOccurrence(item, now);
        if (!ok) {
          // 重複已結束
          item.sent = true;
          item.completionStatus = 'completed';
        }
      }
      item.updatedAt = toTaipeiISOString(now);
      updated = true;
      return;
    }

    // ✅ 在允許延遲內 → 正常送出（只送一次）
    send(item);
    item.lastSentAt = toTaipeiISOString(now);
    item.lastPlanned = item.datetime;

    if (!isRepeat) {
      // 單次提醒：維持原本行為
      item.sent = true;
      item.completionStatus = 'completed';
    } else {
      // 重複提醒：算下一次
      const next = calculateNextReminder(item);
      if (next) {
        item.datetime = next;
      } else {
        item.sent = true;
        item.completionStatus = 'completed';
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
      // 將 endDate 視為該天的最末時間
      const end = parseTaipeiTime(endDate + 'T23:59:59');
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