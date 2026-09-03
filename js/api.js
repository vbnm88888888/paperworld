/* ============ DeepSeek API 客户端（OpenAI 兼容） ============ */
window.PW = window.PW || {};
(function () {
  /* 规范化 base：补 /v1（若用户没写）；最终 endpoint = base + /chat/completions */
  function endpoint(base) {
    let b = (base || PW.CONFIG.DEFAULT_API_BASE).trim().replace(/\/+$/, '');
    if (!/\/v\d+$/.test(b)) b += '/v1';
    return b + '/chat/completions';
  }

  function errHint(status, bodyText) {
    if (status === 401) return 'API Key 无效或已过期，请到「设置」检查 Key';
    if (status === 402) return '账户余额不足，请到 DeepSeek 平台充值';
    if (status === 422) return '请求参数错误（多为主键/上下文超限），可尝试清空部分剧情或减小记忆层数';
    if (status === 429) return '请求过于频繁（限流），稍等几秒再试';
    if (status >= 500) return 'DeepSeek 服务器开小差了，请稍后重试';
    if (bodyText && /unexpected end of hex escape|Failed to parse the request body/i.test(bodyText))
      return '请求内容含异常字符（孤立代理项），已自动清洗，请重试';
    return '请求失败（HTTP ' + status + '）' + (bodyText ? '：' + bodyText.slice(0, 120) : '');
  }

  /* 清除字符串中的孤立代理项（高低代理对不完整，多为按码元截断 emoji 所致）。
   * DeepSeek 网关(serde_json)会因这类字节返回 400: unexpected end of hex escape。 */
  function scrubSurrogates(s) {
    if (typeof s !== 'string') return s;
    return s
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')   // 孤立高代理
      .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1\uFFFD'); // 孤立低代理
  }
  function scrubPayload(obj) {
    if (typeof obj === 'string') return scrubSurrogates(obj);
    if (Array.isArray(obj)) return obj.map(scrubPayload);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k in obj) out[k] = scrubPayload(obj[k]);
      return out;
    }
    return obj;
  }

  /**
   * 发起一次对话
   * @param opt {messages, temperature, model, stream, onDelta(text), signal}
   * @returns {content, usage:{prompt_tokens, completion_tokens}}
   */
  async function chat(opt) {
    const s = PW.App.settings;
    if (!s.apiKey) {
      const e = new Error('还没有配置 API Key'); e.code = 'NO_KEY'; throw e;
    }
    const body = {
      model: opt.model || s.model || 'deepseek-chat',
      messages: opt.messages,
      temperature: opt.temperature != null ? opt.temperature : s.temperature,
      stream: opt.stream !== false
    };
    if (body.stream) body.stream_options = { include_usage: true };

    /* 发送前清洗孤立代理项，避免 DeepSeek 网关 400 */
    const safeBody = scrubPayload(body);

    let res, lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(endpoint(s.apiBase), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
          body: JSON.stringify(safeBody),
          signal: opt.signal
        });
        if (res.ok) { lastErr = null; break; }
        const t = await res.text().catch(() => '');
        if (res.status === 429 || res.status >= 500) { lastErr = new Error(errHint(res.status, t)); await new Promise(r => setTimeout(r, 900)); continue; }
        const e = new Error(errHint(res.status, t)); e.code = 'HTTP_' + res.status; throw e;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (err.code) throw err;
        lastErr = err;
        if (attempt === 0) await new Promise(r => setTimeout(r, 800));
      }
    }
    if (lastErr) {
      if (lastErr.code) throw lastErr;
      const e = new Error('网络错误：无法连接到 API。若你的网络拦截了直连，可在「设置→接口地址」换成 OpenAI 兼容中转地址');
      e.code = 'NETWORK'; e.cause = lastErr; throw e;
    }

    if (!body.stream) {
      const data = await res.json();
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      return { content: (msg && msg.content) || '', usage: data.usage || null };
    }

    /* ---- SSE 流式解析 ---- */
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '', content = '', usage = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // 半行留到下一轮
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && delta.content) { content += delta.content; opt.onDelta && opt.onDelta(delta.content, content); }
          if (json.usage) usage = json.usage;
        } catch (e) { /* 忽略无法解析的心跳/半包 */ }
      }
    }
    return { content, usage };
  }

  window.PW.Api = { endpoint, chat, errHint };
})();
