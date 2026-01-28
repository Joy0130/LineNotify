let notes = [];
let config = { userId: '', channelToken: '', githubToken: '', gistId: '' };
let tempRepeatSettings = null, lastClickedDay = null;
let isSyncing = false;

// 自動調整 textarea 高度
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfigFromLocalStorage();
    loadNotesFromLocalStorage();
    migrateCompletedNotes(); // 自動遷移已完成的記事
    renderNotes();
    lucide.createIcons();
    initMonthDaysGrid();
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('modal-start-date').value = now.toISOString().slice(0, 16);
    
    // Auto sync on load if configured
    if (config.githubToken) {
        syncFromCloud();
    }
    
    // 回到頂部按鈕滾動偵測
    initBackToTopButton();
});

// 回到頂部按鈕功能
function initBackToTopButton() {
    const backToTopBtn = document.getElementById('back-to-top');
    
    // 監聽滾動事件
    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            backToTopBtn.classList.add('show');
        } else {
            backToTopBtn.classList.remove('show');
        }
    });
}

// 平滑滾動到頂部
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// --- Cloud Sync Functions ---
async function confirmSyncFromCloud() {
    if (isSyncing) return;
    
    if (!config.githubToken || !config.gistId) {
        showToast('請先設定 GitHub Token 和 Gist ID', 'error');
        return;
    }
    
    // 確認對話框
    if (confirm('⚠️ 從雲端下載會覆蓋本地所有資料！\n\n確定要繼續嗎？')) {
        await syncFromCloud();
    }
}

async function syncToCloud() {
    if (!config.githubToken) {
        showToast('請先設定 GitHub Token', 'error');
        return;
    }
    
    isSyncing = true;
    updateSyncStatus(true, '同步中...');
    
    try {
        const data = {
            config: {
                userId: config.userId,
                channelToken: config.channelToken
            },
            notes: notes,
            lastUpdated: new Date().toISOString()
        };

        const gistData = {
            description: "LINE Reminder App Data",
            public: false,
            files: {
                "line-reminder-data.json": {
                    content: JSON.stringify(data, null, 2)
                }
            }
        };
        //github gist api設定 
        let response;
        if (config.gistId) {
            // Update existing gist
            response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${config.githubToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });
        } else {
            // Create new gist
            response = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${config.githubToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            });
        }
        //建立或更新資料
        if (response.ok) {
            const result = await response.json();
            //判斷是否有gistId 沒有則建立
            if (!config.gistId) {
                config.gistId = result.id;
                document.getElementById('config-gist-id').value = result.id;
                saveConfigToLocalStorage();
                showToast(`已創建 Gist: ${result.id}`, 'success');
            } else {
                showToast('已同步到雲端', 'success');
            }
            updateSyncStatus(true, '已同步');
            hideCloudWarning();
        } else {
            throw new Error('Sync failed');
        }
    } catch (error) {
        showToast('同步失敗，請檢查設定', 'error');
        updateSyncStatus(false, '同步失敗');
    } finally {
        isSyncing = false;
        setTimeout(() => updateSyncStatus(false, ''), 3000);
    }
}

async function syncFromCloud() {
    if (!config.githubToken || !config.gistId) {
        return;
    }

    isSyncing = true;
    updateSyncStatus(true, '讀取中...');

    try {
        const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
            headers: {
                'Authorization': `token ${config.githubToken}`
            }
        });

        if (response.ok) {
            const gist = await response.json();
            const fileContent = gist.files['line-reminder-data.json'].content;
            const data = JSON.parse(fileContent);
            
            notes = data.notes || [];
            if (data.config) {
                config.userId = data.config.userId || config.userId;
                config.channelToken = data.config.channelToken || config.channelToken;
            }
            
            migrateCompletedNotes(); // 自動遷移已完成的記事
            saveNotesToLocalStorage();
            saveConfigToLocalStorage();
            renderNotes();
            loadConfigToUI();
            showToast('已從雲端讀取資料', 'success');
            updateSyncStatus(true, '已同步');
            hideCloudWarning();
        } else {
            throw new Error('Load failed');
        }
    } catch (error) {
        showToast('讀取雲端資料失敗', 'error');
    } finally {
        isSyncing = false;
        setTimeout(() => updateSyncStatus(false, ''), 3000);
    }
}

