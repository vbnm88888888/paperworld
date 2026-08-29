/* ============ 纸上人间 · 全局配置 ============ */
window.PW = window.PW || {};

PW.CONFIG = {
  APP_NAME: '纸上人间',
  DATA_KEY: 'paperworld.v1',

  DEFAULT_API_BASE: 'https://api.deepseek.com',
  MODELS: [
    { id: 'deepseek-chat', name: 'DeepSeek-V3 · 默认 · 快' },
    { id: 'deepseek-reasoner', name: 'DeepSeek-R1 · 深度推演 · 慢' }
  ],
  DEFAULT_TEMPERATURE: 1.3,

  // ---- 四层记忆参数 ----
  TOP_K: 6,            // L3 RAG 每次检索条数
  RECENT_TURNS: 16,    // L1 短期记忆：保留最近原文条数
  SUMMARY_EVERY: 36,   // 未摘要消息超过该值时触发 L2 滚动摘要
  MIN_SUMMARY_LEN: 40, // 摘要过短视为失败，不写入

  // ---- 本地语义模型（可选增强）----
  EMBED_MODEL: 'Xenova/bge-small-zh-v1.5',
  EMBED_MIRROR: 'https://hf-mirror.com',
  EMBED_CDN: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  EMBED_WEIGHT: 0.65,  // 混合检索中语义分数权重（关键词 0.35）

  MAX_AVATAR_PX: 128,  // 上传头像压缩尺寸
  TOKEN_DIVISOR: 1.6   // 中文 token 粗估：字符数 / 1.6
};

PW.DEFAULT_SETTINGS = {
  apiKey: '',
  apiBase: PW.CONFIG.DEFAULT_API_BASE,
  model: 'deepseek-chat',
  temperature: PW.CONFIG.DEFAULT_TEMPERATURE,
  theme: 'auto',                 // auto | light | dark
  memoryMode: 'bm25',            // bm25 | semantic
  topK: PW.CONFIG.TOP_K,
  recentTurns: PW.CONFIG.RECENT_TURNS,
  guideSeen: false,
  lastErr: ''
};

// 文风预设
PW.STYLES = [
  { id: 'delicate', name: '细腻言情', desc: '笔触细腻，注重情绪与氛围的描写，情感张力拉满' },
  { id: 'fast',     name: '爽快节奏', desc: '节奏明快，冲突密集，读起来痛快过瘾' },
  { id: 'humor',    name: '幽默轻松', desc: '语带俏皮，妙趣横生，偶尔打破 fourth wall 的调侃' },
  { id: 'classical',name: '古风雅致', desc: '遣词古雅，意境悠远，善用意象留白' },
  { id: 'cold',     name: '冷峻悬疑', desc: '克制冷静，信息藏在细节里，压迫感与反转' },
  { id: 'hot',      name: '热血少年', desc: '燃点密集，战斗与成长描写酣畅淋漓' }
];
