/* ============ 手机界面逻辑：微信 / 朋友圈 / 微博 ============ */
window.PW = window.PW || {};
(function () {
  /* ---------- 微信 ---------- */
  async function wechatSend(story, npc, text) {
    const chats = story.phone.chats;
    const list = chats[npc.id] || (chats[npc.id] = []);
    list.push({ id: PW.Store.uid('w'), role: 'me', text, ts: Date.now() });
    const { content, usage } = await PW.Api.chat({
      messages: PW.Prompts.phoneChatMessages(story, npc, text, list),
      stream: false, temperature: 1.2
    });
    const lines = (content || '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('['));
    const replies = lines.slice(0, 4).map(line => ({
      id: PW.Store.uid('w'), role: 'npc', text: line.replace(/^["“]|["”]$/g, ''), ts: Date.now()
    }));
    list.push(...replies);
    /* 记入主线旁注与 L3 记忆库，让剧情线知道这场聊天 */
    const note = `📱 微信 · ${npc.name}：${text.length > 24 ? text.slice(0, 24) + '…' : text}`;
    story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: note, ts: Date.now() });
    await PW.App.addMemories(story, [
      { kind: 'phone', speaker: story.player.name, text: `（微信上玩家对${npc.name}说）${text}` },
      { kind: 'phone', speaker: npc.name, text: `（微信上${npc.name}回复玩家）${replies.map(r => r.text).join(' / ')}` }
    ]);
    return { replies, usage };
  }

  /* ---------- 朋友圈 ---------- */
  async function genMoments(story, n) {
    const { content } = await PW.Api.chat({ messages: PW.Prompts.momentsPrompt(story, n), stream: false, temperature: 1.4 });
    let text = (content || '').trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (m) text = m[0];
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new Error('朋友圈内容解析失败，请重试'); }
    const name2npc = id => (story.npcs || []).find(x => x.name === id);
    const created = [];
    arr.slice(0, 5).forEach(it => {
      const npc = name2npc(it.npc) || (story.npcs || [])[0];
      if (!npc) return;
      created.push({
        id: PW.Store.uid('mo'), npcId: npc.id, name: npc.name, text: String(it.text || '').slice(0, 200),
        ts: Date.now() - Math.floor(Math.random() * 3600e3),
        likes: Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 60)),
        likedByMe: false,
        comments: (it.comments || []).slice(0, 4).map(c => ({
          id: PW.Store.uid('c'), name: String(c.name || '路人'), npcId: (name2npc(c.name) || {}).id || null, text: String(c.text || '').slice(0, 60)
        }))
      });
    });
    story.phone.moments.unshift(...created);
    if (story.phone.moments.length > 30) story.phone.moments.length = 30;
    if (created.length) {
      story.chat.messages.push({ id: PW.Store.uid('m'), kind: 'phone', text: `📱 朋友圈更新了（${created.map(c => c.name).join('、')}）`, ts: Date.now() });
      await PW.App.addMemories(story, [{ kind: 'phone', speaker: '朋友圈', text: 'NPC朋友圈动态：' + created.map(c => `${c.name}说「${c.text}」`).join('；') }]);
    }
    return created;
  }

  async function commentMoment(story, moment, text) {
    moment.comments.push({ id: PW.Store.uid('c'), name: story.player.name || '我', npcId: null, text, mine: true });
    const npc = (story.npcs || []).find(x => x.id === moment.npcId);
    if (!npc) return null;
    const { content } = await PW.Api.chat({ messages: PW.Prompts.momentReplyPrompt(story, npc, moment.text, text), stream: false, temperature: 1.2 });
    const reply = { id: PW.Store.uid('c'), name: npc.name, npcId: npc.id, text: (content || '').trim().slice(0, 80).replace(/^["“]|["”]$/g, '') };
    moment.comments.push(reply);
    return reply;
  }

  /* ---------- 微博 ---------- */
  async function genWeibo(story) {
    const { content } = await PW.Api.chat({ messages: PW.Prompts.weiboPrompt(story), stream: false, temperature: 1.4 });
    let text = (content || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (m) text = m[0];
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('微博内容解析失败，请重试'); }
    const name2npc = id => (story.npcs || []).find(x => x.name === id);
    const hot = (obj.hot || []).slice(0, 6).map((t, i) => ({ rank: i + 1, text: String(t).slice(0, 24), heat: (Math.random() * 480 + 20).toFixed(1) + '万' }));
    const posts = (obj.posts || []).slice(0, 4).map(it => {
      const npc = name2npc(it.npc) || (story.npcs || [])[0];
      return npc ? {
        id: PW.Store.uid('wb'), npcId: npc.id, name: npc.name, text: String(it.text || '').slice(0, 160),
        ts: Date.now(), likes: Math.max(0, parseInt(it.likes, 10) || Math.floor(Math.random() * 900)), likedByMe: false, reposts: Math.floor(Math.random() * 300), commentsN: Math.floor(Math.random() * 500)
      } : null;
    }).filter(Boolean);
    story.phone.weibo.hot = hot;
    story.phone.weibo.posts = posts.concat(story.phone.weibo.posts).slice(0, 20);
    return { hot, posts };
  }

  window.PW.Phone = { wechatSend, genMoments, commentMoment, genWeibo };
})();
