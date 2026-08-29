/* ============ NPC 随机生成（双通道） ============ */
window.PW = window.PW || {};
(function () {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* 通道一：本地题库（离线、零token） */
  function localRandom(genreKey, existingNames) {
    const tpl = PW.TEMPLATES[genreKey];
    const pool = (tpl && tpl.pool) || PW.GENERIC_POOL;
    const gender = Math.random() < 0.5 ? '男' : '女';
    let name = pick(pool.names);
    let guard = 0;
    while ((existingNames || []).includes(name) && guard++ < 20) name = pick(pool.names);
    return {
      name, gender,
      age: String(18 + Math.floor(Math.random() * 20)),
      identity: pick(pool.identities),
      personality: pick(pool.personalities),
      appearance: pick(pool.appearances),
      speech: pick(pool.speeches),
      relation: pick(pool.relations),
      secret: pick(pool.secrets),
      greeting: '（初次见面，让 TA 按性格自然开口吧）',
      avatar: null
    };
  }

  /* 通道二：AI 生成（走 DeepSeek，返回 JSON） */
  async function aiRandom(story, hint) {
    const messages = PW.Prompts.npcGenPrompt(story, hint);
    const { content } = await PW.Api.chat({ messages, stream: false, temperature: 1.4 });
    let text = (content || '').trim();
    // 剥掉可能的 markdown 代码块
    const m = text.match(/\{[\s\S]*\}/);
    if (m) text = m[0];
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('AI 返回的人设格式解析失败，请重试'); }
    return {
      name: obj.name || '无名者',
      gender: obj.gender || '未知',
      age: String(obj.age || '?'),
      identity: obj.identity || '',
      personality: obj.personality || '',
      appearance: obj.appearance || '',
      speech: obj.speech || '',
      relation: obj.relation || '',
      secret: obj.secret || '',
      greeting: obj.greeting || '',
      avatar: null
    };
  }

  window.PW.RandomNpc = { localRandom, aiRandom };
})();
