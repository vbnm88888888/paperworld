/* ============ Prompt 组装器 ============
 * 四层记忆体系：
 *  L0 设定层（常驻）：GM指令 + 世界观/规则 + 玩家卡 + 在场NPC卡（含秘密）
 *  L1 短期记忆（常驻原文）：最近 N 条消息
 *  L2 章节摘要（常驻）：滚动压缩的"前情提要"
 *  L3 RAG 检索（动态）：与当前输入最相关的历史片段
 */
window.PW = window.PW || {};
(function () {
  const fmtDate = ts => new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });

  /* ---------- L0：系统主提示词 ---------- */
  function gmSystem(story, layers) {
    const tpl = PW.TEMPLATES[story.genreKey];
    const styleObj = PW.STYLES.find(s => s.id === story.settings.styleId);
    const povText = story.settings.pov === 'first'
      ? '叙事视角：第一人称——旁白以玩家角色"我"的口吻描述其行动与感官（但不代玩家做决定）'
      : '叙事视角：第三人称——旁白客观描述玩家角色与世界的互动（不代玩家做决定）';

    let npcCards = '';
    (story.npcs || []).filter(n => n.present !== false).forEach(n => {
      npcCards += `◆ ${n.name}（${n.gender || '?'}，${n.age || '?'}岁）｜身份：${n.identity || '未知'}\n`
        + `  性格：${n.personality || '—'}｜外貌：${n.appearance || '—'}\n`
        + `  说话风格：${n.speech || '—'}｜与玩家关系：${n.relation || '—'}｜好感度：${n.affinity == null ? 50 : n.affinity}/100\n`
        + (n.state ? `  当前状态：${n.state}\n` : '')
        + (n.secret ? `  隐藏秘密（仅你知晓，需铺垫才能揭示，绝不主动和盘托出）：${n.secret}\n` : '');
    });
    if (!npcCards) npcCards = '（暂无在场NPC，若剧情需要可引入路人，或提示玩家在NPC页添加）';

    const p = story.player || {};
    let playerCard = `姓名：${p.name || '我'}${p.age ? '｜年龄：' + p.age : ''}${p.gender ? '｜性别：' + p.gender : ''}\n人设：${p.persona || '（由玩家在对话中自行展现）'}`;

    let sys = `你是「纸上人间」文字模拟游戏的游戏主持人（GM），负责主持一场沉浸式的${tpl ? tpl.name : '自定义'}题材互动小说。你的职责：扮演世界与全部NPC、推进剧情、描写环境与反应，让玩家的每个选择都有回响。

【游戏世界】
${story.worldview.text || '（自由世界，由剧情逐步展开）'}`;

    if ((story.worldview.rules || []).length) {
      sys += `\n【世界规则】\n` + story.worldview.rules.map(r => '- ' + r).join('\n');
    }
    if (tpl && tpl.mechanics) {
      sys += `\n【题材机制】\n${tpl.mechanics}`;
    }
    sys += `\n【文风】${styleObj ? styleObj.desc : '细腻平衡'}\n【视角】${povText}

【玩家角色】
${playerCard}

【当前在场NPC】
${npcCards}`;

    /* L3 RAG 检索记忆 */
    if (layers.memories && layers.memories.length) {
      sys += `\n【记忆回响】以下是与此刻情境相关的过往剧情片段（来自更早的章节，仅作回忆参考，不要复述）：
${layers.memories.map(m => `[${m.label}] ${m.text.length > 160 ? m.text.slice(0, 160) + '…' : m.text}`).join('\n')}`;
    }

    /* L2 滚动摘要 */
    if (layers.summary) {
      sys += `\n【前情提要】（更早剧情的压缩记录）\n${layers.summary}`;
    }

    /* 输出格式协议 */
    sys += `

【输出格式（必须严格遵守）】
1. 用中文推进剧情，每次回复约150~400字：旁白与对话交织，禁止大段流水账，禁止使用markdown标题/加粗/列表。
2. 对话行格式：角色名："台词"（中文冒号+引号）。旁白行直接书写，不加名字。
3. 绝不代替玩家做决定或描写玩家未声明的心理活动；NPC只对玩家已做的事做出反应。玩家行动遇到困难时如实呈现阻力，不自动成功。
4. 回复正文结束后，若有NPC好感或状态变化，另起一行输出隐藏标记（系统会剔除，玩家不可见，不要解释它们）：
   [[AFF:NPC名:+3]] 或 [[AFF:NPC名:-2]]；[[STATE:NPC名:状态短语]]
5. ${story.settings.optionsOn ? '正文与标记之后，另起一行给出2~4个简短行动选项，格式严格为：\n[选项]\n1. 选项一（10字内）\n2. 选项二\n3. 选项三\n（玩家可无视选项自由输入，选项要有多样性：推进/试探/保守各一）' : '不需要输出[选项]块。'}
6. 若玩家消息以（　）包裹或以OOC:开头，视为作者指令：按其调整世界与剧情走向，但正文中不出现解释性文字。
7. 手机剧情（若启用）：NPC发消息、朋友圈动态、微博等用标记：【微信|NPC名|内容】【朋友圈|NPC名|动态内容】，系统会路由到手机界面。
8. 保持NPC言行与其性格、身份、秘密一致；重要伏笔可以埋设，长线剧情要能接得上记忆。`;

    return sys;
  }

  /* ---------- L1：最近消息 → 对话历史 ---------- */
  function historyMessages(story, fromIndex) {
    const msgs = story.chat.messages.slice(fromIndex || 0);
    return msgs.filter(m => m.text && m.text.trim()).map(m => {
      if (m.kind === 'ai') return { role: 'assistant', content: m.raw || m.text };
      if (m.kind === 'me') return { role: 'user', content: m.text };
      if (m.kind === 'ooc') return { role: 'user', content: '（OOC：' + m.text + '）' };
      if (m.kind === 'phone') return { role: 'user', content: '（系统旁注：' + m.text + '）' };
      // ctrl 指令
      return { role: 'user', content: '（GM指令：' + m.text + '）' };
    });
  }

  /* ---------- 组装完整请求 ---------- */
  async function build(story, userInput, retrieved) {
    const s = PW.App.settings;
    const msgs = story.chat.messages;
    const summarized = story.chat.summarizedUntil || 0;

    /* 未被摘要覆盖、超出窗口的旧消息（理论上不应存在，兜底并入摘要提示） */
    const windowStart = Math.max(summarized, Math.max(0, msgs.length - (s.recentTurns || PW.CONFIG.RECENT_TURNS)));

    const layers = {
      memories: (retrieved || []).map(h => ({
        label: h.label,
        text: h.rec.text
      })),
      summary: story.chat.summary || ''
    };

    const messages = [{ role: 'system', content: gmSystem(story, layers) }];
    historyMessages(story, windowStart).forEach(m => messages.push(m));
    if (userInput != null && userInput !== '') messages.push({ role: 'user', content: userInput });
    return messages;
  }

  /* ---------- L2 滚动摘要 ---------- */
  function summaryPrompt(story, oldSummary, texts) {
    return [
      { role: 'system', content: '【任务：摘要】你是剧情摘要助手。把互动小说的旧剧情压缩成简洁的"前情提要"，保留：关键事件因果、人物关系变化、重要伏笔与未解之谜、出现的物品/承诺/约定。分条列出，总长不超过350字。不要评论，不要展开。' },
      { role: 'user', content: `已有前情提要：\n${oldSummary || '（无）'}\n\n请把以下新剧情合并进前情提要（合并后依然≤350字）：\n${texts}` }
    ];
  }

  /* ---------- 世界观 AI ---------- */
  function worldviewPrompt(genreName, idea) {
    return [
      { role: 'system', content: '【任务：世界观】你是互动小说的世界观设计师。根据题材与用户想法，写一段250~400字的世界观设定：交代时空背景、核心冲突/张力、玩家的初始处境。文字有画面感，结尾落在玩家"此刻"的处境上，方便直接开局。只输出设定正文。' },
      { role: 'user', content: `题材：${genreName}\n${idea ? '想法/要求：' + idea : '（未提供想法，自由发挥，但要适合互动小说开局）'}` }
    ];
  }
  function polishPrompt(kind, text, genreName) {
    const inst = kind === 'polish'
      ? '润色下面这段世界观：修正逻辑、增强画面感与氛围，保持原意与长度（可±20%）。只输出结果。'
      : '扩写下面这段世界观：补充社会结构/势力关系/隐藏危机等细节，让世界更立体，篇幅扩到原文的1.5~2倍。保持原设定不变。只输出结果。';
    return [
      { role: 'system', content: '【任务：世界观】你是世界观设计师，题材是' + genreName + '。' + inst },
      { role: 'user', content: text }
    ];
  }

  /* ---------- NPC 生成 ---------- */
  function npcGenPrompt(story, hint) {
    const tpl = PW.TEMPLATES[story.genreKey];
    const exist = (story.npcs || []).map(n => n.name).join('、') || '无';
    return [
      { role: 'system', content: '【任务：NPC】你是角色设计师，为互动小说生成一名新NPC。只输出一个JSON对象（不要markdown代码块），字段：name(中文姓名), gender, age(字符串), identity(身份), personality(性格2-3句), appearance(外貌1-2句), speech(说话风格1句), relation(与玩家初始关系1句), secret(隐藏秘密1句，有趣且有戏剧性), greeting(开场白，50字内，符合说话风格，用中文引号包住台词)' },
      {
        role: 'user', content: `题材：${tpl ? tpl.name : '自定义'}\n世界观：${(story.worldview.text || '').slice(0, 300)}\n已有NPC（不要重名、身份错开）：${exist}\n玩家：${story.player.name || '玩家'}（${(story.player.persona || '无设定').slice(0, 80)}）\n${hint ? '期望方向：' + hint : '请与已有NPC形成差异化。'}`
      }
    ];
  }

  /* ---------- 手机：微信聊天 ---------- */
  function phoneChatMessages(story, npc, userText, chatHistory) {
    const recent = (chatHistory || []).slice(-8).map(m =>
      `${m.role === 'me' ? story.player.name || '我' : npc.name}：${m.text}`).join('\n');
    return [
      { role: 'system', content: '【任务：微信聊天】你正在扮演互动小说《' + story.title + '》中的NPC「' + npc.name + '」在微信上与玩家聊天。\n角色：' + npc.name + '，' + (npc.identity || '') + '，性格：' + (npc.personality || '') + '，说话风格：' + (npc.speech || '') + '。与玩家关系：' + (npc.relation || '') + (npc.secret ? '（隐藏秘密，聊到相关话题可微妙流露但绝不直说）' : '') + '\n剧情背景摘要：' + ((story.chat.summary || story.worldview.text || '').slice(0, 300)) + '\n要求：符合微信聊天习惯——口语化、短句、可以1~3条连发；每条一行；贴合角色性格与当前剧情；不要旁白不要引号。' },
      { role: 'user', content: `最近的聊天记录：\n${recent || '（刚开始聊）'}\n\n玩家刚发来：${userText}\n\n请以${npc.name}的身份回复（1~3行，每行一条消息）。` }
    ];
  }

  /* ---------- 手机：朋友圈 / 微博生成 ---------- */
  function momentsPrompt(story, n) {
    const cast = (story.npcs || []).filter(x => x.present !== false)
      .map(x => `${x.name}（${x.identity || ''}，性格：${(x.personality || '').slice(0, 30)}）`).join('；');
    return [
      { role: 'system', content: '【任务：朋友圈】你是社交媒体内容生成器，为互动小说里的NPC们生成朋友圈动态。只输出JSON数组（不要代码块），每项：{"npc":"NPC名","text":"动态内容(80字内,符合人设与近况,可配emoji)","likes":数字,"comments":[{"name":"NPC名","text":"评论(30字内)"}]}。' },
      { role: 'user', content: `故事：${story.title}\n世界：${(story.worldview.text || '').slice(0, 200)}\n角色表：${cast}\n最近剧情：${(story.chat.summary || '').slice(0, 300) || '（刚开始）'}\n\n请生成${n}条与剧情有微妙关联的朋友圈动态（可以互相评论）。` }
    ];
  }
  function weiboPrompt(story) {
    const tpl = PW.TEMPLATES[story.genreKey];
    const cast = (story.npcs || []).map(x => x.name).join('、');
    return [
      { role: 'system', content: '【任务：微博】你是社交媒体内容生成器，为互动小说生成微博内容。只输出JSON对象（不要代码块）：{"hot":["热搜词条1","词条2","词条3","词条4","词条5"],"posts":[{"npc":"NPC名","text":"微博内容(100字内,符合人设)","likes":数字}]}' },
      { role: 'user', content: `故事：${story.title}（题材：${tpl ? tpl.name : '自定'}）\n世界：${(story.worldview.text || '').slice(0, 200)}\n角色：${cast}\n近期剧情：${(story.chat.summary || '').slice(0, 200) || '（刚开始）'}\n\n生成5个与世界观/剧情呼应的热搜词条（要吃瓜感）和3条NPC微博。` }
    ];
  }
  function momentReplyPrompt(story, npc, momentText, comment) {
    return [
      { role: 'system', content: '【任务：评论回复】你在扮演互动小说NPC「' + npc.name + '」（' + (npc.identity || '') + '，性格：' + (npc.personality || '').slice(0, 40) + '）。玩家在你的一条朋友圈下评论了，请以角色身份回复1条评论（30字内，符合人设与关系）。只输出回复内容。' },
      { role: 'user', content: `你的朋友圈内容：${momentText}\n玩家(${story.player.name || '我'})评论：${comment}` }
    ];
  }

  window.PW.Prompts = {
    gmSystem, historyMessages, build, summaryPrompt,
    worldviewPrompt, polishPrompt, npcGenPrompt,
    phoneChatMessages, momentsPrompt, weiboPrompt, momentReplyPrompt
  };
})();
