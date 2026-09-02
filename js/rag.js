/* ============ RAG 记忆引擎 ============
 * L3 长期记忆检索：思路 = 检索相关，而非保留全部。
 * - 写入：每条剧情消息向量化/分词后入库（IndexedDB，按故事隔离）
 * - 检索：当前输入扩展成 query，取 TOP_K 条最相关历史拼进上下文
 * - 双模式：
 *   1) bm25     —— 纯 JS 中文 bigram BM25，零下载零配置（默认）
 *   2) semantic —— Transformers.js 本地跑 bge-small-zh-v1.5（首次约95MB，之后离线）
 *      语义模式下两路分数加权融合，专有名词靠关键词路保底
 */
window.PW = window.PW || {};
(function () {
  const K1 = 1.5, B = 0.75;

  /* ---------- 分词：中文 bigram + 英文数字词 ---------- */
  function tokenize(text) {
    const t = (text || '').toLowerCase();
    const tokens = [];
    (t.match(/[a-z0-9]+/g) || []).forEach(w => tokens.push(w));
    (t.match(/[\u4e00-\u9fff]+/g) || []).forEach(seg => {
      if (seg.length === 1) { tokens.push(seg); return; }
      for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
    });
    return tokens;
  }

  /* ---------- BM25 索引（每个故事一份，常驻内存） ---------- */
  const indexes = new Map(); // storyId -> {docs:[{id,tf:Map,len}], df:Map, n, avgLen}

  function buildIndex(storyId, records) {
    const idx = { docs: [], df: new Map(), n: 0, avgLen: 0 };
    records.forEach(r => addToIndex(idx, r));
    indexes.set(storyId, idx);
    return idx;
  }
  function ensureIndex(storyId, records) {
    return indexes.get(storyId) || buildIndex(storyId, records);
  }
  function addToIndex(idx, rec) {
    const toks = tokenize(rec.text);
    if (!toks.length) return;
    const tf = new Map();
    toks.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
    idx.docs.push({ id: rec.id, tf, len: toks.length });
    idx.n += 1;
    idx.avgLen = idx.docs.reduce((s, d) => s + d.len, 0) / idx.n;
    tf.forEach((_, t) => idx.df.set(t, (idx.df.get(t) || 0) + 1));
  }
  function removeFromIndex(idx, id) {
    const i = idx.docs.findIndex(d => d.id === id);
    if (i < 0) return;
    const doc = idx.docs[i];
    doc.tf.forEach((_, t) => { const c = idx.df.get(t) || 1; c <= 1 ? idx.df.delete(t) : idx.df.set(t, c - 1); });
    idx.n -= 1;
    idx.docs.splice(i, 1);
    idx.avgLen = idx.n ? idx.docs.reduce((s, d) => s + d.len, 0) / idx.n : 0;
  }

  function searchBM25(idx, query, topK) {
    const q = tokenize(query);
    if (!q.length || !idx.n) return [];
    const scores = new Map();
    q.forEach(term => {
      const df = idx.df.get(term);
      if (!df) return;
      const idf = Math.log(1 + (idx.n - df + 0.5) / (df + 0.5));
      idx.docs.forEach(doc => {
        const f = doc.tf.get(term);
        if (!f) return;
        const norm = f * (K1 + 1) / (f + K1 * (1 - B + B * doc.len / idx.avgLen));
        scores.set(doc.id, (scores.get(doc.id) || 0) + idf * norm);
      });
    });
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({ id, score }));
  }

  /* ---------- 本地语义模型（可选，懒加载） ---------- */
  const sem = { pipe: null, loading: null, progress: 0 };

  async function ensureEmbedder(onProgress) {
    if (sem.pipe) return sem.pipe;
    if (sem.loading) return sem.loading;
    sem.loading = (async () => {
      const mod = await import(PW.CONFIG.EMBED_CDN);
      if (mod.env) {
        mod.env.remoteHost = PW.CONFIG.EMBED_MIRROR;          // 国内镜像
        mod.env.allowLocalModels = false;
      }
      sem.pipe = await mod.pipeline('feature-extraction', PW.CONFIG.EMBED_MODEL, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p && p.status === 'progress' && p.total) {
            sem.progress = Math.round(p.progress || (p.loaded / p.total) * 100);
            onProgress && onProgress(sem.progress);
          }
        }
      });
      sem.progress = 100;
      onProgress && onProgress(100);
      return sem.pipe;
    })();
    try { return await sem.loading; }
    catch (e) { sem.loading = null; sem.pipe = null; throw e; }
  }
  function embedProgress() { return sem.progress; }

  async function embedTexts(pipe, texts) {
    const out = await pipe(texts, { pooling: 'mean', normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const arr = [];
    for (let i = 0; i < texts.length; i++) {
      const v = new Float32Array(dim);
      for (let j = 0; j < dim; j++) v[j] = out.data[i * dim + j];
      arr.push(v);
    }
    return arr;
  }
  function cosine(a, b) {
    let s = 0; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  /* 为某故事全量重建语义向量（后台任务，带进度回调） */
  async function reindexSemantic(storyId, records, onProgress) {
    const pipe = await ensureEmbedder(onProgress);
    const BATCH = 8;
    let done = 0;
    const total = records.length;
    for (let i = 0; i < total; i += BATCH) {
      const batch = records.slice(i, i + BATCH).filter(r => r.text && r.text.trim());
      if (batch.length) {
        const vecs = await embedTexts(pipe, batch.map(r => r.text));
        for (let k = 0; k < batch.length; k++) { batch[k].vec = vecs[k]; }
        await PW.Store.memPut(batch);
      }
      done += batch.length;
      onProgress && onProgress(Math.round(done / Math.max(total, 1) * 100));
    }
    return true;
  }

  /* 保存时即时向量化：把一批已入库（vec=null）的记录逐个embed，回写向量。
   * 语义模式开启且模型就绪时，新记忆增量生成向量，无需依赖手动全量重建。 */
  async function embedRecords(records) {
    const todo = records.filter(r => !r.vec && r.text && r.text.trim());
    if (!todo.length) return;
    const pipe = await ensureEmbedder();
    const vecs = await embedTexts(pipe, todo.map(r => r.text));
    for (let k = 0; k < todo.length; k++) todo[k].vec = vecs[k];
    await PW.Store.memPut(todo);
  }

  /* ---------- 统一检索入口 ---------- */
  /**
   * @param records 故事的全部记忆记录 [{id, text, kind, speaker, chapter, ts, vec?}]
   * @param query   检索查询（玩家最新输入 + 最近对话扩展）
   * @returns {mode, hits:[{rec, score}], query}
   */
  async function search(storyId, records, query, topK, useSemantic) {
    const idx = ensureIndex(storyId, records);
    const bmHits = searchBM25(idx, query, topK * 4); // 先多取，供混合排序
    const byId = new Map(records.map(r => [r.id, r]));

    if (!useSemantic || !sem.pipe) {
      return {
        mode: 'bm25',
        query,
        hits: bmHits.slice(0, topK).map(h => ({ rec: byId.get(h.id), score: h.score })).filter(h => h.rec)
      };
    }

    // 语义路：query 向量 vs 所有带向量记忆（几千条暴力算也 <10ms）
    const [qv] = await embedTexts(sem.pipe, [query]);
    const semScores = [];
    for (const r of records) {
      if (r.vec && r.vec.length) {
        semScores.push({ id: r.id, score: cosine(qv, r.vec) });
      }
    }
    semScores.sort((a, b) => b.score - a.score);

    // 分数归一化后加权融合
    const norm = arr => {
      if (!arr.length) return arr;
      const max = arr[0].score, min = arr[arr.length - 1].score || 1;
      return arr.map(x => ({ id: x.id, score: (x.score - min) / Math.max(max - min, 1e-6) }));
    };
    const a = norm(semScores.slice(0, topK * 4));
    const b = norm(bmHits);
    const sa = new Map(a.map(x => [x.id, x.score]));
    const sb = new Map(b.map(x => [x.id, x.score]));
    const ids = new Set([...sa.keys(), ...sb.keys()]);
    const W = PW.CONFIG.EMBED_WEIGHT;
    const merged = Array.from(ids).map(id => ({
      id,
      score: (sa.get(id) || 0) * W + (sb.get(id) || 0) * (1 - W)
    })).sort((x, y) => y.score - x.score).slice(0, topK);

    return {
      mode: 'semantic',
      query,
      hits: merged.map(h => ({ rec: byId.get(h.id), score: h.score })).filter(h => h.rec)
    };
  }

  window.PW.Rag = {
    tokenize, ensureIndex, buildIndex, addToIndex, removeFromIndex, searchBM25,
    ensureEmbedder, embedProgress, embedTexts, reindexSemantic, embedRecords, search,
    isSemanticReady: () => !!sem.pipe
  };
})();
