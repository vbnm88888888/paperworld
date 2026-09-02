/* ============ 手机界面逻辑：微信(含朋友圈/主动消息) / 微博饭圈生态 ============ */
window.PW = window.PW || {};
(function () {
  function findNpc(story, name) {
    return (story.npcs || []).find(x => x.name === name) || null;
  }

  /* 从共享记忆池检索相关剧情（四场景记忆互通，统一走 App.memoryBlock） */
  async function memFor(query, scopes) {
    if (!query || !PW.App || !PW.App.memoryBlock) return '';
    return PW.App.memoryBlock(query, scopes);
  }

  /* 宽松JSON解析：剥掉markdown代码块/前后杂质，兼容对象与数组 */
  function parseJsonLoose(content) {
    let t = String(content || '').trim();
    const iArr = t.indexOf('['), iObj = t.indexOf('{');
    let start = -1, endCh = null;
    if (iArr >= 0 && (iObj < 0 || iArr < iObj)) { start = iArr; endCh = ']'; }
    else if (iObj >= 0) { start = iObj; endCh = '}'; }
    if (start < 0) throw new Error('AI 返回内容不是有效JSON');
    const end = t.lastIndexOf(endCh);
    if (end > start) t = t.slice(start, end + 1);
    return JSON.parse(t);
  }

  /* ---------- 微信：玩家主动发 ---------- */
  async function wechatSend(story, npc, text) {
    const chats = story.phone.chats;
    const list = chats[npc.id] || (chats[npc.id] = []);
    list.push({ id: PW.Store.uid('w'), role: 'me', text, ts: Date.now() });
    const memText = await memFor(npc.name + ' ' + text, ['wechat']);
    const { content } = await PW.Api.chat({
      messages: PW.Prompts.phoneChatMessages(story, npc, text, list, memText),
      stream: false, temperature: 1.2
    });
    const lines = (content || '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('['));
    const replies = lines.slice(0, 4).map(line => ({
      id: PW.Store.uid('w'), role: 'npc', text: line.replace(/^["“]|["”]$/g, ''), ts: Date.now()
    }));
    list.push(...replies);
    /* 旁注方向必须准确：你发的 / TA回的 分开标注，避免剧情里张冠李戴 */
    let note = `📱 微信 · 你发给${npc.name}：「${text.length > 24 ? text.slice(0, 24) + '…' : text}」`;
    if (replies.length) note += ` ｜ ${npc.name}回复：「${replies[0].text.slice(0, 20)}${replies[0].text.length > 20 ? '…' : ''}」`;
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: note, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'wechat', speaker: story.player.name, text: `（微信上玩家对${npc.name}说）${text}` },
      { kind: 'phone', scope: 'wechat', speaker: npc.name, text: `（微信上${npc.name}回复玩家）${replies.map(r => r.text).join(' / ')}` }
    ]);
    return { replies };
  }

  /* ---------- 微信：NPC主动发消息 ---------- */
  async function proactiveWechat(story) {
    const memText = await memFor('微信 主动联系 ' + (story.chat.summary || '').slice(0, 80), ['wechat']);
    /* 随机条数：1~3条随机，让每次进入都出现不同数量的主动消息，不固定三条 */
    const count = 1 + Math.floor(Math.random() * 3);
    const { content } = await PW.Api.chat({
      messages: PW.Prompts.proactiveChatPrompt(story, memText, count),
      stream: false, temperature: 1.3
    });
    const obj = parseJsonLoose(content); // 可能抛错，由调用方处理
    const npc = findNpc(story, obj.npc) || (story.npcs || []).filter(x => x.present !== false)[0];
    if (!npc) throw new Error('没有可用的NPC');
    const list = story.phone.chats[npc.id] || (story.phone.chats[npc.id] = []);
    const msgs = (obj.messages || []).slice(0, count).map(t => ({
      id: PW.Store.uid('w'), role: 'npc', text: String(t).slice(0, 120), ts: Date.now(), proactive: true
    }));
    list.push(...msgs);
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 微信 · ${npc.name} 主动发来消息`, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'wechat', speaker: npc.name, text: `（${npc.name}主动在微信上发来）${msgs.map(x => x.text).join(' / ')}${obj.why ? '（' + obj.why + '）' : ''}` }
    ]);
    return { npc, msgs };
  }

  /* ---------- 朋友圈（微信内） ---------- */
  async function genMoments(story, n) {
    /* 刷新即清掉玩家自己的旧帖子（按用户习惯：刷新=看新内容） */
    story.phone.moments = [];
    const memText = await memFor('朋友圈 动态 ' + (story.chat.summary || '').slice(0, 80), ['moments']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.momentsPrompt(story, n, memText), stream: false, temperature: 1.4 });
    let arr;
    try { arr = parseJsonLoose(content); } catch (e) { throw new Error('朋友圈内容解析失败，请重试'); }
    const created = [];
    arr.slice(0, 5).forEach(it => {
      const npc = findNpc(story, it.npc);
      /* 作者必须忠实：AI给的名字能匹配NPC就归属NPC，匹配不到就按原文显示（路人/陌生人），绝不张冠李戴 */
      const authorName = npc ? npc.name : String(it.npc || '路人');
      created.push({
        id: PW.Store.uid('mo'), npcId: npc ? npc.id : null, name: authorName, text: String(it.text || '').slice(0, 200),
        ts: Date.now() - Math.floor(Math.random() * 3600e3),
        likes: Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 60)),
        likedByMe: false,
        comments: (it.comments || []).slice(0, 4).map(c => {
          const cn = findNpc(story, c.name);
          return { id: PW.Store.uid('c'), name: String(c.name || '路人'), npcId: cn ? cn.id : null, text: String(c.text || '').slice(0, 60) };
        })
      });
    });
    /* 刷新时清掉玩家自己的旧帖子（按用户习惯：刷新=看新内容） */
    story.phone.moments.unshift(...created);
    if (story.phone.moments.length > 30) story.phone.moments.length = 30;
    if (created.length) {
      story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 朋友圈更新了（${created.map(c => c.name).join('、')}）`, ts: Date.now() });
      await PW.App.addMemories(story, [{ kind: 'phone', scope: 'moments', speaker: '朋友圈', text: 'NPC朋友圈动态：' + created.map(c => `${c.name}说「${c.text}」`).join('；') }]);
    }
    return created;
  }

  /* 朋友圈硬上限：界面只保留最近30条（内容早已写入共享记忆，不丢失） */
  function trimMoments(story) {
    if (story.phone.moments.length > 30) story.phone.moments.length = 30;
  }

  /* ---------- 朋友圈：玩家发帖（NPC来评论） ---------- */
  async function playerMomentPost(story, text) {
    const mo = {
      id: PW.Store.uid('mo'), npcId: null, name: story.player.name || '我', mine: true,
      text: String(text).slice(0, 200), ts: Date.now(), likes: 0, likedByMe: false, comments: []
    };
    story.phone.moments.unshift(mo);
    trimMoments(story);
    const memText = await memFor('朋友圈 ' + text, ['moments']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.momentsPlayerPostPrompt(story, text, memText), stream: false, temperature: 1.2 });
    let t = (content || '').trim();
    const mm = t.match(/\[[\s\S]*\]/);
    if (mm) t = mm[0];
    try {
      const arr = JSON.parse(t);
      arr.slice(0, 3).forEach(it => {
        const npc = findNpc(story, it.npc);
        mo.comments.push({
          id: PW.Store.uid('c'), name: npc ? npc.name : String(it.npc || '路人'),
          npcId: npc ? npc.id : null, text: String(it.text || '').slice(0, 60)
        });
      });
    } catch (e) { /* 评论解析失败不影响发帖 */ }
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 你发了一条朋友圈`, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'moments', speaker: story.player.name, text: `（玩家发朋友圈）${text}` + (mo.comments.length ? `；评论：${mo.comments.map(c => `${c.name}说「${c.text}」`).join('、')}` : '') }
    ]);
    return mo;
  }

  /* ---------- 微博（饭圈生态） ---------- */
  async function genWeibo(story) {
    const memText = await memFor('微博 热搜 舆论 ' + (story.chat.summary || '').slice(0, 80), ['weibo']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.weiboPrompt(story, memText), stream: false, temperature: 1.4 });
    const obj = parseJsonLoose(content);

    const hot = (obj.hot || []).slice(0, 8).map((h, i) => ({
      rank: i + 1, text: String(h.text || '').slice(0, 28),
      tag: ['沸', '爆', '热', '新'].includes(h.tag) ? h.tag : (i < 1 ? '沸' : i < 3 ? '热' : ''),
      heat: String(h.heat || ((Math.random() * 480 + 20).toFixed(1) + '万')).slice(0, 10)
    }));

    const posts = [];
    (obj.posts || []).slice(0, 10).forEach(it => {
      const author = String(it.author || '');
      let post = null;
      if (author.startsWith('npc:')) {
        const npc = findNpc(story, author.slice(4));
        if (!npc) {
          /* 匿名发布：按原文作者名显示，绝不张冠李戴 */
          const nm = author.slice(4) || '路人';
          post = { authorType: 'netizen', npcId: null, name: nm, handle: '@' + nm };
        } else {
          post = { authorType: 'npc', npcId: npc.id, name: npc.name, handle: '@' + npc.name + '工作号' };
        }
      } else if (author.startsWith('marketing:')) {
        const name = author.slice(10) || '内娱观察bot';
        post = { authorType: 'marketing', npcId: null, name, handle: '@' + name };
      } else {
        const name = author.replace(/^netizen:/, '') || '热心网友';
        post = { authorType: 'netizen', npcId: null, name, handle: '@' + name.slice(0, 8) + '_用户' };
      }
      post.id = PW.Store.uid('wb');
      post.text = String(it.text || '').slice(0, 200);
      post.ts = Date.now() - Math.floor(Math.random() * 7200e3);
      post.likes = Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 900));
      post.reposts = Math.max(0, parseInt(it.reposts, 10) || Math.floor(Math.random() * 300));
      post.likedByMe = false;
      post.comments = (it.comments || []).slice(0, 5).map(c => ({
        id: PW.Store.uid('c'), name: String(c.name || '路人'), text: String(c.text || '').slice(0, 60)
      }));
      posts.push(post);
    });

    const supertopics = (obj.supertopics || []).slice(0, 6).map(t => {
      const type = /cp/i.test(String(t.type || '')) ? 'cp' : '个人';
      const playerName = story.player.name || '我';
      const members = (t.members || []).slice(0, 2).map(nm => {
        nm = String(nm || '').trim();
        if (!nm) return null;
        if (nm === playerName) return 'player';
        const npc = findNpc(story, nm);
        return npc ? npc.id : nm;
      }).filter(Boolean);
      return {
        name: String(t.name || '').slice(0, 16), type, members,
        readers: String(t.readers || (Math.random() * 3 + 0.2).toFixed(1) + '亿').slice(0, 8),
        postsN: String(t.postsN || (Math.random() * 90 + 5).toFixed(1) + '万').slice(0, 8),
        signed: false
      };
    });

    story.phone.weibo.hot = hot;
    /* 微博刷新：清掉玩家自己的旧帖和旧评论（用户内容只能用户自己发），新帖置顶 */
    const old = story.phone.weibo.posts.filter(p => !p.mine && !posts.some(x => x.text === p.text));
    story.phone.weibo.posts = posts.concat(old).slice(0, 24);
    story.phone.weibo.supertopics = supertopics;
    /* 微博内容入库共享记忆：热搜+帖子摘要（四端互通，剧情/微信可引用舆论动向） */
    if (posts.length || hot.length) {
      const digest = (hot.slice(0, 3).map(h => '#' + h.text).join(' ') || '') + '；帖子：' + posts.slice(0, 5).map(p => `${p.name}说「${p.text.slice(0, 50)}」`).join('；');
      await PW.App.addMemories(story, [{ kind: 'phone', scope: 'weibo', speaker: '微博', text: '微博舆论动态：' + digest }]);
    }
    return { hot, posts, supertopics };
  }

  /* ---------- 朋友圈：楼中楼（玩家回复NPC评论，由被回复的NPC回应） ---------- */
  async function replyToComment(story, moment, comment, text) {
    if (!comment.replies) comment.replies = [];
    comment.replies.push({ id: PW.Store.uid('r'), name: story.player.name || '我', mine: true, text: String(text).slice(0, 80) });
    /* 谁的评论谁回应：优先取评论作者的NPC；若评论来自帖主，则由帖主回应 */
    const npc = (story.npcs || []).find(x => x.id === comment.npcId)
      || (story.npcs || []).find(x => x.id === moment.npcId)
      || null;
    let npcReply = null;
    if (npc) {
      try {
        const { content } = await PW.Api.chat({
          messages: PW.Prompts.momentReplyToReplyPrompt(story, npc, moment.text, comment.text, text),
          stream: false, temperature: 1.15
        });
        npcReply = { id: PW.Store.uid('r'), name: npc.name, npcId: npc.id, text: (content || '').trim().slice(0, 80).replace(/^["「]|["」]$/g, '') };
        comment.replies.push(npcReply);
      } catch (e) { /* NPC回复失败不影响玩家回复 */ }
    }
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'moments', speaker: story.player.name, text: `（朋友圈楼中楼：玩家回复${comment.name}的评论「${comment.text}」说）${text}` + (npcReply ? `；${npc.name}回应「${npcReply.text}」` : '') }
    ]);
    return npcReply;
  }

  /* ---------- 微博：玩家发帖 ---------- */
  async function playerWeiboPost(story, text) {
    const post = {
      id: PW.Store.uid('wb'), authorType: 'me', npcId: null,
      name: story.player.name || '我', handle: '@' + (story.player.name || '我'),
      text: String(text).slice(0, 200), ts: Date.now(),
      likes: 0, reposts: 0, likedByMe: false, comments: [], mine: true
    };
    story.phone.weibo.posts.unshift(post);
    const memText = await memFor('微博 ' + text, ['weibo']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.weiboPlayerPostPrompt(story, text, memText), stream: false, temperature: 1.2 });
    let t = (content || '').trim();
    const mm = t.match(/\[[\s\S]*\]/);
    if (mm) t = mm[0];
    try {
      const arr = JSON.parse(t);
      arr.slice(0, 4).forEach(it => {
        const npc = findNpc(story, it.name);
        post.comments.push({
          id: PW.Store.uid('c'), name: String(it.name || '路人'),
          npcId: npc ? npc.id : null, text: String(it.text || '').slice(0, 60),
          likes: Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 200))
        });
      });
    } catch (e) { /* 评论解析失败不影响发帖 */ }
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 你发了一条微博`, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'weibo', speaker: story.player.name, text: `（玩家发微博）${text}` + (post.comments.length ? `；评论：${post.comments.map(c => `${c.name}说「${c.text}」`).join('、')}` : '') }
    ]);
    return post;
  }

  /* ---------- 微博评论（NPC回复；营销号/网友只留评论） ---------- */
  async function commentOnPost(story, post, text) {
    post.comments.push({ id: PW.Store.uid('c'), name: story.player.name || '我', text, mine: true });
    post.commentsN = (post.commentsN || post.comments.length) + 0;
    const scope = post.authorType != null ? 'weibo' : 'moments';
    await PW.App.addMemories(story, [{ kind: 'phone', scope, speaker: story.player.name, text: `（${scope === 'weibo' ? '微博评论' : '朋友圈评论'}：玩家在${post.name}的帖子下说）${text}` }]);
    /* 帖主回应：朋友圈按 npcId 找帖主（玩家自己的帖子 npcId 为空，无人回应）；微博同理 */
    const npc = post.npcId ? (story.npcs || []).find(x => x.id === post.npcId) : null;
    if (!npc) return null;
    const { content } = await PW.Api.chat({ messages: PW.Prompts.weiboReplyPrompt(story, npc, post.text, text), stream: false, temperature: 1.2 });
    const reply = { id: PW.Store.uid('c'), name: npc.name + '（本尊）', text: (content || '').trim().slice(0, 80).replace(/^["“]|["”]$/g, '') };
    post.comments.push(reply);
    return reply;
  }

  /* ---------- 微博：热搜词条详情 ---------- */
  async function hotDetail(story, hotText) {
    const memText = await memFor(hotText, ['weibo']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.hotDetailPrompt(story, hotText, memText), stream: false, temperature: 1.4 });
    const arr = parseJsonLoose(content);
    return arr.slice(0, 8).map(it => buildPost(story, it));
  }

  /* ---------- 微博：超话帖子流 ---------- */
  async function supertopicFeed(story, cha) {
    const memText = await memFor('超话 ' + cha.name + ' ' + (story.chat.summary || '').slice(0, 60), ['weibo']);
    const { content } = await PW.Api.chat({ messages: PW.Prompts.supertopicPrompt(story, cha, memText), stream: false, temperature: 1.4 });
    const arr = parseJsonLoose(content);
    return arr.slice(0, 8).map(it => buildPost(story, it));
  }

  /* 统一构造帖子对象 */
  function buildPost(story, it) {
    const author = String(it.author || 'netizen:路人');
    let post;
    if (author.startsWith('npc:')) {
      const npc = findNpc(story, author.slice(4));
      post = npc
        ? { authorType: 'npc', npcId: npc.id, name: npc.name, handle: '@' + npc.name + '工作号' }
        : { authorType: 'netizen', npcId: null, name: author.slice(4) || '路人', handle: '@' + author.slice(4) };
    } else if (author.startsWith('marketing:')) {
      const name = author.slice(10) || '内娱观察bot';
      post = { authorType: 'marketing', npcId: null, name, handle: '@' + name };
    } else {
      const name = author.replace(/^netizen:/, '') || '热心网友';
      post = { authorType: 'netizen', npcId: null, name, handle: '@' + name.slice(0, 8) + '_用户' };
    }
    post.id = PW.Store.uid('wb');
    post.text = String(it.text || '').slice(0, 200);
    post.ts = Date.now() - Math.floor(Math.random() * 7200e3);
    post.likes = Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 900));
    post.reposts = Math.max(0, parseInt(it.reposts, 10) || Math.floor(Math.random() * 300));
    post.likedByMe = false;
    post.comments = (it.comments || []).slice(0, 5).map(c => ({
      id: PW.Store.uid('c'), name: String(c.name || '路人'), npcId: null,
      text: String(c.text || '').slice(0, 60),
      likes: Math.max(0, parseInt(c.likes, 10) || Math.floor(Math.random() * 800))
    }));
    return post;
  }

  /* ---------- 微信群聊 ---------- */
  async function groupSend(story, group, text) {
    const list = story.phone.chats[group.id] || (story.phone.chats[group.id] = []);
    list.push({ id: PW.Store.uid('w'), role: 'me', text, ts: Date.now() });
    const memText = await memFor('群聊 ' + group.name + ' ' + text, ['wechat']);
    const { content } = await PW.Api.chat({
      messages: PW.Prompts.groupChatPrompt(story, group, text, list, memText),
      stream: false, temperature: 1.3
    });
    const replies = [];
    (content || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10).forEach(line => {
      const m = line.match(/^([^：:]{1,10})[：:]\s*(.+)$/);
      if (!m) return;
      const npc = findNpc(story, m[1]);
      if (!npc || !(group.memberIds || []).includes(npc.id)) return;
      replies.push({
        id: PW.Store.uid('w'), role: 'npc', name: npc.name, npcId: npc.id,
        text: m[2].replace(/^[\u201c"]|[\u201d"]$/g, '').slice(0, 120), ts: Date.now()
      });
    });
    list.push(...replies);
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 微信群「${group.name}」· 你说：${text.length > 20 ? text.slice(0, 20) + '…' : text}${replies.length ? ' ｜ ' + replies.map(r => r.name + '回复').join('、') : ''}`, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', scope: 'wechat', speaker: story.player.name, text: `（微信群「${group.name}」里玩家说）${text}` },
      { kind: 'phone', scope: 'wechat', speaker: '群聊', text: `（群里回复）${replies.map(r => `${r.name}：${r.text}`).join(' / ')}` }
    ]);
    return { replies };
  }

  window.PW.Phone = { wechatSend, proactiveWechat, genMoments, genWeibo, commentOnPost, hotDetail, supertopicFeed, groupSend, playerMomentPost, playerWeiboPost, replyToComment };
})();
