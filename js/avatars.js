/* ============ 头像系统：程序化SVG生成 + emoji库 + 上传压缩(在store) ============ */
window.PW = window.PW || {};
(function () {
  function hashCode(str) {
    let h = 5381;
    for (let i = 0; i < (str || '').length; i++) h = ((h << 5) + h + str.charCodeAt(i)) & 0x7fffffff;
    return h;
  }
  /* 按名字播种生成几何风头像（渐变底 + 装饰形 + 首字） */
  function genAvatar(name, c1, c2) {
    const h = hashCode(name || '匿名');
    const hueShift = (h % 40) - 20;
    const base1 = c1 || '#5b6c8f', base2 = c2 || '#8ea6c0';
    const deco = [
      `<circle cx="${20 + (h % 40)}" cy="${14 + (h % 30)}" r="${8 + (h % 14)}" fill="#ffffff" opacity="0.12"/>`,
      `<circle cx="${76 - (h % 30)}" cy="${80 - (h % 26)}" r="${10 + (h % 12)}" fill="#ffffff" opacity="0.10"/>`,
      `<rect x="${(h % 20)}" y="${70 - (h % 18)}" width="26" height="26" rx="6" fill="#000000" opacity="0.08" transform="rotate(${h % 40 - 20} 12 80)"/>`
    ].join('');
    const ch = (name || '?').trim().charAt(0).toUpperCase() || '?';
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${base1}"/><stop offset="1" stop-color="${base2}"/></linearGradient>` +
      `<filter id="hs"><feColorMatrix type="hueRotate" values="${hueShift}"/></filter></defs>` +
      `<rect width="96" height="96" rx="24" fill="url(#g)" filter="url(#hs)"/>` + deco +
      `<text x="48" y="62" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="42" font-weight="700" fill="#ffffff" text-anchor="middle">${ch}</text>` +
      `</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* avatar 对象 {type:'gen'|'emoji'|'img', value} -> 可显示URL/emoji */
  function resolve(avatar, name, c1, c2) {
    if (!avatar || avatar.type === 'gen' || !avatar.value) return genAvatar(name, c1, c2);
    if (avatar.type === 'emoji') return avatar.value;
    if (avatar.type === 'img') return avatar.value;
    return genAvatar(name, c1, c2);
  }

  /* 每题材 emoji 头像库 */
  const EMOJI = {
    modern: ['🧑‍💼','👩‍💻','🕴️','🐱','☕','🌃','💼','🎧','🚕','🥂','🏃','🕶️'],
    campus: ['🎒','📚','🏀','🎨','🎼','🧢','✏️','🌸','⚽','📖','🎧','🌈'],
    entertainment: ['🎬','🎤','🌟','📸','🏆','🎭','💄','🎞️','🕺','🎧','🥇','🌹'],
    rich: ['💎','⌚','🥂','🎩','👑','🕍','💼','🃏','🚁','💍','🕰️','🧳'],
    ancient: ['🏮','🌸','🗡️','👘','🪷','📜','🫖','🎑','🎋','🏹','🪭','🕯️'],
    palace: ['👑','🍵','🪞','🧵','🌂','🪶','🥮','🎋','🪷','🕯️','📜','🀄'],
    wuxia: ['⚔️','🍶','🐺','🏔️','🏹','🥋','🐍','🍂','🗡️','🎯','🐂','🌙'],
    xianxia: ['⛰️','🧙','☯️','🗡️','🪷','🌬️','🔮','🐲','🍵','🌟','📿','🌫️'],
    abo: ['🐾','🌹','🧣','🌙','💊','🫀','🌸','🥀','🧸','☕','🖤','💦'],
    scifi: ['🤖','🛸','🚀','🌌','🧬','💾','🦾','📡','⚡','🪐','🔭','💠'],
    apocalypse: ['🧟','🥫','🔦','🪓','⛺','🐕','🧭','🩹','☢️','🚒','🔪','🌧️'],
    mystery: ['🕯️','🔍','🪞','🕸️','🌧️','🚪','📼','🔑','🪦','🎩','🧩','🌙'],
    fantasy: ['🐉','🧝','🛡️','🔮','⚔️','🏰','🧌','🍺','📜','🦉','💰','🕯️'],
    blank: ['📖','✨','🎭','🌙','⭐','🍃','🌊','🔥']
  };
  function emojiPool(genreKey) { return EMOJI[genreKey] || EMOJI.blank; }

  window.PW.Avatars = { genAvatar, resolve, emojiPool, hashCode };
})();
