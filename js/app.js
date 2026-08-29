/* ============ 纸上人间 · 应用主体 ============ */
(function () {
  const { createApp } = Vue;

  const app = createApp({
    data() {
      return {
        view: 'shelf',
        stories: [],
        settings: Object.assign({}, PW.DEFAULT_SETTINGS),
        story: null,
        tab: 'plot',

        /* 剧情流 */
        inputText: '',
        oocMode: false,
        busy: false,
        streamText: '',
        abortCtl: null,
        _keepPartial: false,
        summarizing: false,
        worldBusy: false,
        lastCtxEst: 0,

        /* 书架/向导 */
        showSettings: false,
        keyVisible: false,
        wizard: { open: false, step: 0, genreKey: 'modern', title: '', idea: '', worldview: '', rules: [], npcs: [], player: { name: '', gender: '女', age: '', persona: '', avatar: null }, genBusy: false },

        /* NPC */
        drawer: { open: false, ctx: 'story', index: -1, isNew: true, form: {} },
        preview: { open: false, busy: false, data: null, hint: '' },

        /* 通用弹层 */
        sheet: { open: false, title: '', preview: '', items: [] },
        confirmBox: { open: false, title: '', text: '', fn: null },
        msgEdit: { open: false, text: '', msg: null, target: 'msg' },
        snapshotOpen: false,
        guide: { open: false, step: 0, key: '' },

        /* 记忆页 */
        mem: { records: [], query: '', hits: null, summaryEdit: false, reindexing: false, reindexPct: 0, busy: false },

        /* 手机 */
        phoneView: 'home',
        wxNpc: null,
        phoneInput: '',
        wxBusy: false, moBusy: false, wbBusy: false,
        cmtFor: null, cmtText: '',
        _battery: 60 + Math.floor(Math.random() * 40),

        /* 提示 */
        toastShow: false, toastText: '', toastIcon: '✨', _toastTimer: null,
        err: { show: false, title: '', detail: '' },
        affFxList: []
      };
    },

    computed: {
      genreList() {
        const list = Object.keys(PW.TEMPLATES).map(k => ({ key: k, name: PW.TEMPLATES[k].name, emoji: PW.TEMPLATES[k].emoji }));
        list.push({ key: 'blank', name: '自由自定', emoji: '📖' });
        return list;
      },
      modelList() { return PW.CONFIG.MODELS; },
      styleList() { return PW.STYLES; },
      sortedStories() { return this.stories.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
      tabs() {
        const t = [
          { id: 'plot', em: '📖', name: '剧情' },
          { id: 'npc', em: '👥', name: '角色' },
          { id: 'world', em: '🌍', name: '世界' },
          { id: 'memory', em: '🧠', name: '记忆' }
        ];
        if (this.story && this.story.settings.phoneEnabled) t.push({ id: 'phone', em: '📱', name: '手机' });
        return t;
      },
      presentNpcs() { return this.story ? this.story.npcs.filter(n => n.present !== false) : []; },
      phoneEnabled() { return !!(this.story && this.story.settings.phoneEnabled); },
      skinStyle() {
        if (!this.story) return {};
        return { '--acc': this.story.cover.c1, '--acc2': this.story.cover.c2 };
      },
      tokenTotal() {
        if (!this.story) return '0';
        const t = (this.story.stats.promptTokens || 0) + (this.story.stats.completionTokens || 0);
        return t >= 10000 ? (t / 1000).toFixed(1) + 'k' : String(t);
      },
      worldTokens() { return this.story ? PW.Store.estTokens(this.story.worldview.text) : 0; },
      gmAvatar() { return PW.Avatars.genAvatar('GM·纸上人间', this.story ? this.story.cover.c1 : null, this.story ? this.story.cover.c2 : null); },
      playerAvSrc() {
        const p = this.story && this.story.player;
        if (!p) return null;
        if (p.avatar && p.avatar.type === 'img') return p.avatar.value;
        if (p.avatar && p.avatar.type === 'emoji') return null;
        return PW.Avatars.genAvatar((p.name || '我') + '|' + ((p.avatar && p.avatar.value) || ''), this.story.cover.c1, this.story.cover.c2);
      },
      playerAvEmoji() {
        const p = this.story && this.story.player;
        return p && p.avatar && p.avatar.type === 'emoji' ? p.avatar.value : '';
      },
      wizPlayerAv() { return this.avPair(this.wizard.player); },
      drawerAv() { return this.avPair(this.drawer.form); },
      drawerGenreKey() { return this.drawer.ctx === 'story' ? (this.story ? this.story.genreKey : 'blank') : this.wizard.genreKey; },
      streamBlocks() { return this.parseAiBlocks(this.stripLive(this.streamText)); },
      memRecent() { return this.mem.records.slice(-40).reverse(); },
      clock() {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      },
      clockShort() { return this.clock; },
      dateStr() {
        const d = new Date();
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()];
      },
      battery() { return this._battery; },
      wxUnread() {
        if (!this.story) return 0;
        let c = 0;
        Object.values(this.story.phone.chats).forEach(list => {
          const last = list[list.length - 1];
          if (last && last.role === 'npc') c++;
        });
        return c;
      },
      themeEmoji() { return this._resolvedTheme === 'dark' ? '🌙' : '☀️'; }
    },

    watch: {
      settings: { deep: true, handler() { PW.Store.saveSettings(this.settings); this.applyTheme(); } },
      stories: { deep: true, handler() { PW.Store.saveStoriesSoon(this.stories); } }
    },

    created() {
      this._aiCache = new Map();
      this.settings = PW.Store.loadSettings();
      this.stories = PW.Store.loadStories();
      this.applyTheme();
      try {
        this._media = window.matchMedia('(prefers-color-scheme: dark)');
        this._media.addEventListener('change', () => { if (this.settings.theme === 'auto') this.applyTheme(); });
      } catch (e) { /* 老浏览器忽略 */ }
    },
    mounted() {
      PW.App = this;
      if (!this.settings.guideSeen) { this.guide.open = true; }
      window.addEventListener('beforeunload', () => PW.Store.saveStories(this.stories));
    },

    methods: {
      /* ---------- 主题 ---------- */
      applyTheme() {
        let dark = this.settings.theme === 'dark';
        if (this.settings.theme === 'auto') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        this._resolvedTheme = dark ? 'dark' : 'light';
        document.documentElement.dataset.theme = this._resolvedTheme;
      },
      cycleTheme() { this.settings.theme = this._resolvedTheme === 'dark' ? 'light' : 'dark'; },

      /* ---------- 提示 ---------- */
      toast(text, icon) {
        this.toastText = text; this.toastIcon = icon || '✨'; this.toastShow = true;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { this.toastShow = false; }, 2400);
      },
      showError(e) {
        console.error(e);
        this.err.title = (e && e.code === 'NO_KEY') ? '未配置 API Key' : 'AI 请求失败';
        this.err.detail = (e && e.message) || String(e);
        if (e && e.code === 'NO_KEY') { this.err.detail = '点这里打开设置 → 填入 DeepSeek API Key'; }
        this.err.show = true;
        this.settings.lastErr = this.err.title + '：' + this.err.detail;
        setTimeout(() => { this.err.show = false; }, 6000);
      },
      confirmBoxOpen(title, text, fn) { this.confirmBox = { open: true, title, text, fn }; },
      spawnAffFx(fxList) {
        (fxList || []).forEach((fx, i) => {
          const id = PW.Store.uid('fx');
          let text, color;
          if (fx.type === 'aff') {
            if (fx.delta === 0) return;
            text = fx.npc + ' 好感 ' + (fx.delta > 0 ? '+' + fx.delta : fx.delta) + (fx.delta > 0 ? ' 💗' : ' 💔');
            color = fx.delta > 0 ? '#ff5f8f' : '#8a93a6';
          } else {
            text = fx.npc + '：' + fx.state + ' ✨';
            color = '#8ec5ff';
          }
          const style = { left: (30 + Math.random() * 38) + '%', top: '36%', color, animationDelay: (i * 0.35) + 's' };
          this.affFxList.push({ id, text, style });
          setTimeout(() => {
            const idx = this.affFxList.findIndex(x => x.id === id);
            if (idx >= 0) this.affFxList.splice(idx, 1);
          }, 2200 + i * 350);
        });
      },

      /* ---------- 书架 ---------- */
      genreName(st) {
        const t = PW.TEMPLATES[st.genreKey];
        return t ? t.name : '自由自定';
      },
      fmtRel(ts) {
        const d = Date.now() - ts;
        if (d < 60e3) return '刚刚';
        if (d < 3600e3) return Math.floor(d / 60e3) + '分钟前';
        if (d < 86400e3) return Math.floor(d / 3600e3) + '小时前';
        if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + '天前';
        return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      },
      fmtClock(ts) {
        const d = new Date(ts || Date.now());
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      },
      openStory(id) {
        this.story = this.stories.find(s => s.id === id);
        if (!this.story) return;
        this.story.updatedAt = Date.now();
        this.tab = 'plot'; this.view = 'story';
        this.phoneView = 'home'; this.wxNpc = null; this.mem.records = []; this.mem.hits = null; this.mem.query = '';
        this.loadMemRecords();
        this.$nextTick(() => this.scrollBottom(true));
      },
      backShelf() { this.view = 'shelf'; PW.Store.saveStories(this.stories); },
      askDelStory(st) {
        this.confirmBoxOpen('删除故事？', `《${st.title}》的剧情、角色与长期记忆将全部删除，不可恢复。`, async () => {
          const i = this.stories.findIndex(s => s.id === st.id);
          if (i >= 0) this.stories.splice(i, 1);
          await PW.Store.memClear(st.id);
          if (this.story && this.story.id === st.id) { this.story = null; this.view = 'shelf'; }
          this.toast('已删除', '🗑');
        });
      },

      /* ---------- 新建向导 ---------- */
      newWizard() {
        this.wizard = { open: true, step: 0, genreKey: 'modern', title: '', idea: '', worldview: '', rules: [], npcs: [], player: { name: '', gender: '女', age: '', persona: '', avatar: null }, genBusy: false };
      },
      pickGenre(key) {
        this.wizard.genreKey = key;
        const tpl = PW.TEMPLATES[key];
        if (tpl) {
          this.wizard.worldview = tpl.worldview;
          this.wizard.rules = tpl.rules.slice();
          this.wizard.npcs = tpl.npcSeeds.map(s => Object.assign({ id: PW.Store.uid('npc'), affinity: 50, present: true, avatar: null }, JSON.parse(JSON.stringify(s))));
          if (!this.wizard.title) this.wizard.title = '';
        } else {
          this.wizard.worldview = ''; this.wizard.rules = []; this.wizard.npcs = [];
        }
      },
      async aiGenWorldview() {
        const tpl = PW.TEMPLATES[this.wizard.genreKey];
        this.wizard.genBusy = true; this.wizard.worldview = '';
        try {
          await PW.Api.chat({
            messages: PW.Prompts.worldviewPrompt(tpl ? tpl.name : '自定义', this.wizard.idea),
            stream: true, temperature: 1.4,
            onDelta: (d) => { this.wizard.worldview += d; }
          });
        } catch (e) { this.showError(e); }
        finally { this.wizard.genBusy = false; }
      },
      wizAddNpcManual() {
        this.wizard.npcs.push({ id: PW.Store.uid('npc'), name: '', gender: '女', age: '', identity: '', personality: '', appearance: '', speech: '', relation: '', secret: '', greeting: '', affinity: 50, present: true, avatar: null });
        this.wizEditNpc(this.wizard.npcs.length - 1);
      },
      wizAddNpcLocal() {
        const n = PW.RandomNpc.localRandom(this.wizard.genreKey, this.wizard.npcs.map(x => x.name));
        this.wizard.npcs.push(Object.assign(n, { id: PW.Store.uid('npc'), affinity: 50, present: true }));
        this.wizEditNpc(this.wizard.npcs.length - 1);
      },
      wizEditNpc(i) {
        this.drawer = { open: true, ctx: 'wizard', index: i, isNew: true, form: Object.assign({}, this.wizard.npcs[i]) };
      },
      wizDelNpc(i) { this.wizard.npcs.splice(i, 1); },
      createStory() {
        const key = this.wizard.genreKey;
        const tpl = PW.TEMPLATES[key] || null;
        const st = PW.Store.newStory(tpl, {
          genreKey: key,
          title: this.wizard.title.trim() || (tpl ? tpl.name + '物语' : '我的故事'),
          worldview: this.wizard.worldview,
          rules: this.wizard.rules.filter(r => r && r.trim()),
          npcs: this.wizard.npcs.filter(n => n.name && n.name.trim()).map(n => Object.assign({}, n, { id: PW.Store.uid('npc') })),
          player: Object.assign({}, this.wizard.player, { name: this.wizard.player.name.trim() || '我' })
        });
        this.stories.push(st);
        this.wizard.open = false;
        this.openStory(st.id);
        this.toast('创建成功，开始你的故事吧', '🎬');
      },

      /* ---------- 头像 ---------- */
      avPair(e) {
        if (!e) return { img: null, emoji: '🙂' };
        const c1 = this.story ? this.story.cover.c1 : '#5b6c8f', c2 = this.story ? this.story.cover.c2 : '#8ea6c0';
        if (e.avatar && e.avatar.type === 'img') return { img: e.avatar.value, emoji: null };
        if (e.avatar && e.avatar.type === 'emoji') return { img: null, emoji: e.avatar.value };
        return { img: PW.Avatars.genAvatar((e.name || '新角色') + '|' + ((e.avatar && e.avatar.value) || ''), c1, c2), emoji: null };
      },
      avSrc(e) { const p = this.avPair(e); return p.img; },
      avEmoji(e) { const p = this.avPair(e); return p.emoji || ''; },
      randAvatar(form) { form.avatar = { type: 'gen', value: PW.Store.uid('av') }; },
      setAvatarEmoji(form, em) { form.avatar = { type: 'emoji', value: em }; },
      onAvatarFile(ev, form) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        PW.Store.compressImage(f, url => { form.avatar = { type: 'img', value: url }; this.toast('头像已更新', '🖼'); });
        ev.target.value = '';
      },
      emojiPoolFor(key) { return PW.Avatars.emojiPool(key); },
      npcByName(name) {
        return this.story ? this.story.npcs.find(n => n.name === name) : null;
      },
      npcPair(name) {
        const n = this.npcByName(name);
        if (n) return this.avPair(n);
        return { img: PW.Avatars.genAvatar(name, this.story ? this.story.cover.c1 : null, this.story ? this.story.cover.c2 : null), emoji: null };
      },
      npcAvSrc(name) { return this.npcPair(name).img; },
      npcAvEmoji(name) { return this.npcPair(name).emoji || ''; },

      /* ---------- NPC 管理 ---------- */
      npcTags(n) {
        return [n.identity, n.personality, n.speech].map(t => t ? String(t).slice(0, 14) : null).filter(Boolean).slice(0, 3);
      },
      affHeart(v) {
        const a = v == null ? 50 : v;
        return a >= 75 ? '💗' : a >= 45 ? '💕' : a >= 20 ? '🤍' : '💔';
      },
      npcManual() {
        this.drawer = { open: true, ctx: 'story', index: -1, isNew: true, form: { name: '', gender: '女', age: '', identity: '', personality: '', appearance: '', speech: '', relation: '', secret: '', greeting: '', affinity: 50, present: true, avatar: null } };
      },
      npcLocal() {
        const n = PW.RandomNpc.localRandom(this.story.genreKey, this.story.npcs.map(x => x.name));
        const npc = Object.assign(n, { id: PW.Store.uid('npc'), affinity: 50, present: true });
        this.story.npcs.push(npc);
        this.toast('已生成 ' + npc.name + '，可继续微调', '🎲');
        this.npcEdit(npc);
      },
      npcAiOpen() { this.preview = { open: true, busy: true, data: null, hint: '' }; this.npcAiGen(); },
      async npcAiGen() {
        this.preview.busy = true; this.preview.data = null;
        try {
          this.preview.data = await PW.RandomNpc.aiRandom(this.story, this.preview.hint);
        } catch (e) { this.showError(e); this.preview.open = false; }
        finally { this.preview.busy = false; }
      },
      confirmPreviewNpc() {
        const d = this.preview.data;
        this.story.npcs.push(Object.assign({}, d, { id: PW.Store.uid('npc'), affinity: 50, present: true }));
        this.preview.open = false;
        this.toast(d.name + ' 已加入故事', '✨');
      },
      npcEdit(n) {
        this.drawer = { open: true, ctx: 'story', index: -1, isNew: false, form: JSON.parse(JSON.stringify(n)) };
      },
      saveDrawer() {
        const f = this.drawer.form;
        if (!f.name || !f.name.trim()) { this.toast('名字总得有一个吧', '🙃'); return; }
        f.name = f.name.trim();
        if (this.drawer.ctx === 'wizard') {
          if (this.drawer.index >= 0) Object.assign(this.wizard.npcs[this.drawer.index], f);
        } else {
          if (this.drawer.isNew) {
            this.story.npcs.push(Object.assign({}, f, { id: PW.Store.uid('npc') }));
            this.toast(f.name + ' 已加入故事', '✨');
          } else {
            const t = this.story.npcs.find(n => n.id === f.id);
            if (t) Object.assign(t, f);
            this.toast('已保存', '✔');
          }
        }
        this.drawer.open = false;
      },
      askDelNpc() {
        const f = this.drawer.form;
        this.confirmBoxOpen('删除角色？', `${f.name} 将从故事中移除（相关剧情记忆保留）。`, () => {
          const i = this.story.npcs.findIndex(n => n.id === f.id);
          if (i >= 0) this.story.npcs.splice(i, 1);
          this.drawer.open = false;
          this.toast('已移除', '🗑');
        });
      },
      togglePresent(n) { n.present = n.present === false; },

      /* ---------- 世界观 ---------- */
      addRule() { this.story.worldview.rules.push(''); },
      async aiWorld(kind) {
        if (!this.story.worldview.text.trim()) { this.toast('先写一点设定，AI 才好润色', '✍️'); return; }
        const tpl = PW.TEMPLATES[this.story.genreKey];
        this.worldBusy = true;
        const orig = this.story.worldview.text;
        try {
          let acc = '';
          await PW.Api.chat({
            messages: PW.Prompts.polishPrompt(kind, orig, tpl ? tpl.name : '自定义'),
            stream: true, temperature: 1.2,
            onDelta: (d) => { acc += d; this.story.worldview.text = acc; }
          });
          this.toast(kind === 'polish' ? '润色完成' : '扩写完成', '✨');
        } catch (e) { this.story.worldview.text = orig; this.showError(e); }
        finally { this.worldBusy = false; }
      },

      /* ---------- 记忆（L3 RAG） ---------- */
      async loadMemRecords() {
        try {
          const recs = await PW.Store.memByStory(this.story.id);
          recs.sort((a, b) => a.ts - b.ts);
          this.mem.records = recs;
          PW.Rag.buildIndex(this.story.id, recs);
        } catch (e) { console.warn('memory load fail', e); this.mem.records = []; }
      },
      async addMemories(story, items) {
        if (!items || !items.length) return;
        const chapter = Math.floor(story.chat.messages.length / 24) + 1;
        const recs = items.map(it => ({
          id: PW.Store.uid('mem'), storyId: story.id,
          kind: it.kind || 'ai', speaker: it.speaker || '', text: String(it.text || '').slice(0, 800),
          ts: Date.now(), chapter, vec: null
        }));
        try { await PW.Store.memPut(recs); } catch (e) { console.warn('mem put fail', e); }
        if (this.story && story.id === this.story.id) {
          recs.forEach(r => this.mem.records.push(r));
          const idx = PW.Rag.ensureIndex(story.id, this.mem.records);
          recs.forEach(r => PW.Rag.addToIndex(idx, r));
        }
      },
      async retrieveFor() {
        const msgs = this.story.chat.messages;
        if (!msgs.length || !this.mem.records.length) return [];
        let lastUser = null, lastAi = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (!lastUser && msgs[i].kind === 'me') lastUser = msgs[i];
          if (!lastAi && msgs[i].kind === 'ai') lastAi = msgs[i];
          if (lastUser && lastAi) break;
        }
        const q = ((lastUser ? lastUser.text : '') + ' ' + (lastAi ? (lastAi.raw || lastAi.text).slice(-80) : '')).trim();
        if (!q) return [];
        try {
          const res = await PW.Rag.search(this.story.id, this.mem.records, q, this.settings.topK, this.settings.memoryMode === 'semantic');
          return res.hits.map(h => ({ rec: h.rec, label: `第${h.rec.chapter || 1}节·${this.memKindName(h.rec.kind)}${h.rec.speaker ? '·' + h.rec.speaker : ''}` }));
        } catch (e) { console.warn('retrieve fail', e); return []; }
      },
      memIcon(kind) { return { me: '🙋', ai: '📖', phone: '📱', ctrl: '⚙️', ooc: '💬' }[kind] || '📄'; },
      memKindName(kind) { return { me: '玩家', ai: '剧情', phone: '手机', ctrl: '指令', ooc: 'OOC' }[kind] || '记录'; },
      memSearch() {
        if (!this.mem.query.trim()) { this.mem.hits = null; return; }
        const useSem = this.settings.memoryMode === 'semantic' && PW.Rag.isSemanticReady();
        PW.Rag.search(this.story.id, this.mem.records, this.mem.query, this.settings.topK * 3, useSem)
          .then(res => { this.mem.hits = res.hits.map(h => h.rec); if (!this.mem.hits.length) this.toast('没有找到相关记忆', '🔍'); });
      },
      async delMem(r) {
        await PW.Store.memDelete(r.id);
        const i = this.mem.records.findIndex(x => x.id === r.id);
        if (i >= 0) this.mem.records.splice(i, 1);
        if (this.mem.hits) this.mem.hits = this.mem.hits.filter(x => x.id !== r.id);
        this.toast('该条记忆已抹去', '🗑');
      },
      clearMemAll() {
        this.confirmBoxOpen('清空全部记忆？', '本故事的长期记忆与前情提要都会被清空，剧情消息仍保留。', async () => {
          await PW.Store.memClear(this.story.id);
          this.mem.records = []; this.mem.hits = null;
          this.story.chat.summary = '';
          this.story.chat.summarizedUntil = this.story.chat.messages.length;
          this.toast('记忆已清空', '🧹');
        });
      },
      async reindexSemantic() {
        this.mem.reindexing = true; this.mem.reindexPct = 0;
        try {
          await PW.Rag.ensureEmbedder(p => { if (p < 100) this.mem.reindexPct = Math.min(p, 99); });
          await PW.Rag.reindexSemantic(this.story.id, this.mem.records, p => { this.mem.reindexPct = p; });
          this.toast('语义索引重建完成', '🧠');
        } catch (e) {
          this.showError(new Error('语义模型加载/索引失败：' + e.message + '（需要网络下载模型，或换一个网络环境重试）'));
          this.settings.memoryMode = 'bm25';
        } finally { this.mem.reindexing = false; }
      },
      async setMemoryMode(m) {
        if (m === this.settings.memoryMode) return;
        this.settings.memoryMode = m;
        if (m === 'semantic') {
          this.toast('正在下载语义模型（首次约95MB）…', '⬇️');
          this.mem.reindexing = true; this.mem.reindexPct = 0;
          try {
            await PW.Rag.ensureEmbedder(p => { this.mem.reindexPct = p || 0; });
            this.toast('模型就绪，正在为记忆生成向量…', '🧠');
            await PW.Rag.reindexSemantic(this.story ? this.story.id : '_', this.mem.records, p => { this.mem.reindexPct = p; });
            this.toast('语义记忆已启用', '✨');
          } catch (e) {
            this.settings.memoryMode = 'bm25';
            this.showError(new Error('语义模型下载失败（需要能访问 CDN/镜像的网络）。已回退到关键词模式。'));
          } finally { this.mem.reindexing = false; }
        } else {
          this.toast('已切换为关键词检索', '🔑');
        }
      },
      computeCtxEst() {
        if (!this.story) return 0;
        const s = PW.Prompts.gmSystem(this.story, { memories: [], summary: '' });
        const msgs = this.story.chat.messages;
        const until = this.story.chat.summarizedUntil || 0;
        const l1 = msgs.slice(Math.max(until, msgs.length - this.settings.recentTurns));
        let est = PW.Store.estTokens(s) + PW.Store.estTokens(this.story.chat.summary || '');
        l1.forEach(m => { est += PW.Store.estTokens(m.raw || m.text || ''); });
        est += this.settings.topK * 45;
        return Math.round(est);
      },

      /* ---------- 剧情核心 ---------- */
      stripLive(text) {
        let t = text || '';
        t = t.replace(/\[\[[^\]]*\]\]/g, '').replace(/【[^】]*】/g, '');
        t = t.replace(/\[\[[^\]]*$/, '').replace(/【[^】]*$/, '');
        t = t.replace(/\[选项\][\s\S]*$/, '');
        return t;
      },
      parseAiBlocks(text) {
        const blocks = []; let lastSp = null;
        const pn = this.story ? this.story.player.name : '';
        const sayRe = /^([^\uFF1A:\u201c\u201d\u300c\u300d]{1,8})[\uFF1A:]\s*(.+)$/;
        for (const line of (text || '').split('\n')) {
          const t = line.trim(); if (!t) continue;
          if (/^[\[\{]/.test(t)) { blocks.push({ type: 'narr', text: t }); continue; } // JSON/标记行不当台词
          const m = t.match(sayRe);
          if (m) {
            const nm = m[1].trim(); const rest = m[2];
            if (this.npcByName(nm) || nm === pn || /^[\u201c"\u300c]/.test(rest)) {
              lastSp = nm;
              const qm = rest.match(/^([\u201c"\u300c][\s\S]*?[\u201d"\u300d])([\s\S]*)$/);
              if (qm) {
                blocks.push({ type: 'say', name: nm, text: qm[1].slice(1, -1) });
                const tail = qm[2].trim();
                if (tail) blocks.push({ type: 'narr', text: tail });
              } else {
                blocks.push({ type: 'say', name: nm, text: rest.replace(/^[\u201c"\u300c]+|[\u201d"\u300d]+$/g, '') });
              }
              continue;
            }
          }
          if (/^[\u201c"\u300c]/.test(t) && lastSp) {
            const qm2 = t.match(/^([\u201c"\u300c][\s\S]*?[\u201d"\u300d])([\s\S]*)$/);
            if (qm2) {
              blocks.push({ type: 'say', name: lastSp, text: qm2[1].slice(1, -1) });
              const tail2 = qm2[2].trim();
              if (tail2) blocks.push({ type: 'narr', text: tail2 });
            } else {
              blocks.push({ type: 'say', name: lastSp, text: t.replace(/^[\u201c"\u300c]+|[\u201d"\u300d]+$/g, '') });
            }
            continue;
          }
          if (/^\u3010(\u5fae\u4fe1|\u670b\u53cb\u5708)/.test(t)) {
            blocks.push({ type: 'phonemark', text: t.indexOf('\u5fae\u4fe1') >= 0 ? '📱 微信消息已送达' : '📱 朋友圈已更新' });
            continue;
          }
          blocks.push({ type: 'narr', text: t });
        }
        return blocks;
      },
      aiBlocks(m) {
        if (!this._aiCache.has(m.id)) {
          this._aiCache.set(m.id, this.parseAiBlocks(m.text));
        }
        return this._aiCache.get(m.id);
      },
      scrollBottom(force) {
        if (this.tab !== 'plot' && !force) return;
        this.$nextTick(() => {
          const el = this.$refs.mainScroll;
          if (el) el.scrollTop = el.scrollHeight;
        });
      },
      autoGrow(e) {
        const t = e.target;
        t.style.height = 'auto';
        t.style.height = Math.min(t.scrollHeight, 110) + 'px';
      },
      inputKeydown(e, which) {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          if (which === 'phoneSend') this.phoneSend(); else this.send();
        }
      },

      async send() {
        const text = this.inputText.trim();
        if (!text || this.busy) return;
        await this.doSend(this.oocMode ? 'ooc' : 'me', text);
        this.inputText = '';
        if (this.$refs.inputBox) this.$refs.inputBox.style.height = 'auto';
      },
      async doSend(kind, text) {
        this.story.chat.messages.push({ id: PW.Store.uid('m'), kind, text, ts: Date.now() });
        this._aiCache.delete('last');
        this.scrollBottom();
        await this.streamReply(text);
      },
      gmOpening() { this.doSend('ctrl', '请为故事开场：交代时间地点与氛围，并让一位在场NPC与玩家自然相遇'); },
      continuePlot() { if (!this.busy) this.doSend('ctrl', '继续推进剧情'); },
      dice() { if (!this.busy) this.doSend('ctrl', '随机事件：请引入一个意料之外的突发状况，让剧情出现转折'); },
      useChoice(m, ci) {
        if (this.busy) return;
        m.choicesUsed = true;
        this.doSend('me', m.choices[ci]);
      },
      reroll() {
        if (this.busy) return;
        const msgs = this.story.chat.messages;
        if (msgs.length && msgs[msgs.length - 1].kind === 'ai') { msgs.pop(); }
        this.streamReply(null);
      },
      regenerateFrom(m) {
        if (this.busy) return;
        const i = this.story.chat.messages.findIndex(x => x.id === m.id);
        if (i >= 0) this.story.chat.messages.splice(i);
        this.streamReply(null);
      },

      async streamReply(userText) {
        if (this.busy) return;
        if (!this.settings.apiKey) {
          this.showError({ code: 'NO_KEY', message: '点这里打开设置 → 填入 DeepSeek API Key' });
          this.showSettings = true;
          return;
        }
        this.busy = true; this.streamText = '';
        this.abortCtl = new AbortController();
        const signal = this.abortCtl.signal;
        try {
          const retrieved = await this.retrieveFor();
          const messages = await PW.Prompts.build(this.story, userText, retrieved);
          this._lastMessages = messages;
          const { content, usage } = await PW.Api.chat({
            messages, signal,
            onDelta: (d, full) => {
              this.streamText = full;
              this.scrollBottom();
            }
          });
          this.finalize(content, usage);
        } catch (e) {
          if (e.name === 'AbortError') {
            if (this._keepPartial && this.streamText.length > 30) { this.finalize(this.streamText + '\n（……）', null); this.toast('已停止，保留半截剧情', '✋'); }
            else this.toast('已停止', '✋');
          } else this.showError(e);
        } finally {
          this._keepPartial = false;
          this.busy = false; this.streamText = ''; this.abortCtl = null;
          this.lastCtxEst = this.computeCtxEst();
          this.scrollBottom();
          this.doSummary(false);
        }
      },
      stopStream() {
        if (this.abortCtl) {
          this._keepPartial = true;
          this.abortCtl.abort();
        }
      },
      finalize(rawContent, usage) {
        const story = this.story;
        const raw = (rawContent || '').trim();
        if (!raw) return;
        const parsed = PW.Affinity.parse(raw);
        const phone = this.extractPhoneMarks(parsed.clean);
        const sc = this.stripChoices(phone.clean);
        const msg = { id: PW.Store.uid('m'), kind: 'ai', text: sc.text.trim(), raw, ts: Date.now(), choices: sc.choices, choicesUsed: false };
        story.chat.messages.push(msg);
        this._aiCache.set(msg.id, this.parseAiBlocks(msg.text));
        this.addMemories(story, [{ kind: 'ai', speaker: 'GM', text: raw.slice(0, 800) }]);
        this.routePhoneMarks(phone.marks);
        const fx = PW.Affinity.apply(story, { affs: parsed.affs, states: parsed.states });
        this.spawnAffFx(fx);
        story.progressNote = msg.text.replace(/\s+/g, ' ').slice(-42);
        if (usage && usage.prompt_tokens) {
          story.stats.calls = (story.stats.calls || 0) + 1;
          story.stats.promptTokens = (story.stats.promptTokens || 0) + (usage.prompt_tokens || 0);
          story.stats.completionTokens = (story.stats.completionTokens || 0) + (usage.completion_tokens || 0);
        } else {
          story.stats.calls = (story.stats.calls || 0) + 1;
          const promptText = (this._lastMessages || []).map(m => m.content || '').join('');
          story.stats.promptTokens = (story.stats.promptTokens || 0) + PW.Store.estTokens(promptText);
          story.stats.completionTokens = (story.stats.completionTokens || 0) + PW.Store.estTokens(raw);
        }
        this.scrollBottom();
      },
      extractPhoneMarks(text) {
        const marks = [];
        const re = /\u3010(\u5fae\u4fe1|\u670b\u53cb\u5708)\uFF5C([^\uFF5C|\u3011]+)\uFF5C([^\u3011]+)\u3011/g;
        const clean = text.replace(re, (_, type, name, content) => {
          marks.push({ type, name: name.trim(), content: content.trim() });
          return '';
        });
        return { clean: clean.replace(/\n{3,}/g, '\n\n'), marks };
      },
      stripChoices(text) {
        const idx = text.indexOf('[选项]');
        if (idx < 0) return { text, choices: null };
        const head = text.slice(0, idx).trim();
        const tail = text.slice(idx);
        const choices = tail.split('\n').slice(1)
          .map(l => l.replace(/^\s*\d+\s*[.、\)）]\s*/, '').trim())
          .filter(s => s && s.length <= 30).slice(0, 4);
        return { text: head, choices: choices.length ? choices : null };
      },
      routePhoneMarks(marks) {
        const story = this.story;
        (marks || []).forEach(mk => {
          const npc = story.npcs.find(n => n.name === mk.name) || this.presentNpcs[0];
          if (!npc) return;
          if (mk.type === '微信') {
            const list = story.phone.chats[npc.id] || (story.phone.chats[npc.id] = []);
            list.push({ id: PW.Store.uid('w'), role: 'npc', text: mk.content, ts: Date.now() });
            story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 微信 · ${npc.name}：${mk.content.slice(0, 30)}`, ts: Date.now() });
            this.addMemories(story, [{ kind: 'phone', speaker: npc.name, text: `（微信上${npc.name}发来）${mk.content}` }]);
          } else {
            story.phone.moments.unshift({ id: PW.Store.uid('mo'), npcId: npc.id, name: npc.name, text: mk.content, ts: Date.now(), likes: Math.floor(Math.random() * 30), likedByMe: false, comments: [] });
          }
        });
      },
      async doSummary(force) {
        if (this.summarizing || !this.settings.apiKey) return;
        this.summarizing = true;
        try {
          const story = this.story;
          const msgs = story.chat.messages;
          const until = story.chat.summarizedUntil || 0;
          const keep = this.settings.recentTurns;
          if (!force && msgs.length - until < keep + PW.CONFIG.SUMMARY_EVERY) return;
          const cut = force ? Math.max(until, msgs.length - keep) : msgs.length - keep;
          if (cut <= until) return;
          const slice = msgs.slice(until, cut);
          if (!slice.length) return;
          const texts = slice.map(m =>
            m.kind === 'me' ? `玩家：${m.text}` :
            m.kind === 'ai' ? 'GM：' + (m.raw || m.text).slice(0, 140) :
            m.text
          ).join('\n');
          const { content } = await PW.Api.chat({
            messages: PW.Prompts.summaryPrompt(story, story.chat.summary, texts),
            stream: false, temperature: 0.6
          });
          if (content && content.trim().length >= PW.CONFIG.MIN_SUMMARY_LEN) {
            story.chat.summary = content.trim();
            story.chat.summarizedUntil = cut;
            this.lastCtxEst = this.computeCtxEst();
            this.toast('旧剧情已压缩成前情提要，token 省下来了', '🧠');
          }
        } catch (e) { /* 摘要失败静默，下次再试 */ }
        finally { this.summarizing = false; }
      },
      async resummarize() {
        if (!this.story.chat.messages.length) { this.toast('还没有剧情可压缩', '📜'); return; }
        this.mem.busy = true;
        await this.doSummary(true);
        this.mem.busy = false;
        if (!this.summarizing) this.toast('前情提要已更新', '📜');
      },

      /* ---------- 消息操作 ---------- */
      pressStart(e, m) { this._pt = setTimeout(() => { this.openMsgSheet(m); }, 480); },
      pressCancel() { clearTimeout(this._pt); },
      openMsgSheet(m) {
        const items = [
          { icon: '📋', label: '复制', fn: () => this.copyMsg(m) },
          { icon: '✏️', label: '编辑', fn: () => { this.msgEdit = { open: true, text: m.text, msg: m, target: 'msg' }; } }
        ];
        if (m.kind === 'ai') {
          items.push({ icon: '↻', label: '重掷本条', fn: () => this.regenerateFrom(m) });
        }
        items.push({ icon: '✂️', label: '删掉它及之后，重新发展', fn: () => this.regenerateFrom(m) });
        items.push({ icon: '🗑', label: '删除这条', danger: true, fn: () => {
          const i = this.story.chat.messages.findIndex(x => x.id === m.id);
          if (i >= 0) this.story.chat.messages.splice(i, 1);
        } });
        this.sheet = { open: true, title: '', preview: (m.text || '').slice(0, 90), items };
      },
      copyMsg(m) {
        const done = () => this.toast('已复制', '📋');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m.text).then(done).catch(() => this.fallbackCopy(m.text, done));
        else this.fallbackCopy(m.text, done);
      },
      fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { this.toast('复制失败', '⚠️'); }
        ta.remove();
      },
      saveMsgEdit() {
        if (this.msgEdit.target === 'story') {
          this.story.title = this.msgEdit.text.trim() || this.story.title;
        } else if (this.msgEdit.msg) {
          this.msgEdit.msg.text = this.msgEdit.text;
          if (this.msgEdit.msg.kind === 'ai') { this.msgEdit.msg.raw = this.msgEdit.text; this._aiCache.delete(this.msgEdit.msg.id); this._aiCache.set(this.msgEdit.msg.id, this.parseAiBlocks(this.msgEdit.text)); }
        }
        this.msgEdit.open = false;
        this.toast('已保存', '✔');
      },

      /* ---------- 存档 ---------- */
      makeSnap() {
        PW.Store.makeSnapshot(this.story, null);
        this.toast('存档成功', '📸');
      },
      restoreSnap(s) {
        this.confirmBoxOpen('回溯到这个存档？', `剧情将回到「${s.label}」，之后的内容不会删除记忆库，但消息流会被替换。`, () => {
          PW.Store.restoreSnapshot(this.story, s.id);
          this._aiCache.clear();
          this.snapshotOpen = false;
          this.toast('已回溯', '⏪');
          this.scrollBottom(true);
        });
      },
      delSnap(s) {
        const i = this.story.snapshots.findIndex(x => x.id === s.id);
        if (i >= 0) this.story.snapshots.splice(i, 1);
      },

      /* ---------- 菜单 ---------- */
      storyMenu() {
        const items = [];
        if (this.phoneEnabled) items.push({ icon: '📱', label: '打开手机世界', fn: () => { this.tab = 'phone'; this.phoneView = 'home'; } });
        items.push(
          { icon: '⚙️', label: '设置（API Key / 接口地址）', fn: () => { this.showSettings = true; } },
          { icon: '🧹', label: '清空剧情（保留设定与角色）', fn: () => this.askClearPlot() },
          { icon: '✏️', label: '重命名故事', fn: () => { this.msgEdit = { open: true, text: this.story.title, msg: null, target: 'story' }; } },
          { icon: '📚', label: '导出小说 txt', fn: () => PW.Store.exportStoryTxt(this.story) },
          { icon: '📄', label: '导出故事 JSON（含记忆）', fn: async () => {
              const st = JSON.parse(JSON.stringify(this.story));
              st._mem = this.mem.records;
              PW.Store.download((st.title || '故事') + '-完整备份.json', JSON.stringify(st, null, 1));
            } },
          { icon: '🏠', label: '回到书架', fn: () => this.backShelf() },
          { icon: '🗑', label: '删除整个故事', danger: true, fn: () => this.askDelStory(this.story) }
        );
        this.sheet = { open: true, title: '', preview: '', items };
      },

      askClearPlot() {
        this.confirmBoxOpen('清空剧情？', '消息记录与前情提要将被清空，世界观、角色和记忆库保留。', async () => {
          this.story.chat.messages = [];
          this.story.chat.summary = '';
          this.story.chat.summarizedUntil = 0;
          this._aiCache.clear();
          this.toast('剧情已清空，重新开始吧', '🧹');
        });
      },

      /* ---------- 导入导出 ---------- */
      async exportAllData() {
        const stories = [];
        for (const s of this.stories) {
          const copy = JSON.parse(JSON.stringify(s));
          try { copy._mem = await PW.Store.memByStory(s.id); } catch (e) { copy._mem = []; }
          stories.push(copy);
        }
        PW.Store.exportAll(stories, this.settings);
        this.toast('备份已下载（含全部故事与长期记忆）', '📦');
      },
      importFile(ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const data = JSON.parse(reader.result);
            let incoming = [];
            if (Array.isArray(data.stories)) incoming = data.stories;
            else if (data.id && data.chat) incoming = [data];
            let added = 0;
            for (const raw of incoming) {
              const st = Object.assign(JSON.parse(JSON.stringify(raw)), {});
              if (this.stories.some(s => s.id === st.id)) st.id = PW.Store.uid('st');
              this.stories.push(st);
              added++;
              if (Array.isArray(st._mem) && st._mem.length) {
                const recs = st._mem.map(r => Object.assign({}, r, { storyId: st.id }));
                try { await PW.Store.memPut(recs); } catch (e) { /* ignore */ }
                delete st._mem;
              }
            }
            this.showSettings = false;
            this.toast(added ? `已导入 ${added} 个故事` : '备份里没有找到故事', added ? '📥' : '🤔');
          } catch (e) { this.toast('备份文件解析失败', '⚠️'); }
        };
        reader.readAsText(f, 'utf-8');
        ev.target.value = '';
      },
      askClearAll() {
        this.confirmBoxOpen('清空所有数据？', '所有故事、设置与记忆都将被删除且无法恢复。强烈建议先导出备份。', async () => {
          await PW.Store.memWipe();
          this.stories = [];
          this.story = null;
          this.view = 'shelf';
          localStorage.removeItem(PW.CONFIG.DATA_KEY + '.stories');
          this.toast('已清空', '🧹');
        });
      },

      /* ---------- 手机 ---------- */
      goPhone() { this.tab = 'phone'; this.phoneView = 'home'; },
      npcById(id) { return this.story ? this.story.npcs.find(n => n.id === id) : null; },
      openWx(n) { this.wxNpc = n; this.phoneView = 'wxchat'; this.phoneInput = ''; this.$nextTick(() => this.scrollWx()); },
      wxList(n) { return (this.story.phone.chats[n.id] || []); },
      wxLastMsg(n) {
        const l = this.wxList(n);
        const last = l[l.length - 1];
        if (!last) return '';
        return (last.role === 'me' ? '我：' : '') + last.text.slice(0, 24);
      },
      wxLastTime(n) {
        const l = this.wxList(n);
        return l.length ? this.fmtClock(l[l.length - 1].ts) : '';
      },
      scrollWx() {
        const el = this.$refs.wxScroll;
        if (el) el.scrollTop = el.scrollHeight;
      },
      async phoneSend() {
        const text = this.phoneInput.trim();
        if (!text || this.wxBusy || !this.wxNpc) return;
        this.phoneInput = '';
        this.wxBusy = true;
        this.$nextTick(() => this.scrollWx());
        try {
          await PW.Phone.wechatSend(this.story, this.wxNpc, text);
        } catch (e) { this.showError(e); }
        finally { this.wxBusy = false; this.$nextTick(() => this.scrollWx()); }
      },
      async refreshMoments() {
        this.moBusy = true;
        try {
          const n = await PW.Phone.genMoments(this.story, 3);
          this.toast(n.length ? `收到 ${n.length} 条新动态` : 'NPC 们暂时没发动态', '🌸');
        } catch (e) { this.showError(e); }
        finally { this.moBusy = false; }
      },
      toggleLike(mo) { mo.likedByMe = !mo.likedByMe; mo.likes += mo.likedByMe ? 1 : -1; },
      async sendCmt(mo) {
        const text = this.cmtText.trim();
        if (!text || this.moBusy) return;
        this.cmtText = '';
        this.moBusy = true;
        try { await PW.Phone.commentMoment(this.story, mo, text); }
        catch (e) { this.showError(e); }
        finally { this.moBusy = false; }
      },
      async refreshWeibo() {
        this.wbBusy = true;
        try { await PW.Phone.genWeibo(this.story); this.toast('热搜已更新', '🔥'); }
        catch (e) { this.showError(e); }
        finally { this.wbBusy = false; }
      },

      /* ---------- Tab 切换 ---------- */
      switchTab(id) {
        this.tab = id;
        if (id === 'memory') { this.lastCtxEst = this.computeCtxEst(); }
        if (id === 'plot') this.scrollBottom();
      },

      /* ---------- 引导 ---------- */
      guideNext() {
        if (this.guide.step < 2) {
          if (this.guide.step === 1 && this.guide.key.trim()) this.settings.apiKey = this.guide.key.trim();
          this.guide.step++;
        } else this.finishGuide();
      },
      finishGuide() {
        this.settings.guideSeen = true;
        if (this.guide.key.trim()) this.settings.apiKey = this.guide.key.trim();
        this.guide.open = false;
        if (!this.stories.length) this.newWizard();
      }
    }
  });

  app.mount('#app');
})();