function updateSyncStatus(show, text) {
    const status = document.getElementById('sync-status');
    const icon = document.getElementById('sync-icon');
    
    if (show) {
        status.classList.remove('hidden');
        document.getElementById('sync-text').innerText = text;
        if (text.includes('中')) {
            icon.classList.add('sync-spin');
        } else {
            icon.classList.remove('sync-spin');
        }
    } else {
        status.classList.add('hidden');
        icon.classList.remove('sync-spin');
    }
}

function hideCloudWarning() {
    const warning = document.getElementById('cloud-setup-warning');
    if (warning && config.githubToken && config.gistId) {
        warning.remove();
    }
}

// --- Storage Functions ---
function saveNotesToLocalStorage() {
    localStorage.setItem('line_note_list_cloud', JSON.stringify(notes));
}

function loadNotesFromLocalStorage() {
    const saved = localStorage.getItem('line_note_list_cloud');
    if (saved) {
        notes = JSON.parse(saved);
    }
}

// 自動遷移已完成的記事到「已完成」分類
function migrateCompletedNotes() {
    let hasChanges = false;
    notes = notes.map(note => {
        if (note.completionStatus === 'completed' && note.category !== '已完成') {
            hasChanges = true;
            return { ...note, category: '已完成' };
        }
        return note;
    });
    
    if (hasChanges) {
        saveNotesToLocalStorage();
        console.log('已自動將完成的記事移到「已完成」分類');
    }
}

function saveConfigToLocalStorage() {
    localStorage.setItem('line_note_config_cloud', JSON.stringify(config));
}

function loadConfigFromLocalStorage() {
    const saved = localStorage.getItem('line_note_config_cloud');
    if (saved) {
        config = JSON.parse(saved);
    }
}

