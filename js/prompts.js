/* ============ Prompt 组装器 ============
 * 四层记忆体系：
 *  L0 设定层（常驻）：GM指令 + 世界观/规则 + 玩家卡 + 在场NPC卡（含秘密）
 *  L1 短期记忆（常驻原文）：最近 N 条消息
 *  L2 章节摘要（常驻）：滚动压缩的"前情提要"
 *  L3 RAG 检索（动态）：与当前输入最相关的历史片段
 */
window.PW = window.PW || {};
(function () {
  const NL = String.fromCharCode(10);
  const fmtDate = ts => new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });

  /* ---------- L0：系统主提示词 ---------- */
  function gmSystem(story, layers) {
    const tpl = PW.TEMPLATES[story.genreKey];
    const styleObj = PW.STYLES.find(s => s.id === story.settings.styleId);

    /* 自定义核心指令：替换默认 GM 规则 */
    if (story.useCoreInstruction && story.coreInstruction && story.coreInstruction.trim()) {
      let sys = story.coreInstruction.trim();
      /* 附加当前角色状态速览，保证好感度/人员与界面一致 */
      const roster = rosterBlock(story);
      if (roster) sys += '\n\n' + roster;
      sys += '\n\n【系统附加协议（最高优先级，不可违反）】\n'
        + '1. 用中文回复。\n'
        + '2. 绝不代替玩家角色做决定，绝不描写玩家角色未声明的行动与心理；其他角色只对玩家已声明的行为做出反应。\n'
        + '3. 若有角色好感或状态变化，可在回复末尾另起一行输出隐藏标记（系统自动剔除，玩家不可见，不要在正文解释）：[[AFF:NPC名:+3]] 或 [[AFF:NPC名:-2]]、[[STATE:NPC名:状态短语]]。\n';
      if (story.useNineFormat) {
        const userFmt = (story.outputFormat || '').trim();
        if (userFmt) {
          sys += NL + NL + '【自定义输出格式（绝对命令，严格按此格式生成，各部分缺一不可）】' + NL + userFmt;
        }
        sys += NL + NL + '【系统附加协议（最高优先级）】' + NL
          + '1. 好感度变化必须符合逻辑：贴合NPC性格与剧情因果，不可无脑上升，单次不超过±10。' + NL
          + '2. 严禁代替玩家角色做任何决定，严禁描写玩家角色的心理、未声明的动作与台词；剧情到抉择点必须停下等待玩家输入。';
        return sys;
      }
      sys += '5. 好感度与状态变化必须符合逻辑：严格贴合NPC性格、经历与当前剧情，不可无脑上升；单次变化幅度不超过±10。\n';
      return sys;
    }

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
    sys += `\n【文风】${(story.settings.styleNote || '').trim() || '自然流畅，贴合题材'}\n【视角】${povText}

【玩家角色】
${playerCard}

【当前在场NPC】
${npcCards}`;

    /* L3 RAG 检索记忆 */
    if (layers.memories && layers.memories.length) {
      sys += `\n【记忆回响】以下是与此刻情境相关的过往剧情片段（来自更早的章节，仅作回忆参考，不要复述）：
${layers.memories.map(m => `[${m.label}] ${m.text.length > 160 ? m.text.slice(0, 160) + '…' : m.text}`).join('\n')}`;
    }

    /* L2 滚动摘要：已停用（改为剧情全量原文，避免压缩丢细节） */

    /* 输出格式协议 */
    if (story.useNineFormat) {
      const userFmt = (story.outputFormat || '').trim();
      if (userFmt) {
        sys += NL + NL + '【自定义输出格式（绝对命令，严格按此格式生成，各部分缺一不可）】' + NL + userFmt;
      }
      sys += NL + NL + '【系统附加协议（最高优先级）】' + NL
        + '1. 用中文。' + NL
        + '2. 严禁代替玩家角色做任何决定，严禁描写玩家角色的心理、未声明的动作与台词；剧情推进到需要玩家抉择时必须停下等待玩家输入。' + NL
        + '3. 好感度变化必须符合逻辑：贴合NPC性格与剧情因果，不可无脑上升，单次不超过±10。';
    } else {
    sys += `

【输出格式（必须严格遵守）】
1. 用中文推进剧情，每次回复约150~400字：旁白与对话交织，禁止大段流水账，禁止使用markdown标题/加粗/列表。
2. 对话行格式：角色名："台词"（中文冒号+引号）。旁白行直接书写，不加名字。
3. 【最高铁律】严禁代替玩家角色做任何决定；严禁描写玩家角色的心理活动、未声明的动作与台词；严禁让NPC替玩家回答或行动。剧情推进到需要玩家抉择时，必须停下等待玩家输入。NPC只对玩家已做的事做出反应。玩家行动遇到困难时如实呈现阻力，不自动成功。
4. 回复正文结束后，若有NPC好感或状态变化，另起一行输出隐藏标记（系统会剔除，玩家不可见，不要解释它们）：
   [[AFF:NPC名:+3]] 或 [[AFF:NPC名:-2]]；[[STATE:NPC名:状态短语]]
5. 好感度变化必须符合逻辑：严格贴合NPC性格、经历与当前剧情因果，不可无脑上升；单次变化幅度不超过±10。
6. 若玩家消息以（　）包裹或以OOC:开头，视为作者指令：按其调整世界与剧情走向，但正文中不出现解释性文字。
7. 手机剧情（若启用）：NPC发消息、朋友圈动态、微博等用标记：【微信|NPC名|内容】【朋友圈|NPC名|动态内容】，系统会路由到手机界面。
8. 保持NPC言行与其性格、身份、秘密一致；重要伏笔可以埋设，长线剧情要能接得上记忆。`;
    }
    return sys;
  }

  /* 当前角色状态速览（注入核心指令之后，保证界面与AI数据一致） */
  function rosterBlock(story) {
    const p = story.player || {};
    let out = '';
    if (p.name) out += '【玩家角色速览】' + p.name + (p.gender ? '（' + p.gender + (p.age ? '，' + p.age : '') + '）' : '') + '。人设：' + (p.persona || '由对话展现') + '\n';
    const npcs = (story.npcs || []).filter(n => n.present !== false);
    if (npcs.length) {
      out += '【当前NPC状态速览（好感度为界面实时值，需保持连贯）】\n';
      npcs.forEach(n => {
        out += '- ' + n.name + '：' + (n.identity || '') + '；好感度 ' + (n.affinity == null ? 50 : n.affinity) + '/100' + (n.state ? '；状态：' + n.state : '') + (n.secret ? '；秘密(不可主动揭露)' : '') + '\n';
      });
    }
    return out.trim();
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

  /* 最近剧情原文（替代"前情提要"：直接取最近n条剧情，绕开摘要压缩，保证细节不丢） */
  function recentPlot(story, n) {
    const pName = story.player.name || '我';
    return (story.chat.messages || []).slice(-(n || 6))
      .filter(m => m && m.text && m.text.trim())
      .map(m => {
        const who = m.kind === 'me' ? pName : (m.kind === 'phone' ? '（系统旁注）' : '（剧情）');
        return who + '：' + String(m.raw || m.text).replace(/\s+/g, ' ').slice(0, 120);
      }).join('\n');
  }

  /* ---------- 组装完整请求 ---------- */
  async function build(story, userInput, retrieved) {
    /* 不做 L2 压缩摘要：窗口从0开始全量携带剧情原文，防止"前情提要"压缩丢失细节 */
    const windowStart = 0;

    const layers = {
      memories: (retrieved || []).map(h => ({
        label: h.label,
        text: h.rec.text
      })),
      summary: ''   // 前情提要已停用
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

  /* 记忆块拼接（手机各场景与主线共享记忆） */
  function memBlock(memText) {
    if (!memText || !memText.trim()) return '';
    return NL + '【相关剧情记忆（仅供情节连贯参考；禁止模仿这些片段的文风与断句，正文按你自己的规范写）】' + NL + memText;
  }

  /* ---------- 手机：NPC主动发微信 ---------- */
  function proactiveChatPrompt(story, memText, count) {
    /* 好感度档次：驱动"谁更可能主动"与消息语气 */
    const affTier = a => a == null ? 50 : a;
    const cast = (story.npcs || []).filter(x => x.present !== false)
      .map(x => {
        const a = affTier(x.affinity);
        const tier = a >= 80 ? '亲密度高，很想主动联系' : a >= 55 ? '有好感，偶尔会主动' : a >= 40 ? '关系一般，基本懒得主动' : '好感度低，除非有正事否则不会主动';
        return `${x.name}（身份：${x.identity || ''}；性格：${(x.personality || '').slice(0, 30)}；说话风格：${(x.speech || '').slice(0, 20)}；好感度${a}，${tier}）`;
      }).join('；');
    const n = count || 2; // 期望条数由调用方随机，避免每次都固定
    return [
      { role: 'system', content: `【任务：微信主动消息】你是互动小说的社交模拟器。根据**剧情契机 + 各NPC好感度 + 性格**综合判断谁最可能主动联系玩家，并由TA在微信上主动发来消息。选取规则（必须遵守）：\n1. 优先选剧情里近期有交集、或有话题找你、或事件与TA相关的人；\n2. 在同等人选下，好感度越高越主动、语气越亲昵；好感度低(40以下)除非剧情强相关否则不选；\n3. 消息语气完全贴合所选NPC的性格与说话风格与你们当前的关系(好感度)，不能千人一面。\n只输出JSON对象（不要代码块）：{"npc":"NPC名","messages":["第一条","第二条"],"why":"简短理由(12字内，注明依据好感度/性格/剧情的哪一点)"}。恰好${n}条，口语化、像真的微信、松散自然。` + memBlock(memText) },
      { role: 'user', content: `故事：${story.title}\n世界：${(story.worldview.text || '').slice(0, 200)}\n角色表（含好感度档次）：${cast}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n请根据以上剧情与各角色好感度、性格，判断谁最该主动，生成TA的主动消息。` }
    ];
  }

  /* ---------- 手机：微信群聊 ---------- */
  function groupChatPrompt(story, group, userText, recent, memText) {
    const members = (group.memberIds || []).map(id => (story.npcs || []).find(n => n.id === id)).filter(Boolean);
    const cast = members.map(n => `${n.name}（${n.identity || ''}；性格：${(n.personality || '').slice(0, 30)}；说话风格：${(n.speech || '').slice(0, 20)}；好感度${n.affinity == null ? 50 : n.affinity}）`).join('\n');
    const rec = (recent || []).slice(-10).map(m => `${m.name || (m.role === 'me' ? (story.player.name || '我') : '成员')}：${m.text}`).join('\n');
    return [
      { role: 'system', content: `【任务：群聊】你在微信群聊「${group.name}」中同时扮演以下所有NPC：\n${cast}\n要求：\n1. 挑选2~3位最可能开口的NPC回复，每人1~2条，其余人不说话；\n2. 每条一行，格式严格为：名字：内容\n3. 完全贴合各自性格与说话风格，可以互相接话、互怼、调侃、@某人；\n4. 口语化像真微信群聊，贴合当前剧情；不要旁白，不要引号。${memBlock(memText)}` },
      { role: 'user', content: `最近的群聊记录：\n${rec || '（刚开始）'}\n\n玩家（${story.player.name || '我'}）刚在群里说：${userText}\n\n请输出各NPC的回复。` }
    ];
  }

  /* ---------- 手机：微信聊天 ---------- */
  function phoneChatMessages(story, npc, userText, chatHistory, memText) {
    const recent = (chatHistory || []).slice(-8).map(m =>
      `${m.role === 'me' ? story.player.name || '我' : npc.name}：${m.text}`).join('\n');
    /* 最近剧情原文（替代前情提要）：剧情界面刚发生的事直接带进微信对话，保证NPC“刚聊的都记得” */
    const storyRecent = recentPlot(story, 8);
    return [
      { role: 'system', content: '【任务：微信聊天】你正在扮演互动小说《' + story.title + '》中的NPC「' + npc.name + '」在微信上与玩家聊天。\n角色：' + npc.name + '，' + (npc.identity || '') + '，性格：' + (npc.personality || '') + '，说话风格：' + (npc.speech || '') + '。与玩家关系：' + (npc.relation || '') + (npc.secret ? '（隐藏秘密，聊到相关话题可微妙流露但绝不直说）' : '') + '\n世界背景：' + ((story.worldview.text || '').slice(0, 300)) + '\n要求：符合微信聊天习惯——口语化、短句、可以1~3条连发；每条一行；回答要基于"最近的剧情/你们共同的经历"，与剧情里刚发生的事保持一致；但必须严格区分——剧情里是【哪个NPC】做的事、说过的话，你只对你自己参与或知道的剧情负责，绝不能把别的NPC做过的事当成你自己做的；贴合角色性格与当前剧情；不要旁白不要引号。' + memBlock(memText) },
      { role: 'user', content: `最近剧情（你可能有份参与或知道的进展）：\n${storyRecent || '（刚开始）'}\n\n${npc.name}与玩家最近的微信记录：\n${recent || '（刚开始聊）'}\n\n玩家刚发来：${userText}\n\n请以${npc.name}的身份回复（1~3行，每行一条消息）。` }
    ];
  }

  /* ---------- 手机：朋友圈（并入微信） ---------- */
  function momentsPrompt(story, n, memText) {
    const fandom = !!story.settings.fandom;
    const cast = (story.npcs || []).filter(x => x.present !== false)
      .map(x => `${x.name}（${x.identity || ''}，性格：${(x.personality || '').slice(0, 30)}）`).join('；');
    const flavor = fandom
      ? '角色从事娱乐圈相关职业时，动态可涉及剧组日常、作品、通告等职业话题。'
      : '动态符合人设与近况，可带emoji。';
    return [
      { role: 'system', content: `【任务：朋友圈】你是社交媒体内容生成器，为互动小说里的NPC们生成微信朋友圈动态。只输出JSON数组（不要代码块），每项：{"npc":"NPC名","text":"动态内容(80字内)","likes":数字,"comments":[{"name":"名字(NPC或朋友)","text":"评论(30字内)"}]}。${flavor}\n⚠️场景隔离（必须遵守）：这是微信朋友圈——动态和评论都是朋友间的日常分享，口吻亲密随意；严禁出现粉丝/cpf/唯粉/黑粉/营销号/热搜/超话等微博饭圈词汇，严禁写成公开微博体。` },
      { role: 'user', content: `故事：${story.title}\n世界：${(story.worldview.text || '').slice(0, 200)}\n角色表：${cast}\n最近剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n请生成${n}条与剧情有微妙关联的朋友圈动态（可互相评论）。` },
    ].map(m => m.role === 'system' ? { role: 'system', content: m.content + memBlock(memText) } : m);
  }
  function weiboPrompt(story, memText) {
    const fandom = !!story.settings.fandom;
    const artists = (story.npcs || []).filter(x => x.present !== false)
      .map(x => `${x.name}（${x.identity || ''}）`).join('；');
    const player = story.player.name || '玩家';
    const req = fandom
      ? `这是娱乐圈故事，参考现实饭圈生态：
- 热搜词条必须与艺人NPC强相关（新剧/绯闻/机场图/塌房预警/番位之争/红毯造型等），带标签：沸/爆/热/新；
- 微博类型要多样：艺人NPC本尊发言（口吻贴合人设，可带#话题#）、工作室声明、营销号爆料（账号名如"内娱观察bot""瓜田里的猹"）、普通网友吃瓜；
- 评论区分粉圈阵营：唯粉、cpf（磕cp的）、妈妈粉、黑粉、路人，说话口吻要有辨识度；
- 超话：每位主要艺人一个个人超话（阅读量/帖子数要像真的），并且生成一个"玩家×某NPC"或"某NPC×某NPC"的CP超话；`
      : `微博内容与世界观和剧情呼应：NPC本人发言贴合人设，营销号/网友围绕剧情事件讨论，评论自然多样；超话按剧情里的话题生成；`;
    return [
      { role: 'system', content: `【任务：微博】你是社交媒体内容生成器，为互动小说生成完整的微博生态。只输出JSON对象（不要代码块）：\n{"hot":[{"text":"热搜词条","tag":"沸|爆|热|新之一","heat":"234.5万"}],\n"posts":[{"author":"npc:NPC名","text":"微博正文(100字内,可带#话题#)","likes":数字,"reposts":数字,"comments":[{"name":"评论者(粉丝名/路人/其他NPC)","text":"评论内容(30字内)"}]},\n{"author":"marketing:账号名",...同上},\n{"author":"netizen:昵称",...同上}],\n"supertopics":[{"name":"超话名","type":"个人或cp","members":["成员名A","成员名B"],"readers":"1.2亿","postsN":"56.7万"}]}\n作者类型：npc:开头=NPC本人；marketing:=营销号；netizen:=普通网友。\ncp超话必须给members（恰好两位成员名，可以是NPC名或玩家名），cpf帖子要双人向、有真实饭圈味。${memBlock(memText)}` },
      { role: 'user', content: `故事：${story.title}\n世界观：${(story.worldview.text || '').slice(0, 200)}\n角色（艺人/人物）：${artists}\n玩家：${player}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n${req}\n\n生成：5条热搜、5条微博（至少2条营销号+1条路人网友+2条NPC本人）、3个超话（含至少1个CP超话，须给members两位成员名）。` }
    ];
  }
  function weiboReplyPrompt(story, npc, postText, comment) {
    return [
      { role: 'system', content: `【任务：微博回复】你在扮演互动小说NPC「${npc.name}」（${npc.identity || ''}，性格：${(npc.personality || '').slice(0, 40)}）。玩家在TA的微博评论区评论了，以角色口吻回复1条（30字内，符合人设——明星则注意半公开语感）。只输出回复内容。` },
      { role: 'user', content: `你的微博：${postText}\n玩家(${story.player.name || '我'})评论：${comment}` }
    ];
  }
  /* ---------- 微博：热搜词条 / 超话 详情 ---------- */
  function hotDetailPrompt(story, hotText, memText) {
    const fandom = !!story.settings.fandom;
    const artists = (story.npcs || []).filter(x => x.present !== false).map(x => `${x.name}（${x.identity || ''}）`).join('；');
    return [
      { role: 'system', content: `【任务：热搜详情】你是社交媒体内容生成器。针对一条热搜词条，生成微博正文与评论区。只输出JSON数组（不要代码块），每项：{"author":"npc:NPC名"或"marketing:账号名"或"netizen:昵称","text":"微博内容(120字内,可带#话题#)","likes":数字,"reposts":数字,"comments":[{"name":"评论者(粉丝/路人/黑粉,口吻有辨识度)","text":"评论(30字内)"}]}。共4~6条。${fandom ? '娱乐圈背景：评论区分唯粉/cpf/黑粉/路人，口吻要有饭圈辨识度。' : ''}${memBlock(memText)}` },
      { role: 'user', content: `故事：${story.title}\n角色：${artists}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n热搜词条：${hotText}\n\n生成与该词条相关的微博和评论（内容要与词条和剧情呼应）。` }
    ];
  }
  /* 成员解析：'player' 或 npcId 或原始名字 → 描述文本 */
  function chaMemberDesc(story, m) {
    if (m === 'player') {
      const p = story.player || {};
      return (p.name || '玩家') + '（玩家角色；' + (p.persona || '').slice(0, 40) + '）';
    }
    const npc = (story.npcs || []).find(n => n.id === m);
    if (npc) return npc.name + '（' + (npc.identity || '') + '；性格：' + (npc.personality || '').slice(0, 30) + '；好感度' + (npc.affinity == null ? 50 : npc.affinity) + '）';
    return String(m);
  }
  function supertopicPrompt(story, cha, memText) {
    const members = (cha.members || []).map(m => chaMemberDesc(story, m));
    let theme;
    if (cha.type === 'cp') {
      const pair = members.length >= 2 ? members[0] + ' × ' + members[1] : cha.name;
      theme = '这是CP超话「' + cha.name + '」，CP为：' + pair + '。' + NL
        + '生成真实微博cpf超话的双人向帖子流，要求：' + NL
        + '1. 每条帖子必须同时提到两个人，围绕两人的互动写：同框细节分析、眼神拉丝解读、剧情嗑糖、二创脑洞、切片安利；' + NL
        + '2. 口吻是真实cpf："家人们谁懂啊""锁死""kdl""嗑生嗑死""这个眼神我先磕为敬"，也可混少量理性分析帖与路人帖；' + NL
        + '3. 结合近期剧情与两人好感度，糖里可以带刀。';
    } else {
      const who = members[0] || cha.name;
      theme = '这是个人超话「' + cha.name + '」，主角是：' + who + '。生成唯粉超话的帖子流：应援打卡、生图安利、行程讨论、回忆杀长文，口吻是真实唯粉（护短热情，带数据组打投黑话）。';
    }
    return [
      { role: 'system', content: `【任务：超话详情】你是超话内容生成器，模拟真实微博超话社区。只输出JSON数组（不要代码块），每项：{"author":"netizen:粉丝昵称","text":"帖子(130字内,超话社区口吻,可带#超话名#)","likes":数字,"comments":[{"name":"回复者","text":"回复(30字内)"}]}。共4~6条。${theme}${memBlock(memText)}` },
      { role: 'user', content: `故事：${story.title}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n生成「${cha.name}」超话的帖子流（内容要与剧情和人设呼应）。` }
    ];
  }
  /* ---------- 手机：朋友圈玩家发帖 ---------- */
  function momentsPlayerPostPrompt(story, text, memText) {
    const cast = (story.npcs || []).filter(x => x.present !== false)
      .map(x => `${x.name}（${x.identity || ''}；性格：${(x.personality || '').slice(0, 30)}；好感度${x.affinity == null ? 50 : x.affinity}）`).join('；');
    return [
      { role: 'system', content: '【任务：朋友圈玩家帖】玩家发了一条朋友圈，生成NPC们的评论。只输出JSON数组（不要代码块）：[{"npc":"NPC名","text":"评论(40字内,完全贴合各自性格与好感度)"}]，1~3条，挑选最可能互动的NPC；只能使用角色表中的NPC名，禁止编造。' + memBlock(memText) },
      { role: 'user', content: `玩家（${story.player.name || '我'}）的朋友圈内容：${text}\n角色表：${cast}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n请生成评论。` }
    ];
  }

  /* ---------- 手机：微博玩家发帖 ---------- */
  function weiboPlayerPostPrompt(story, text, memText) {
    const fandom = !!story.settings.fandom;
    return [
      { role: 'system', content: `【任务：微博玩家帖】玩家发了一条微博，生成评论区。只输出JSON数组（不要代码块）：[{"name":"评论者(可为角色表中的NPC名,或粉丝/路人/营销号昵称)","text":"评论(30字内,口吻有辨识度)","likes":数字}]，2~4条。${fandom ? '娱乐圈背景：评论区分唯粉/cpf/黑粉/路人。' : ''}${memBlock(memText)}` },
      { role: 'user', content: `玩家（${story.player.name || '我'}）的微博内容：${text}\n近期剧情：\n${recentPlot(story, 6) || '（刚开始）'}\n\n请生成评论。` }
    ];
  }
  function momentReplyPrompt(story, npc, momentText, comment) {
    return [
      { role: 'system', content: '【任务：评论回复】你在扮演互动小说NPC「' + npc.name + '」（' + (npc.identity || '') + '，性格：' + (npc.personality || '').slice(0, 40) + '）。玩家在你的一条朋友圈下评论了，请以角色身份回复1条评论（30字内，符合人设与关系）。只输出回复内容。' },
      { role: 'user', content: `你的朋友圈内容：${momentText}\n玩家(${story.player.name || '我'})评论：${comment}` }
    ];
  }
  /* ---------- 朋友圈：楼中楼（玩家回复NPC评论，NPC再回应） ---------- */
  function momentReplyToReplyPrompt(story, npc, momentText, npcComment, playerReply) {
    return [
      { role: 'system', content: '【任务：楼中楼回复】你在扮演互动小说NPC「' + npc.name + '」（' + (npc.identity || '') + '；性格：' + (npc.personality || '').slice(0, 40) + '；对玩家好感度' + (npc.affinity == null ? 50 : npc.affinity) + '/100）。玩家在你朋友圈评论下回复了你，请以角色身份再回应1条（35字内）。回应要贴合好感度：高好感可以亲近/调侃/关心，低好感保持距离或冷淡，负好感可以带刺。符合人设与当前剧情。只输出回复内容。' },
      { role: 'user', content: `你的朋友圈：${momentText}\n你的评论：${npcComment}\n玩家（${story.player.name || '我'}）回复你：${playerReply}\n\n请回应。` }
    ];
  }

  window.PW.Prompts = {
    gmSystem, historyMessages, recentPlot, build, summaryPrompt, rosterBlock,
    worldviewPrompt, polishPrompt, npcGenPrompt,
    proactiveChatPrompt, phoneChatMessages, momentsPrompt, weiboPrompt, momentReplyPrompt, weiboReplyPrompt,
    hotDetailPrompt, supertopicPrompt, groupChatPrompt, momentsPlayerPostPrompt, weiboPlayerPostPrompt, momentReplyToReplyPrompt
  };
})();
