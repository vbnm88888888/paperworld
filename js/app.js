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
        newModelId: '',
        wizard: { open: false, step: 0, genreKey: 'blank', title: '', idea: '', worldview: '', rules: [], npcs: [], player: { name: '', gender: '女', age: '', persona: '', avatar: null }, genBusy: false },

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
        wxTab: 'chat',
        wbTab: 'feed',
        wxProBusy: false,
        wbDetail: null,        // {title, tag} 热搜详情 或 {name, type} 超话
        wbDetailKind: '',      // 'hot' | 'cha'
        wbDetailBusy: false,
        wbDetailPosts: [],
        wxGroup: null,
        groupBusy: false,
        groupModal: { open: false, name: '', memberIds: [] },
        moCompose: '',
        wbCompose: '',
        chaModal: { open: false, name: '', type: '个人', memberIds: [] },
        replyFor: null,        // 正在回复的评论id
        replyText: '',
        replyBusy: false,
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
        return [{ key: 'blank', name: '自由自定', emoji: '📖' }];
      },
      modelList() { return PW.CONFIG.MODELS; },
      allModels() {
        const custom = (this.settings.customModels || []).map(id => ({ id, name: id + ' · 自定义' }));
        return PW.CONFIG.MODELS.concat(custom);
      },
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
      coreTokens() { return this.story ? PW.Store.estTokens(this.story.coreInstruction || '') : 0; },
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
      streamBlocks() {
        const stripped = this.stripLive(this.streamText);
        if (this.story && this.story.useNineFormat) {
          return [{ type: 'doc', html: this.mdDoc(stripped) }];
        }
        return [{ type: 'main', blocks: this.parseAiBlocks(stripped) }];
      },
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
    },

    methods: {
      /* ---------- 主题 ---------- */
      /* ---------- 主题与外观 ---------- */
      applyTheme() {
        let dark = this.settings.theme === 'dark';
        if (this.settings.theme === 'auto') dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        this._resolvedTheme = dark ? 'dark' : 'light';
        document.documentElement.dataset.theme = this._resolvedTheme;
        document.documentElement.classList.toggle('has-bg', !!(this.settings.bg && this.settings.bg.img));
        // 剧情字号
        document.documentElement.style.setProperty('--plot-font', (this.settings.plotFont || 17) + 'px');
        // 自定义背景
        let bgEl = document.getElementById('app-bg');
        const bg = this.settings.bg;
        if (bg && bg.img) {
          if (!bgEl) {
            bgEl = document.createElement('div');
            bgEl.id = 'app-bg';
            document.body.insertBefore(bgEl, document.body.firstChild);
          }
          bgEl.style.backgroundImage = 'url(' + bg.img + ')';
          bgEl.style.opacity = bg.opacity;
          bgEl.style.filter = 'blur(' + (bg.blur || 0) + 'px)';
          bgEl.style.display = 'block';
        } else if (bgEl) {
          bgEl.style.display = 'none';
        }
      },
      onBgFile(ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        PW.Store.compressImage(f, 1024, url => {
          if (!this.settings.bg) this.settings.bg = { img: '', opacity: 0.35, blur: 0 };
          this.settings.bg = { img: url, opacity: 0.35, blur: 0 };
          this.applyTheme();
          this.toast('背景已更换', '🖼');
        });
        ev.target.value = '';
      },
      clearBg() {
        this.settings.bg = { img: '', opacity: 0.35, blur: 0 };
        this.applyTheme();
      },
      cycleTheme() { this.settings.theme = this._resolvedTheme === 'dark' ? 'light' : 'dark'; },
      addCustomModel() {
        const id = (this.newModelId || '').trim();
        if (!id) return;
        if (!this.settings.customModels) this.settings.customModels = [];
        if (this.settings.customModels.includes(id)) { this.toast('这个模型ID已经在列表里了', '🙃'); return; }
        this.settings.customModels.push(id);
        this.settings.model = id;
        this.newModelId = '';
        this.toast('已添加并切换到 ' + id, '🤖');
      },
      removeCustomModel(id) {
        this.settings.customModels = this.settings.customModels.filter(m => m !== id);
        if (this.settings.model === id) this.settings.model = 'deepseek-v4-flash';
      },

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
      /* ---------- 轻量Markdown渲染（安全：先转义再生成标签） ---------- */
      md(text) {
        let t = String(text == null ? '' : text);
        t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
        t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
        t = t.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
        t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
        t = t.replace(/\*/g, '');
        return t;
      },
      /* ---------- 剧情图标动态化 ---------- */
      iconFor(text, fallback) {
        const t = String(text || '');
        const MAP = [
          [/尸|丧尸|行尸|尸潮/, '🧟'], [/夜|深夜|黑暗|凌晨|月光/, '🌙'], [/雨|暴雨|雷|阴天/, '🌧'],
          [/战斗|攻击|枪|刀|打斗|子弹|厮杀/, '⚔️'], [/医院|医疗|救治|药|伤口/, '🏥'], [/学校|校园|教室|课堂/, '🏫'],
          [/车|开车|公路|驾车/, '🚗'], [/店|超市|便利店|商场|市场/, '🏪'], [/森林|树林|山|野外|丛林/, '🌲'],
          [/火|燃烧|爆炸|起火/, '🔥'], [/河|海|湖|水/, '🌊'], [/公寓|房间|大楼|家|卧室|客厅/, '🏢'],
          [/吃|饭|食物|罐头|厨房/, '🍽'], [/搜刮|物资|补给/, '📦'], [/广播|通讯|电台|对讲/, '📻'],
          [/死|血|尸体|白骨/, '💀'], [/心动|亲密|吻|拥抱|恋爱/, '💗'], [/电脑|手机|信号|网络/, '📡'],
          [/狗|猫|宠物|动物/, '🐾'], [/门|走廊|楼梯|地下室/, '🚪']
        ];
        for (const pair of MAP) { if (pair[0].test(t)) return pair[1]; }
        return fallback || '📜';
      },
      /* ---------- 群聊删除 ---------- */
      askDelGroup(g) {
        this.confirmBoxOpen('删除群聊？', '「' + g.name + '」的群聊记录将一并删除（剧情主线不受影响）。', () => {
          const i = this.story.phone.groups.findIndex(x => x.id === g.id);
          if (i >= 0) this.story.phone.groups.splice(i, 1);
          delete this.story.phone.chats[g.id];
          if (this.wxGroup && this.wxGroup.id === g.id) { this.wxGroup = null; this.phoneView = 'wx'; }
          this.toast('群聊已删除', '🗑');
        });
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
        const st = this.story;
        /* 旧数据字段补全 */
        if (st.coreInstruction == null) st.coreInstruction = '';
        if (st.useCoreInstruction == null) st.useCoreInstruction = false;
        if (!st.phone) st.phone = {};
        if (!st.phone.chats) st.phone.chats = {};
        if (!st.phone.moments) st.phone.moments = [];
        if (!st.phone.follows) st.phone.follows = {};
        if (!st.phone.weibo) st.phone.weibo = {};
        if (!Array.isArray(st.phone.weibo.hot)) st.phone.weibo.hot = [];
        if (!Array.isArray(st.phone.weibo.posts)) st.phone.weibo.posts = [];
        if (!Array.isArray(st.phone.weibo.supertopics)) st.phone.weibo.supertopics = [];
        if (!Array.isArray(st.phone.groups)) st.phone.groups = [];
        if (st.settings.styleNote == null) st.settings.styleNote = '';
        if (st.outputFormat == null) st.outputFormat = '';
        if (!st.nineFmt) st.nineFmt = {};
        if (st.useNineFormat == null) st.useNineFormat = false;
        if (st.settings.fandom == null) st.settings.fandom = (st.genreKey === 'entertainment');
        st.updatedAt = Date.now();
        this.tab = 'plot'; this.view = 'story';
        this.phoneView = 'home'; this.wxTab = 'chat'; this.wbTab = 'feed';
        this.wxNpc = null; this.mem.records = []; this.mem.hits = null; this.mem.query = '';
        this._auto = {};
        this._phoneAutoDone = {};
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
        return a >= 75 ? '💗' : a >= 45 ? '💕' : a >= 15 ? '🤍' : a > -40 ? '💢' : '🖤';
      },
      affBarStyle(v) {
        const a = v == null ? 50 : v;
        if (a >= 0) {
          return { left: '50%', width: (a / 2) + '%', background: 'linear-gradient(90deg,#f778ba,#e5484d)' };
        }
        return { right: '50%', left: (50 + a / 2) + '%', width: (-a / 2) + '%', background: 'linear-gradient(90deg,#5a3b8f,#b8323c)' };
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
          scope: it.scope || 'plot',
          ts: Date.now(), chapter, vec: null
        }));
        try { await PW.Store.memPut(recs); } catch (e) { console.warn('mem put fail', e); }
        if (this.story && story.id === this.story.id) {
          recs.forEach(r => this.mem.records.push(r));
          const idx = PW.Rag.ensureIndex(story.id, this.mem.records);
          recs.forEach(r => PW.Rag.addToIndex(idx, r));
          // 保存时即时向量化（RAG）：语义模式已就绪则后台增量embed，不阻塞剧情
          if (this.settings.memoryMode === 'semantic' && PW.Rag.isSemanticReady()) {
            PW.Rag.embedRecords(recs).catch(e => console.warn('incremental embed fail', e));
          }
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
        return this._doRetrieve(q);
      },
      /* 共享记忆检索（四场景互通，但按端隔离：微信不见微博舆论） */
      async retrieveMemories(query, scopes, speaker) {
        if (!query) return [];
        var pool = this.mem.records;
        if (scopes && scopes.length) {
          /* 端隔离：剧情记忆(plot)对所有端可见，其余只允许本端的记忆；
             * 微信内再按说话人隔离：和NPC2聊天时，不把NPC1的微信记忆喂给NPC2，
             * 否则NPC2会"以为"NPC1做的事/说的话是自己干的。 */
          pool = pool.filter(r => {
            if (!r.scope || r.scope === 'plot') return true;
            if (scopes.indexOf(r.scope) < 0) return false;
            // 端内按说话人隔离：和NPC2聊天时，只保留 剧情(plot) + NPC2自己的微信记忆
            // + 玩家发给NPC2的微信消息(text里含NPC2名字)。这样NPC1的微信记忆不会漏给NPC2。
            return !speaker || r.speaker === speaker || String(r.text || '').indexOf(speaker) >= 0;
          });
        }
        if (!pool.length) return [];
        return this._doRetrieve(query, pool);
      },
      /* 统一记忆块格式化（手机各模块共用一个入口，保证格式一致） */
      async memoryBlock(query, scopes, speaker) {
        if (!query) return '';
        try {
          const hits = await this.retrieveMemories(query, scopes, speaker);
          if (!hits || !hits.length) return '';
          return hits.slice(0, 3).map(h => '· [' + (h.label || '记忆') + '] ' + String(h.rec.text || '').slice(0, 100)).join(' ｜ ');
        } catch (e) { return ''; }
      },
      async _doRetrieve(q, pool) {
        try {
          const recs = pool || this.mem.records;
          if (!recs.length) return [];
          const res = await PW.Rag.search(this.story.id, recs, q, this.settings.topK, this.settings.memoryMode === 'semantic');
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
        /* L2 前情提要已停用：剧情全量原文都计入上下文估算 */
        let est = PW.Store.estTokens(s);
        msgs.forEach(m => { est += PW.Store.estTokens(m.raw || m.text || ''); });
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
            let nm = m[1].trim(); const rest = m[2];
            /* "林晚冲你眨眨眼：" 这种带动作的说话前缀 → 归一到NPC名 */
            let speaker = null;
            if (this.npcByName(nm) || nm === pn) speaker = nm;
            else {
              const pref = (this.story ? this.story.npcs : []).find(n => n.name && nm.startsWith(n.name) && nm.length <= n.name.length + 6);
              if (pref) speaker = pref.name;
            }
            if (speaker || /^[\u201c"\u300c]/.test(rest)) {
              lastSp = speaker || nm;
              const qm = rest.match(/^([\u201c"\u300c][\s\S]*?[\u201d"\u300d])([\s\S]*)$/);
              if (qm) {
                blocks.push({ type: 'say', name: lastSp, text: qm[1].slice(1, -1) });
                const tail = qm[2].trim();
                if (tail) blocks.push({ type: 'narr', text: tail });
              } else {
                blocks.push({ type: 'say', name: lastSp, text: rest.replace(/^[\u201c"\u300c]+|[\u201d"\u300d]+$/g, '') });
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
          /* 叙述中内嵌台词：扫描NPC名，"……沈砚：「台词」……" 拆为 旁白+台词(+尾巴) */
          let npcHit = null;
          for (const n of (this.story ? this.story.npcs : [])) {
            if (!n.name) continue;
            let i = t.indexOf(n.name + '：');
            if (i < 0) i = t.indexOf(n.name + ':');
            if (i < 0) continue;
            const after = t.slice(i + n.name.length + 1);
            const qm3 = after.match(/^[\s]*([\u201c\u300c"][^\u201d\u300d"]*[\u201d\u300d"])/);
            if (qm3) { npcHit = { npc: n, pre: t.slice(0, i), quote: qm3[1], tail: after.slice(qm3[0].length) }; break; }
          }
          if (npcHit) {
            const pre = npcHit.pre.trim();
            if (pre) blocks.push({ type: 'narr', text: pre });
            blocks.push({ type: 'say', name: npcHit.npc.name, text: npcHit.quote.slice(1, -1) });
            const tail3 = npcHit.tail.trim();
            if (tail3) blocks.push({ type: 'narr', text: tail3 });
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
          if (this.story && this.story.useNineFormat) {
            this._aiCache.set(m.id, [{ type: 'doc', html: this.mdDoc(this.stripLive(m.text)) }]);
          } else {
            this._aiCache.set(m.id, [{ type: 'main', blocks: this.parseAiBlocks(m.text) }]);
          }
        }
        return this._aiCache.get(m.id);
      },
      /* 整块Markdown文档渲染（自定义输出格式模式） */
      mdDoc(text) {
        const inline = (s) => {
          let t = String(s == null ? '' : s);
          t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
          t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
          t = t.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
          t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
          t = t.replace(/\*/g, '');
          return t;
        };
        const lines = String(text || '').split('\n');
        let html = '', para = [], quote = [];
        const flush = () => {
          if (quote.length) {
            html += '<div class="md-quote">' + quote.map(l => '<div class="md-quote-line">' + inline(l) + '</div>').join('') + '</div>';
            quote = [];
          }
          if (para.length) {
            html += '<div class="md-p">' + para.map(p => '<div class="md-line ' + p.cls + '">' + inline(p.text) + '</div>').join('') + '</div>';
            para = [];
          }
        };
        for (const raw of lines) {
          const l = raw.trim();
          if (!l) { flush(); continue; }
          if (/^[-—_=∙•\s]{4,}$/.test(l)) { flush(); html += '<hr>'; continue; }
          if (l.startsWith('>')) { if (para.length) flush(); quote.push(l.replace(/^>\s?/, '')); continue; }
          if (/^#{1,6}\s/.test(l)) { flush(); html += '<div class="md-h">' + inline(l.replace(/^#+\s*/, '')) + '</div>'; continue; }
          const cls = /✅|☑|^\[\s*x?\s*\]/i.test(l) ? 'md-check' : (/🔹/.test(l) ? 'md-aff-line' : '');
          para.push({ text: l, cls });
        }
        flush();
        return html;
      },
      /* 整段文本中的好感度行同步（自定义格式模式） */
      syncAffFromText(text) {
        const re = /🔹\s*([^：:\s|]{1,12})[：:]\s*好感度\s*(-?\d+)\s*%?/g;
        let m;
        while ((m = re.exec(text || '')) !== null) {
          const npc = this.npcByName(m[1].trim());
          if (npc) {
            const v = Math.max(-100, Math.min(100, parseInt(m[2], 10) || 0));
            if (npc.affinity !== v) npc.affinity = v;
          }
        }
      },
      /* ---- 结构化格式解析（9条格式 → 卡片；无标记时整体作为正文） ---- */
      insertNineTemplate() {
        this.story.outputFormat = PW.NINE_TEMPLATE;
        this.toast('已插入九段式模板，可自由改写', '📋');
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
          if (which === 'phoneSend') this.phoneSend();
          else if (which === 'groupSend') this.sendGroupMsg();
          else this.send();
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
        /* 乱文检测：长文本但标点密度异常低 → 提示重掷，防止污染后续生成 */
        const punct = (sc.text.match(/[，。！？；…：""「」、]/g) || []).length;
        if (sc.text.length > 300 && punct / sc.text.length < 0.04) {
          msg.garbled = true;
          this.toast('⚠️ 本条生成质量异常（标点密度过低），建议长按重掷', '⚠️');
        }
        story.chat.messages.push(msg);
        this._aiCache.set(msg.id, this.aiBlocks(msg));
        /* 同步好感度（卡片模式/自定义格式模式通用） */
        this.syncAffFromText(raw);
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
        /* L2 前情提要已停用：剧情全量原文进上下文，避免压缩丢失细节。保留空实现以兼容旧调用。 */
      },
      async resummarize() {
        this.toast('前情提要已停用：剧情全程携带原文，不会丢失细节', '📜');
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
      openWxApp() {
        this.phoneView = 'wx'; this.wxTab = 'chat';
        // 每次进入微信都可能有NPC主动发来消息（条数随机1~3），wxProBusy 防重入
        this.proactiveWx(true);
      },
      openWbApp() {
        this.phoneView = 'weibo'; this.wbTab = 'feed';
        if (!this._auto.wb) { this._auto.wb = true; if (!this.story.phone.weibo.posts.length) this.refreshWeibo(true); }
      },
      ensureMoments() {
        if (!this._auto.mo) { this._auto.mo = true; if (!this.story.phone.moments.length) this.refreshMoments(true); }
      },
      async proactiveWx(silent) {
        if (this.wxProBusy || !this.settings.apiKey || !this.presentNpcs.length) return;
        this.wxProBusy = true;
        try {
          const r = await PW.Phone.proactiveWechat(this.story);
          this.toast('📱 ' + r.npc.name + '：' + ((r.msgs[0] && r.msgs[0].text) || '').slice(0, 18), '💬');
        } catch (e) { if (!silent) this.showError(e); }
        finally { this.wxProBusy = false; }
      },
      isFollowed(id) { return !!(this.story && this.story.phone.follows && this.story.phone.follows[id]); },
      toggleFollow(id) {
        const f = this.story.phone.follows;
        if (f[id]) { delete f[id]; this.toast('已取消关注', '💔'); }
        else { f[id] = true; this.toast('关注成功，TA的动态会优先出现', '💚'); }
      },

      /* ---------- 微信群聊 ---------- */
      groupMembers(g) {
        return (g.memberIds || []).map(id => this.npcById(id)).filter(Boolean);
      },
      openGroupModal() {
        this.groupModal = { open: true, name: '', memberIds: this.presentNpcs.slice(0, 2).map(n => n.id) };
      },
      toggleGroupMember(id) {
        const arr = this.groupModal.memberIds;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1); else arr.push(id);
      },
      createGroup() {
        const name = (this.groupModal.name || '').trim() || (this.groupModal.memberIds.length + '人群');
        if (this.groupModal.memberIds.length < 1) { this.toast('至少选1个成员', '🙃'); return; }
        const g = { id: PW.Store.uid('grp'), name, memberIds: this.groupModal.memberIds.slice() };
        this.story.phone.groups.push(g);
        this.groupModal.open = false;
        this.toast('群聊「' + name + '」已创建', '👥');
      },
      openGroup(g) { this.wxGroup = g; this.phoneView = 'groupchat'; this.phoneInput = ''; this.$nextTick(() => this.scrollWx()); },
      groupMsgs(g) { return (this.story.phone.chats[g.id] || []); },
      groupLastMsg(g) {
        const l = this.groupMsgs(g);
        const last = l[l.length - 1];
        if (!last) return (this.groupMembers(g).map(m => m.name).join('、')) + '的群';
        return (last.role === 'me' ? '我：' : (last.name || '') + '：') + last.text.slice(0, 20);
      },
      groupLastTime(g) {
        const l = this.groupMsgs(g);
        return l.length ? this.fmtClock(l[l.length - 1].ts) : '';
      },
      async sendGroupMsg() {
        const text = this.phoneInput.trim();
        if (!text || this.groupBusy || !this.wxGroup) return;
        this.phoneInput = '';
        this.groupBusy = true;
        this.$nextTick(() => this.scrollWx());
        try { await PW.Phone.groupSend(this.story, this.wxGroup, text); }
        catch (e) { this.showError(e); }
        finally { this.groupBusy = false; this.$nextTick(() => this.scrollWx()); }
      },
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
      async refreshMoments(silent) {
        this.moBusy = true;
        try {
          const n = await PW.Phone.genMoments(this.story, 3);
          if (!silent) this.toast(n.length ? `收到 ${n.length} 条新动态` : 'NPC 们暂时没发动态', '🌸');
        } catch (e) { if (!silent) this.showError(e); }
        finally { this.moBusy = false; }
      },
      toggleLike(mo) { mo.likedByMe = !mo.likedByMe; mo.likes += mo.likedByMe ? 1 : -1; },
      async sendCmt(target) {
        const text = this.cmtText.trim();
        if (!text || this.moBusy) return;
        this.cmtText = '';
        this.moBusy = true;
        try { await PW.Phone.commentOnPost(this.story, target, text); }
        catch (e) { this.showError(e); }
        finally { this.moBusy = false; }
      },
      /* ---------- 朋友圈楼中楼 ---------- */
      async sendReplyCmt(moment, comment) {
        const text = this.replyText.trim();
        if (!text || this.replyBusy) return;
        this.replyText = '';
        this.replyBusy = true;
        try {
          const r = await PW.Phone.replyToComment(this.story, moment, comment, text);
          if (r) this.toast(r.name + ' 回复了你', '💬');
        } catch (e) { this.showError(e); }
        finally { this.replyBusy = false; }
      },
      /* ---------- 删除超话 ---------- */
      askDelCha(c) {
        this.confirmBoxOpen('删除超话？', `「${c.name}」将从列表移除（已浏览的帖子不受影响）。`, () => {
          const i = this.story.phone.weibo.supertopics.findIndex(x => x.name === c.name && x.type === c.type);
          if (i >= 0) this.story.phone.weibo.supertopics.splice(i, 1);
          this.toast('超话已删除', '🗑');
        });
      },
      async refreshWeibo(silent) {
        this.wbBusy = true;
        try { await PW.Phone.genWeibo(this.story); if (!silent) this.toast('热搜与微博已更新', '🔥'); }
        catch (e) { if (!silent) this.showError(e); }
        finally { this.wbBusy = false; }
      },
      async openHotDetail(h) {
        this.wbDetail = { title: h.text, tag: h.tag };
        this.wbDetailKind = 'hot';
        this.wbDetailPosts = [];
        this.wbDetailBusy = true;
        try { this.wbDetailPosts = await PW.Phone.hotDetail(this.story, h.text); }
        catch (e) { this.showError(e); this.wbDetail = null; }
        finally { this.wbDetailBusy = false; }
      },
      async openChaDetail(c) {
        this.wbDetail = { title: c.name, type: c.type, readers: c.readers, postsN: c.postsN, members: c.members || [] };
        this.wbDetailKind = 'cha';
        this.wbDetailPosts = [];
        this.wbDetailBusy = true;
        try { this.wbDetailPosts = await PW.Phone.supertopicFeed(this.story, c); }
        catch (e) { this.showError(e); this.wbDetail = null; }
        finally { this.wbDetailBusy = false; }
      },
      backToWeibo() { this.wbDetail = null; this.wbDetailPosts = []; },
      /* ---------- 玩家发朋友圈/微博/建超话 ---------- */
      async postMoment() {
        const text = (this.moCompose || '').trim();
        if (!text || this.moBusy) return;
        this.moCompose = '';
        this.moBusy = true;
        try { await PW.Phone.playerMomentPost(this.story, text); this.toast('朋友圈已发布', '🌸'); }
        catch (e) { this.showError(e); }
        finally { this.moBusy = false; }
      },
      async postWeibo() {
        const text = (this.wbCompose || '').trim();
        if (!text || this.wbBusy) return;
        this.wbCompose = '';
        this.wbBusy = true;
        try { await PW.Phone.playerWeiboPost(this.story, text); this.toast('微博已发布', '🔥'); }
        catch (e) { this.showError(e); }
        finally { this.wbBusy = false; }
      },
      openChaModal() { this.chaModal = { open: true, name: '', type: '个人', memberIds: [] }; },
      toggleChaMember(id) {
        const arr = this.chaModal.memberIds;
        const i = arr.indexOf(id);
        if (i >= 0) { arr.splice(i, 1); return; }
        if (this.chaModal.type === 'cp') {
          arr.push(id);
          while (arr.length > 2) arr.shift();
        } else {
          arr.length = 0; arr.push(id);
        }
      },
      chaMemberName(m) {
        if (m === 'player') return this.story.player.name || '我';
        const n = this.npcById(m);
        return n ? n.name : m;
      },
      chaSub(c) {
        if (c.type === 'cp' && (c.members || []).length >= 2) {
          return this.chaMemberName(c.members[0]) + ' × ' + this.chaMemberName(c.members[1]);
        }
        if ((c.members || []).length === 1) return this.chaMemberName(c.members[0]) + '的超话';
        return c.readers + '阅读 · ' + c.postsN + '帖子';
      },
      createCha() {
        const name = (this.chaModal.name || '').trim();
        if (!name) { this.toast('超话得有个名字', '🙃'); return; }
        if (this.chaModal.type === 'cp' && this.chaModal.memberIds.length !== 2) { this.toast('CP超话要选恰好两位成员', '💞'); return; }
        const cha = {
          id: PW.Store.uid('cha'), name: name.slice(0, 16), type: this.chaModal.type,
          members: this.chaModal.memberIds.slice(),
          readers: '0.1亿', postsN: '0帖', signed: true
        };
        this.story.phone.weibo.supertopics.unshift(cha);
        this.chaModal.open = false;
        this.toast('超话「' + name + '」已创建', '⭐');
        this.openChaDetail(cha);
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