// --- Backup/Restore ---
function toggleBackupPanel() { const p=document.getElementById('backup-panel'); p.classList.toggle('hidden'); if(!p.classList.contains('hidden')) document.getElementById('settings-panel').classList.add('hidden'); }
function exportData() { const d={config,notes,exportedAt:new Date().toISOString()}; const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`line_note_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); showToast('備份檔已下載','success'); }
function importData(i) { const f=i.files[0]; if(!f)return; const r=new FileReader(); r.onload=async(e)=>{try{const d=JSON.parse(e.target.result); if(d.notes){if(confirm('確定要還原嗎？這會覆蓋現有資料')){notes=d.notes; if(d.config){config.userId=d.config.userId||''; config.channelToken=d.config.channelToken||'';} saveNotesToLocalStorage(); saveConfigToLocalStorage(); renderNotes(); loadConfigToUI(); await syncToCloud(); showToast('還原成功','success'); toggleBackupPanel();}}else{alert('格式錯誤');}}catch(x){alert('讀取失敗');}i.value='';}; r.readAsText(f); }

// --- Config UI ---
function toggleSettings() { const p=document.getElementById('settings-panel'); p.classList.toggle('hidden'); if(!p.classList.contains('hidden')) document.getElementById('backup-panel').classList.add('hidden'); }
function loadConfigToUI() { 
    document.getElementById('config-userId').value=config.userId||''; 
    document.getElementById('config-token').value=config.channelToken||''; 
    document.getElementById('config-github-token').value=config.githubToken||''; 
    document.getElementById('config-gist-id').value=config.gistId||''; 
}
// 儲存設定到 localStorage 並同步到雲端
async function saveConfig() { 
    config.userId=document.getElementById('config-userId').value; 
    config.channelToken=document.getElementById('config-token').value; 
    config.githubToken=document.getElementById('config-github-token').value; 
    config.gistId=document.getElementById('config-gist-id').value; 
    saveConfigToLocalStorage(); 
    showToast('設定已儲存', 'success'); 
    await syncToCloud();
    toggleSettings(); 
}

// 記事表單處理函式
async function handleFormSubmit(e) { 
    e.preventDefault(); 
    let cat = document.getElementById('note-category').value;
    const completion = document.getElementById('note-completion').value;
    const c = document.getElementById('note-content').value; 
    const d = document.getElementById('note-datetime').value; 
    const eid = document.getElementById('edit-id').value; 
    if(!c)return; 

    let isSent = false;
    let finalCompletion = '';

    if(eid) {
        const oldNote = notes.find(n => n.id === eid);
        if (oldNote && oldNote.sent) {
            if (oldNote.datetime === d) {
                isSent = true;
                finalCompletion = completion; 
            } else {
                isSent = false; 
                finalCompletion = ''; 
            }
        } else {
            isSent = false; 
            finalCompletion = '';
        }
    }

    // 當記事標記為完成時，自動將分類改為「已完成」
    if (finalCompletion === 'completed') {
        cat = '已完成';
    }

    const nd = { category: cat, content: c, datetime: d, sent: isSent, completionStatus: finalCompletion, repeat: tempRepeatSettings, updatedAt: new Date().toISOString() }; 
    
    if(eid) notes = notes.map(n=>n.id===eid?{...n, ...nd}:n); 
    else notes = [{id:Date.now().toString(), createdAt:new Date().toISOString(), ...nd}, ...notes]; 
    
    saveNotesToLocalStorage(); 
    await syncToCloud();
    resetForm(); 
    renderNotes(); 
    showToast('已儲存','success'); 
}

function startEdit(id) { 
    const n = notes.find(x=>x.id===id); if(!n)return; 
    document.getElementById('edit-id').value = n.id; 
    document.getElementById('note-category').value = n.category || '重要'; 
    
    const completionSection = document.getElementById('completion-section');
    if (n.sent) {
        completionSection.classList.remove('hidden');
        document.getElementById('note-completion').value = n.completionStatus || '';
    } else {
        completionSection.classList.add('hidden');
        document.getElementById('note-completion').value = '';
    }

    const contentTextarea = document.getElementById('note-content');
    contentTextarea.value = n.content;
    autoResizeTextarea(contentTextarea); // 調整高度以適應內容 
    document.getElementById('note-datetime').value = n.datetime||''; 
    tempRepeatSettings = n.repeat||null; 
    updateRepeatSummaryUI(); 
    document.getElementById('form-title').innerText = '編輯記事'; 
    document.getElementById('submit-btn-text').innerText = '更新記事'; 
    document.getElementById('cancel-btn').classList.remove('hidden'); 
    document.getElementById('form-icon').setAttribute('data-lucide','edit-2'); 
    document.getElementById('form-icon').classList.replace('text-emerald-500','text-amber-500'); 
    lucide.createIcons(); 
    window.scrollTo({top:0, behavior:'smooth'}); 
}

function resetForm() { 
    document.getElementById('note-form').reset(); 
    document.getElementById('edit-id').value = ''; 
    document.getElementById('note-category').value = '重要'; 
    document.getElementById('completion-section').classList.add('hidden');
    document.getElementById('note-completion').value = '';
    
    // 重置 textarea 高度為預設值
    const contentTextarea = document.getElementById('note-content');
    contentTextarea.style.height = 'auto';
    
    tempRepeatSettings = null; 
    updateRepeatSummaryUI(); 
    document.getElementById('form-title').innerText = '新增記事'; 
    document.getElementById('submit-btn-text').innerText = '儲存記事'; 
    document.getElementById('cancel-btn').classList.add('hidden'); 
    document.getElementById('form-icon').setAttribute('data-lucide','plus'); 
    document.getElementById('form-icon').classList.replace('text-amber-500','text-emerald-500'); 
    lucide.createIcons(); 
}

async function deleteNote(id) { 
    if(confirm('確定刪除？')) { 
        notes=notes.filter(n=>n.id!==id); 
        if(document.getElementById('edit-id').value===id) resetForm(); 
        saveNotesToLocalStorage(); 
        await syncToCloud();
        renderNotes(); 
        showToast('已刪除'); 
    } 
}

// --- Repeat Modal (same as original) ---
function initMonthDaysGrid() { const g=document.getElementById('month-days-grid'); for(let i=1;i<=31;i++){const b=document.createElement('button');b.className='month-btn w-9 h-9 rounded bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors';b.innerText=i;b.dataset.day=i;b.onclick=(e)=>toggleMonthDay(b,i,e);g.appendChild(b);} }
function getRepeatSummaryHtml(s) { if(!s)return ''; let t=''; if(s.frequency==='weekly'){const m=['日','一','二','三','四','五','六'];t=`每週的 ${(s.weekDays||[]).map(d=>m[d]).join(', ')}`;} else if(s.frequency==='monthly'){t=`每月 ${(s.monthDays||[]).join(', ')} 日`;} else t='每天'; const e=s.endDate?`，直到 ${formatDateTime(s.endDate)}`:''; return `<span class="font-bold">${t}</span> 重複<br/>(從 ${formatDateTime(s.startDate)} 開始${e})`; }
function handleRepeatChange(s) { if(s.value==='custom')openRepeatModal(); else{tempRepeatSettings=null;updateRepeatSummaryUI();} }
function handleFrequencyChange(s) { document.getElementById('weekly-options').classList.toggle('hidden',s.value!=='weekly'); document.getElementById('monthly-options').classList.toggle('hidden',s.value!=='monthly'); }
function toggleBtn(b) { b.classList.toggle('btn-active'); b.classList.toggle('bg-white'); b.classList.toggle('text-slate-600'); }
function toggleMonthDay(b,d,e) { if(e.shiftKey&&lastClickedDay!==null){const s=Math.min(lastClickedDay,d),en=Math.max(lastClickedDay,d); document.querySelectorAll('.month-btn').forEach(x=>{const v=parseInt(x.dataset.day);if(v>=s&&v<=en){x.classList.add('btn-active');x.classList.remove('bg-white','text-slate-600');}});} else{toggleBtn(b);lastClickedDay=d;} }
function clearWeeklySelection() { document.querySelectorAll('.weekly-btn').forEach(b=>{b.classList.remove('btn-active');b.classList.add('bg-white','text-slate-600');}); }
function clearMonthlySelection() { document.querySelectorAll('.month-btn').forEach(b=>{b.classList.remove('btn-active');b.classList.add('bg-white','text-slate-600');});lastClickedDay=null; }
function openRepeatModal() { 
    document.getElementById('repeat-modal').classList.remove('hidden'); 
    document.getElementById('weekly-options').classList.add('hidden'); document.getElementById('monthly-options').classList.add('hidden');
    if(tempRepeatSettings) {
        document.getElementById('modal-start-date').value = tempRepeatSettings.startDate||'';
        document.getElementById('modal-frequency').value = tempRepeatSettings.frequency||'daily';
        document.getElementById('modal-end-date').value = tempRepeatSettings.endDate||'';
        if(tempRepeatSettings.frequency==='weekly') { document.getElementById('weekly-options').classList.remove('hidden'); const wd=tempRepeatSettings.weekDays||[]; document.querySelectorAll('.weekly-btn').forEach(b=>updateBtnState(b, wd.includes(parseInt(b.dataset.day)))); }
        else if(tempRepeatSettings.frequency==='monthly') { document.getElementById('monthly-options').classList.remove('hidden'); const md=tempRepeatSettings.monthDays||[]; document.querySelectorAll('.month-btn').forEach(b=>updateBtnState(b, md.includes(parseInt(b.dataset.day)))); }
    } else {
        const mt = document.getElementById('note-datetime').value; if(mt) document.getElementById('modal-start-date').value=mt;
        document.getElementById('modal-end-date').value=''; document.getElementById('modal-frequency').value='daily';
        document.querySelectorAll('.weekly-btn, .month-btn').forEach(b=>updateBtnState(b,false));
    }
}
function updateBtnState(b,a) { if(a){ b.classList.add('btn-active'); b.classList.remove('bg-white','text-slate-600'); } else { b.classList.remove('btn-active'); b.classList.add('bg-white','text-slate-600'); } }
function closeRepeatModal(s) { document.getElementById('repeat-modal').classList.add('hidden'); if(!s && !tempRepeatSettings) document.getElementById('repeat-select').value='none'; }
function saveRepeatModal() {
    const s=document.getElementById('modal-start-date').value, f=document.getElementById('modal-frequency').value, e=document.getElementById('modal-end-date').value;
    if(!s) { alert('請設定開始日期'); return; }
    let set = { type:'repeat', startDate:s, frequency:f, endDate:e };
    if(f==='weekly') { const wd=Array.from(document.querySelectorAll('.weekly-btn.btn-active')).map(b=>parseInt(b.dataset.day)).sort((a,b)=>a-b); if(wd.length===0){alert('請選擇星期');return;} set.weekDays=wd; }
    else if(f==='monthly') { const md=Array.from(document.querySelectorAll('.month-btn.btn-active')).map(b=>parseInt(b.dataset.day)).sort((a,b)=>a-b); if(md.length===0){alert('請選擇日期');return;} set.monthDays=md; }
    tempRepeatSettings=set; closeRepeatModal(true); updateRepeatSummaryUI();
}
function updateRepeatSummaryUI() { const div=document.getElementById('repeat-summary'), sel=document.getElementById('repeat-select'), btn=document.getElementById('edit-repeat-btn'); if(tempRepeatSettings){ sel.value='custom'; div.classList.remove('hidden'); btn.classList.remove('hidden'); div.innerHTML=getRepeatSummaryHtml(tempRepeatSettings); } else { sel.value='none'; div.classList.add('hidden'); btn.classList.add('hidden'); div.innerText=''; } }

// --- Rendering ---
function createNoteCardHtml(note) {
    // 時區安全的日期解析 (與 gas-script.js 的 parseTaipeiTime 邏輯一致)
    const parseDateTime = (str) => {
if (!str) return null;
// 如果字串已包含時區信息（+ 或 Z），直接使用；否則加上 +08:00
if (str.includes('+') || str.includes('Z')) {
    return new Date(str);
}
return new Date(str + '+08:00');
    };
    
    const now = new Date();
    const isRepeat = note.repeat && note.repeat.type === 'repeat';

    // 使用時區安全的解析
    const scheduledTime = parseDateTime(note.datetime);
    const isExpired = scheduledTime && scheduledTime < now;

    // 是否為 repeat 且最近一次已成功發送
    let repeatJustSent = false;
    if (isRepeat && note.lastSentAt) {
const lastSent = parseDateTime(note.lastSentAt);
if (lastSent && scheduledTime) {
    repeatJustSent = lastSent >= scheduledTime;
}
    }

    let cardStyle = 'bg-white border-slate-100'; 
    let statusClass = 'bg-amber-100 text-amber-700';
    let statusText = '<span><i data-lucide="clock" class="inline w-3 h-3"></i> 待發送</span>';

    /* ========= 狀態判斷核心 ========= */
    // 對於重複通知：只要 sent = false 且 datetime 是未來時間，就視為「待發送」
    // 對於單次通知：sent = true 時顯示「已發送」
    if (note.sent) {
// sent = true：單次已發送 or 重複已結束
cardStyle = 'bg-emerald-50 border border-emerald-200';
statusClass = 'bg-emerald-100 text-emerald-700';
statusText = '<span><i data-lucide="check-circle" class="inline w-3 h-3"></i> 已發送</span>';

    } else if (isRepeat && repeatJustSent && !isExpired) {
// 重複通知剛發送完，且 GAS 還沒來得及更新 datetime（極短暫的狀態）
// 此時顯示「剛發送」提示用戶通知已送出
cardStyle = 'bg-emerald-50 border border-emerald-200';
statusClass = 'bg-emerald-100 text-emerald-700';
statusText = '<span><i data-lucide="check-circle" class="inline w-3 h-3"></i> 剛發送</span>';

    } else if (isExpired) {
// 檢查是否在允許延遲時間內（GAS 每分鐘執行一次，允許 3 分鐘延遲）
const ALLOW_DELAY_MINUTES = 3;
const scheduledTime = new Date(note.datetime);
const delayMinutes = (now.getTime() - scheduledTime.getTime()) / (1000 * 60);

if (delayMinutes > ALLOW_DELAY_MINUTES) {
    // ❌ 已過排程時間且超過允許延遲 → 真正過期未發
    cardStyle = 'bg-rose-50 border border-rose-200';
    statusClass = 'bg-rose-100 text-rose-700';
    statusText = '過期未發';
} else {
    // ⏳ 已過排程時間但在允許延遲內 → 等待發送
    cardStyle = 'bg-amber-50 border border-transparent shadow-sm';
    statusClass = 'bg-blue-100 text-blue-700';
    statusText = '<span><i data-lucide="send" class="inline w-3 h-3"></i> 等待發送</span>';
}

    } else {
// ⏳ 尚未到時間
cardStyle = 'bg-amber-50 border border-transparent shadow-sm';
    }

    /* ========= UI 其他顯示 ========= */
    let repeatIcon = isRepeat
? `<span class="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded flex items-center gap-1">
     <i data-lucide="refresh-cw" class="w-3 h-3"></i> 重複
   </span>`
: '';

    const repeatSummary = isRepeat
? `<div class="mt-3 text-xs text-slate-500 leading-relaxed">
     ${getRepeatSummaryHtml(note.repeat)}
   </div>`
: '';

    let completionIcon = '';
    if (note.sent && note.completionStatus === 'completed') {
completionIcon = `<i data-lucide="check" class="inline w-5 h-5 text-emerald-700 mr-1 align-text-bottom"></i>`;
    } else if (note.sent && note.completionStatus === 'incomplete') {
completionIcon = `<i data-lucide="triangle" class="inline w-4 h-4 text-amber-700 fill-current mr-1 align-text-bottom"></i>`;
    }

    return `
    <div class="relative group rounded-xl p-5 transition-all hover:shadow-md fade-in ${cardStyle}">
<div class="flex justify-between items-start mb-2">
    <div class="text-xs font-bold px-2 py-1 rounded-full flex  gap-1 ${statusClass}">
        ${statusText}
    </div>
    ${repeatIcon}
</div>

<div class="pr-2">
    <p class="text-slate-800 whitespace-pre-wrap font-medium text-lg mb-3">${completionIcon}${escapeHtml(note.content)}</p>
</div>

<div class="flex items-center justify-between mt-4 pt-4 border-t border-slate-200/50 text-sm">
    <div class="text-slate-500">
        ${note.datetime
            ? `<span class="flex items-center gap-1">
                 <i data-lucide="clock" class="w-3.5 h-3.5"></i>
                 ${formatDateTime(note.datetime)}
               </span>`
            : '<span class="text-slate-400 italic">無提醒</span>'
        }
    </div>
    <div class="flex gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
        <button onclick="startEdit('${note.id}')" class="p-2 text-amber-500 hover:bg-amber-50 rounded-lg">
            <i data-lucide="edit-2" class="w-4 h-4"></i>
        </button>
        <button onclick="deleteNote('${note.id}')" class="p-2 text-rose-500 hover:bg-rose-50 rounded-lg">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
    </div>
</div>

${repeatSummary}
    </div>`;
}

// 記事列表
function renderNotes() {
    const container = document.getElementById('notes-container'); 
    const emptyState = document.getElementById('empty-state'); 
    document.getElementById('note-count').innerText = notes.length;

    if (notes.length === 0) {
        emptyState.classList.remove('hidden');
        container.innerHTML = '';
    } else {
        emptyState.classList.add('hidden');
        
        // --- 修改處開始：新的排序邏輯 ---
        const sortedNotes = [...notes].sort((a, b) => {
            // 定義權重取得函式
            const getWeight = (n) => {
                // 1. 待發送 (尚未 Sent) -> 排最前
                if (!n.sent) return 0;
                
                // 2. 未完成 (已 Sent 但狀態不是 completed) -> 排中間
                // (包含 completionStatus 為空字串或 'incomplete' 的情況)
                if (n.completionStatus !== 'completed') return 1;
                
                // 3. 已完成 (已 Sent 且狀態為 completed) -> 排最後
                return 2;
            };

            const weightA = getWeight(a);
            const weightB = getWeight(b);

            // 第一層：比較狀態權重 (小到大：待發送 -> 未完成 -> 已完成)
            if (weightA !== weightB) {
                return weightA - weightB;
            }

            // 第二層：狀態相同時，比較時間 (由舊到新)
            return new Date(a.datetime || 0) - new Date(b.datetime || 0);
        });
        // --- 修改處結束 ---

        const categories = ['重要', '工作', '私事', '已完成'];
        const groups = { '重要': [], '工作': [], '私事': [], '已完成': [] };

        sortedNotes.forEach(n => {
            const cat = (n.category && categories.includes(n.category)) ? n.category : '重要';
            groups[cat].push(n);
        });

        let html = '';
        categories.forEach(cat => {
            if (groups[cat].length > 0) {
                let headerColor = 'text-slate-600';
                if (cat === '重要') headerColor = 'text-rose-600';
                else if (cat === '工作') headerColor = 'text-blue-600';
                else if (cat === '私事') headerColor = 'text-emerald-600';
                else if (cat === '已完成') headerColor = 'text-purple-600';

                // 「已完成」分類特殊排序：最新到最舊
                let categoryNotes = groups[cat];
                if (cat === '已完成') {
                    categoryNotes = [...groups[cat]].sort((a, b) => {
                        return new Date(b.datetime || 0) - new Date(a.datetime || 0);
                    });
                }

                // 這裡保留了 id 設定，確保上方的快速跳轉按鈕功能正常
                html += `<div id="cat-${cat}" class="category-section scroll-mt-28 transition-colors duration-500 rounded-lg p-1">
                    <h3 class="text-md font-bold ${headerColor} mb-3 mt-2 flex items-center gap-2 border-b pb-2 border-slate-100">
                        <i data-lucide="tag" class="w-4 h-4"></i> ${cat} 
                        <span class="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">${groups[cat].length}</span>
                    </h3>
                    <div class="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                        ${categoryNotes.map(note => createNoteCardHtml(note)).join('')}
                    </div>
                </div>`;
            }
        });
        container.innerHTML = html;
    }
    lucide.createIcons();
}

// --- 新增的跳轉函式 ---
function scrollToCategory(categoryName) {
    const targetId = `cat-${categoryName}`;
    const targetElement = document.getElementById(targetId);

    if (targetElement) {
        // 平滑捲動到該區塊
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // (選用) 閃爍一下背景提醒使用者跳到哪了
        targetElement.classList.add('bg-slate-50');
        setTimeout(() => targetElement.classList.remove('bg-slate-50'), 1000);
    } else {
        // 如果該分類沒有筆記，顯示提示
        showToast(`目前沒有「${categoryName}」分類的記事`, 'info');
    }
}

// --- Utils ---
function formatDateTime(s) { if(!s)return ''; const d=new Date(s); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function escapeHtml(t) { if(!t)return ''; return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g, "&#039;"); }
function showToast(m,t='info') { const c=document.getElementById('toast-container'); const div=document.createElement('div'); div.className=`${t==='error'?'bg-rose-500':t==='success'?'bg-emerald-500':'bg-blue-500'} text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-2 pointer-events-auto fade-in transform transition-all duration-300`; div.innerHTML=`<span>${m}</span>`; c.appendChild(div); setTimeout(()=>{div.classList.add('opacity-0','translate-x-full'); setTimeout(()=>div.remove(),300);},3000); }
