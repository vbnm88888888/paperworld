/* ============ 数据层：localStorage + IndexedDB 记忆库 ============ */
window.PW = window.PW || {};
(function () {
  const { DATA_KEY } = PW.CONFIG;
  const SKEY = DATA_KEY + '.settings';
  const STKEY = DATA_KEY + '.stories';

  let saveTimer = null;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 全局设置 ---------- */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY) || '{}');
      return Object.assign({}, PW.DEFAULT_SETTINGS, s);
    } catch (e) { return Object.assign({}, PW.DEFAULT_SETTINGS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SKEY, JSON.stringify(s)); }
    catch (e) { console.warn('settings save fail', e); }
  }

  /* ---------- 故事集合 ---------- */
  function loadStories() {
    try {
      const arr = JSON.parse(localStorage.getItem(STKEY) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (e) { return []; }
  }
  function saveStories(stories) {
    try { localStorage.setItem(STKEY, JSON.stringify(stories)); }
    catch (e) {
      // 存储超限：给出明确提示
      console.error('stories save fail', e);
      PW.App && PW.App.toast && PW.App.toast('存储空间不足！建议导出备份并清理旧故事/更换头像', '⚠️');
    }
  }
  function saveStoriesSoon(stories) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveStories(stories), 350);
  }

  /* ---------- 故事工厂 ---------- */
  function newStory(tpl, opt) {
    const now = Date.now();
    return {
      id: uid('st'),
      title: opt.title || (tpl ? tpl.name + '故事' : '未命名故事'),
      genreKey: opt.genreKey || (tpl && tpl.key) || 'blank',
      cover: { emoji: tpl ? tpl.emoji : '📖', c1: tpl ? tpl.c1 : '#5b6c8f', c2: tpl ? tpl.c2 : '#8ea6c0' },
      createdAt: now,
      updatedAt: now,
      worldview: {
        text: opt.worldview || (tpl ? tpl.worldview : ''),
        rules: opt.rules || (tpl ? tpl.rules.slice() : [])
      },
      player: opt.player || { name: '我', gender: '', age: '', persona: '', avatar: null },
      npcs: opt.npcs || [],
      chat: { messages: [], summary: '', summarizedUntil: 0 },
      phone: { chats: {}, moments: [], weibo: { posts: [], hot: [] } },
      settings: {
        styleId: tpl ? tpl.styleId : 'delicate',
        pov: 'third',
        optionsOn: true,
        phoneEnabled: tpl ? !!tpl.phone : false
      },
      snapshots: [],
      stats: { calls: 0, promptTokens: 0, completionTokens: 0 },
      progressNote: ''
    };
  }

  /* ---------- 头像/背景压缩 ---------- */
  function compressImage(file, maxPx, cb) {
    if (typeof maxPx === 'function') { cb = maxPx; maxPx = PW.CONFIG.MAX_AVATAR_PX; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 长边不超过 maxPx（头像正方形裁剪；背景保持比例）
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (maxPx === PW.CONFIG.MAX_AVATAR_PX) {
          const min = Math.min(img.width, img.height);
          const c2 = document.createElement('canvas');
          c2.width = c2.height = maxPx;
          const cx = c2.getContext('2d');
          cx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, maxPx, maxPx);
          cb(c2.toDataURL('image/jpeg', 0.78));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- 存档点 ---------- */
  function makeSnapshot(story, label) {
    const snap = {
      id: uid('snap'),
      ts: Date.now(),
      label: label || ('存档 ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
      data: JSON.stringify({ chat: story.chat, npcs: story.npcs, phone: story.phone, worldview: story.worldview })
    };
    story.snapshots.unshift(snap);
    if (story.snapshots.length > 10) story.snapshots.pop();
    return snap;
  }
  function restoreSnapshot(story, snapId) {
    const snap = story.snapshots.find(s => s.id === snapId);
    if (!snap) return false;
    const d = JSON.parse(snap.data);
    story.chat = d.chat; story.npcs = d.npcs; story.phone = d.phone; story.worldview = d.worldview;
    story.updatedAt = Date.now();
    return true;
  }

  /* ---------- 导入导出 ---------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function exportAll(stories, settings) {
    download(PW.CONFIG.APP_NAME + '-全部备份-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ app: PW.CONFIG.APP_NAME, version: 1, exportedAt: Date.now(), settings: Object.assign({}, settings, { apiKey: '' }), stories }, null, 1));
  }
  function exportStoryJson(story) {
    download((story.title || '故事') + '-备份.json', JSON.stringify(story, null, 1));
  }
  /* 导出为小说式 txt：旁白平铺、对话加引号、按分幕排版 */
  function exportStoryTxt(story) {
    const lines = [];
    lines.push('《' + story.title + '》');
    lines.push('题材：' + (PW.TEMPLATES[story.genreKey] ? PW.TEMPLATES[story.genreKey].name : '自定'));
    lines.push('玩家：' + story.player.name);
    lines.push('');
    lines.push('══════════════════');
    story.chat.messages.forEach(m => {
      if (m.kind === 'me') { lines.push('【' + (story.player.name || '我') + '】' + m.text); }
      else if (m.kind === 'ai') {
        const blocks = PW.parseAiMessage ? PW.parseAiMessage(m.text, story) : [];
        blocks.forEach(b => {
          if (b.type === 'narr') lines.push('　　' + b.text);
          else lines.push(b.name + '：“' + b.text + '”');
        });
      }
      else if (m.kind === 'ctrl') { lines.push('（' + m.text + '）'); }
      else if (m.kind === 'ooc') { lines.push('（OOC：' + m.text + '）'); }
      else if (m.kind === 'phone') { lines.push('　' + m.text); }
      lines.push('');
    });
    download((story.title || '故事') + '-小说版.txt', lines.join('\r\n'), 'text/plain;charset=utf-8');
  }

  /* ---------- IndexedDB 记忆库（L3 RAG 存储） ---------- */
  let idbPromise = null;
  function idb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DATA_KEY + '.mem', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('memories')) {
          const st = db.createObjectStore('memories', { keyPath: 'id' });
          st.createIndex('by_story', 'storyId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }
  function tx(db, mode) { return db.transaction('memories', mode).objectStore('memories'); }

  async function memPut(recs) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const st = tx(db, 'readwrite');
      recs.forEach(r => st.put(r));
      st.transaction.oncomplete = resolve;
      st.transaction.onerror = () => reject(st.transaction.error);
    });
  }
  async function memByStory(storyId) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const st = tx(db, 'readonly');
      const req = st.index('by_story').getAll(storyId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function memDelete(id) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const st = tx(db, 'readwrite');
      st.delete(id);
      st.transaction.oncomplete = resolve;
      st.transaction.onerror = () => reject(st.transaction.error);
    });
  }
  async function memClear(storyId) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const st = tx(db, 'readwrite');
      const idx = st.index('by_story');
      const req = idx.openCursor(IDBKeyRange.only(storyId));
      req.onsuccess = () => { const cur = req.result; if (cur) { cur.delete(); cur.continue(); } };
      st.transaction.oncomplete = resolve;
      st.transaction.onerror = () => reject(st.transaction.error);
    });
  }
  async function memWipe() {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const st = tx(db, 'readwrite');
      st.clear();
      st.transaction.oncomplete = resolve;
      st.transaction.onerror = () => reject(st.transaction.error);
    });
  }

  /* 粗略 token 估算 */
  function estTokens(text) { return Math.ceil((text || '').length / PW.CONFIG.TOKEN_DIVISOR); }

  window.PW.Store = {
    uid, loadSettings, saveSettings, loadStories, saveStories, saveStoriesSoon,
    newStory, compressImage, makeSnapshot, restoreSnapshot,
    download, exportAll, exportStoryJson, exportStoryTxt,
    memPut, memByStory, memDelete, memClear, memWipe, estTokens
  };
})();
