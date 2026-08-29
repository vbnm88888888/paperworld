/* ============ 好感度/状态隐藏标记解析 ============ */
/* AI 在回复末尾输出（前端剔除，玩家不可见）：
 *   [[AFF:名字:+3]] / [[AFF:名字:-5]]   —— 好感变化
 *   [[STATE:名字:受伤了]]               —— 当前状态更新
 */
window.PW = window.PW || {};
(function () {
  const AFF_RE = /\[\[AFF:([^:\]]+):([+\-]?\d+)\]\]/g;
  const STATE_RE = /\[\[STATE:([^:\]]+):([^\]]+)\]\]/g;

  /**
   * 解析并剔除隐藏标记
   * @returns {clean, affs:[{name,delta}], states:[{name,state}]}
   */
  function parse(text) {
    const affs = [], states = [];
    let clean = (text || '');
    clean = clean.replace(AFF_RE, (_, name, delta) => { affs.push({ name: name.trim(), delta: parseInt(delta, 10) || 0 }); return ''; });
    clean = clean.replace(STATE_RE, (_, name, state) => { states.push({ name: name.trim(), state: state.trim() }); return ''; });
    return { clean: clean.replace(/\n{3,}/g, '\n\n').trimEnd(), affs, states };
  }

  /* 应用到故事 NPC，返回飘字事件 [{npc, delta}|{npc, state}] */
  function apply(story, parsed) {
    const fx = [];
    const find = name => {
      const n = (story.npcs || []).find(x => x.name === name) ||
                (story.npcs || []).find(x => x.name && x.name.includes(name)) || null;
      return n;
    };
    (parsed.affs || []).forEach(a => {
      const npc = find(a.name);
      if (npc) {
        npc.affinity = Math.max(-100, Math.min(100, (npc.affinity == null ? 50 : npc.affinity) + a.delta));
        if (a.delta !== 0) fx.push({ type: 'aff', npc: npc.name, delta: a.delta });
      }
    });
    (parsed.states || []).forEach(st => {
      const npc = find(st.name);
      if (npc) { npc.state = st.state; fx.push({ type: 'state', npc: npc.name, state: st.state }); }
    });
    return fx;
  }

  window.PW.Affinity = { parse, apply };
})();
