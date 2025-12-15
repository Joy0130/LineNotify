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
  if (!isWithinTimeRange()) return;

  try {
    processNotifications();
  } catch (e) {
    console.error('通知流程錯誤:', e);
  }
}

/********************************
 * 08:15 ~ 20:30 才執行
 ********************************/
function isWithinTimeRange() {
  const now = getTaipeiNow();
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 495 && m <= 1230;
}

/********************************
 * 核心流程
 ********************************/
function processNotifications() {
  const raw = JSON.parse(getGistContent());
  const notes = raw.notes;

  if (!Array.isArray(notes)) {
    throw new Error('notes 欄位不存在或不是 Array');
  }

  const now = getTaipeiNow();
  let updated = false;

  notes.forEach(item => {
    if (!item.datetime) return;

    /* ========= 單次提醒 ========= */
    if (item.repeat === null) {
      if (item.sent === true) return;

      const planned = parseTaipeiTime(item.datetime);
      if (now >= planned) {
        send(item);
        item.sent = true;
        item.completionStatus = 'completed';
        item.lastSentAt = toTaipeiISOString(now);
        item.updatedAt = toTaipeiISOString(now);
        updated = true;
      }
      return;
    }

    /* ========= 重複提醒 ========= */
    const planned = getPlannedSendTime(item, now);
    if (!planned) return;

    if (hasAlreadySentForThisSchedule(item, planned)) return;

    send(item);
    item.lastSentAt = toTaipeiISOString(now);
    item.updatedAt = toTaipeiISOString(now);
    updated = true;
  });

  if (updated) {
    raw.lastUpdated = toTaipeiISOString(now);
    updateGistContent(raw);
  }
}

/********************************
 * 是否已對「本次排程」發送過
 ********************************/
function hasAlreadySentForThisSchedule(item, plannedTime) {
  if (!item.lastSentAt) return false;

  const lastSent = parseTaipeiTime(item.lastSentAt);
  const updatedAt = item.updatedAt ? parseTaipeiTime(item.updatedAt) : null;

  const base = updatedAt && updatedAt > plannedTime
    ? updatedAt
    : plannedTime;

  return lastSent >= base;
}

/********************************
 * 計算本次應該發送的時間
 ********************************/
function getPlannedSendTime(item, now) {
  const r = item.repeat;
  if (!r || r.type !== 'repeat') return null;

  const start = parseTaipeiTime(r.startDate);
  const end = r.endDate ? parseTaipeiTime(r.endDate) : null;
  if (now < start) return null;
  if (end && now > end) return null;

  const baseTime = parseTaipeiTime(item.datetime);
  if (!isWithinTimeWindow(baseTime, now, 10)) return null;

  if (r.frequency === 'weekly') {
    if (!Array.isArray(r.weekDays)) return null;
    return r.weekDays.includes(now.getDay()) ? baseTime : null;
  }

  if (r.frequency === 'monthly') {
    if (!Array.isArray(r.monthDays)) return null;
    return r.monthDays.includes(now.getDate()) ? baseTime : null;
  }

  return null;
}

/********************************
 * 工具函式
 ********************************/
function getTaipeiNow() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
  );
}

function parseTaipeiTime(str) {
  return new Date(str + '+08:00');
}

function toTaipeiISOString(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isWithinTimeWindow(base, now, minutes) {
  return Math.abs(now - base) <= minutes * 60 * 1000;
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
