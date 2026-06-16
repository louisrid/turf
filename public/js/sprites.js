/* TURF sprites. Procedural 8-bit figures. Pure ctx drawing so it runs in the
   browser and in a node preview. Exposes globalThis.Sprites. */
(function () {
  const SKIN = {
    pale:  ['#f6d9bf', '#e0bd9a'],
    light: ['#f1c9a5', '#d8a87f'],
    mid:   ['#d8a878', '#b9874f'],
    olive: ['#c9a26a', '#a47c44'],
    tan:   ['#c08a52', '#9c6a36'],
    brown: ['#9c6a3c', '#7a4f28'],
    dark:  ['#6e4a2c', '#523418'],
    deep:  ['#553318', '#3c240f'],
  };
  const HAIR = {
    black: '#26262b', brown: '#4a3320', auburn: '#7a3b1e', blonde: '#d9b35f',
    ginger: '#b5572a', grey: '#b9bcc4', platinum: '#e9e6da',
  };
  const KIT = {
    red:  { main: '#d11f2d', dark: '#9c1622', trim: '#f4f4f4', shorts: '#b11622', socks: '#d11f2d' },
    blue: { main: '#1f4fd1', dark: '#163a9c', trim: '#f4f4f4', shorts: '#173da6', socks: '#1f4fd1' },
  };
  const GK_KIT = {
    red:  { main: '#19a64a', dark: '#127a37', trim: '#0c5224', shorts: '#1c1c1f', socks: '#19a64a' },
    blue: { main: '#f2c200', dark: '#c39d00', trim: '#3a2f00', shorts: '#1c1c1f', socks: '#f2c200' },
  };
  const BOOT = '#f4f4f4', BOOT_D = '#c9c9c9', OUTLINE = '#1b1b20', EYE = '#ffffff';

  // 3x5 pixel digits for shirt numbers
  const DIGITS = {
    0:['111','101','101','101','111'],1:['010','110','010','010','111'],
    2:['111','001','111','100','111'],3:['111','001','111','001','111'],
    4:['101','101','111','001','001'],5:['111','100','111','001','111'],
    6:['111','100','111','101','111'],7:['111','001','010','010','010'],
    8:['111','101','111','101','111'],9:['111','101','111','001','111'],
  };

  function rect(ctx, ox, oy, U, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(ox + x * U), Math.round(oy + y * U), Math.round(w * U), Math.round(h * U));
  }

  function drawNumber(ctx, ox, oy, U, x, y, num, color) {
    const s = String(num);
    const dw = 3, gap = 1;
    let cx = x - Math.floor((s.length * dw + (s.length - 1) * gap) / 2) + 4;
    for (const ch of s) {
      const g = DIGITS[ch]; if (!g) { cx += dw + gap; continue; }
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++)
        if (g[r][c] === '1') rect(ctx, ox, oy, U, cx + c, y + r, 1, 1, color);
      cx += dw + gap;
    }
  }

  function hairTop(ctx, ox, oy, U, hc, style, back) {
    // top cap region around the head (head occupies x5..x10)
    if (style === 'bald') return;
    if (style === 'afro') {
      rect(ctx, ox, oy, U, 3, 0, 10, 4, hc);
      rect(ctx, ox, oy, U, 2, 2, 2, 4, hc); rect(ctx, ox, oy, U, 12, 2, 2, 4, hc);
    } else if (style === 'curly') {
      rect(ctx, ox, oy, U, 4, 0, 8, 3, hc);
      rect(ctx, ox, oy, U, 3, 2, 2, 3, hc); rect(ctx, ox, oy, U, 11, 2, 2, 3, hc);
    } else if (style === 'cornrows') {
      rect(ctx, ox, oy, U, 4, 1, 8, 2, hc);
      for (let x = 5; x <= 10; x += 2) rect(ctx, ox, oy, U, x, 1, 1, 3, hc);
      if (back) rect(ctx, ox, oy, U, 5, 2, 6, 3, hc);
    } else if (style === 'spiky') {
      rect(ctx, ox, oy, U, 4, 1, 8, 2, hc);
      for (let x = 5; x <= 10; x += 2) rect(ctx, ox, oy, U, x, -1, 1, 2, hc);
    } else if (style === 'fade') {
      rect(ctx, ox, oy, U, 5, 0, 6, 3, hc);
    } else if (style === 'manbun') {
      rect(ctx, ox, oy, U, 5, 1, 6, 2, hc);
      rect(ctx, ox, oy, U, 7, -1, 2, 2, hc); // bun on top
      if (back) { rect(ctx, ox, oy, U, 5, 2, 6, 3, hc); rect(ctx, ox, oy, U, 7, 0, 2, 2, hc); }
    } else if (style === 'mohawk') {
      rect(ctx, ox, oy, U, 7, -1, 2, 4, hc);
    } else if (style === 'long') {
      rect(ctx, ox, oy, U, 4, 0, 8, 3, hc);
      rect(ctx, ox, oy, U, 4, 2, 2, 6, hc); rect(ctx, ox, oy, U, 10, 2, 2, 6, hc);
    } else if (style === 'buzz') {
      rect(ctx, ox, oy, U, 5, 1, 6, 2, hc);
    } else { // short (default)
      rect(ctx, ox, oy, U, 4, 0, 8, 3, hc);
      rect(ctx, ox, oy, U, 4, 2, 1, 2, hc); rect(ctx, ox, oy, U, 11, 2, 1, 2, hc);
    }
    if (style === 'ponytail') {
      rect(ctx, ox, oy, U, 4, 0, 8, 3, hc);
      if (back) rect(ctx, ox, oy, U, 7, 3, 2, 5, hc);
    }
  }

  // Detailed figure (used in the 1v1). box ~16 wide x 22 tall pixels.
  function drawFigure(ctx, ox, oy, U, o) {
    const [sk, skD] = SKIN[o.skin] || SKIN.light;
    const hc = HAIR[o.hairColor] || HAIR.black;
    const kit = (o.role === 'gk' ? GK_KIT : KIT)[o.team] || KIT.blue;
    const back = o.view === 'back';
    const gk = o.role === 'gk';

    // legs / socks / boots
    rect(ctx, ox, oy, U, 5, 18, 2, 2, sk); rect(ctx, ox, oy, U, 9, 18, 2, 2, sk);
    rect(ctx, ox, oy, U, 5, 19, 2, 2, kit.socks); rect(ctx, ox, oy, U, 9, 19, 2, 2, kit.socks);
    rect(ctx, ox, oy, U, 4, 21, 4, 1, BOOT); rect(ctx, ox, oy, U, 8, 21, 4, 1, BOOT);
    rect(ctx, ox, oy, U, 4, 21, 1, 1, BOOT_D); rect(ctx, ox, oy, U, 11, 21, 1, 1, BOOT_D);

    // shorts
    rect(ctx, ox, oy, U, 4, 15, 8, 4, gk ? GK_KIT[o.team].shorts : kit.shorts);
    rect(ctx, ox, oy, U, 7, 16, 2, 3, '#00000022');

    // arms
    if (gk) {
      rect(ctx, ox, oy, U, 2, 10, 2, 5, kit.main); rect(ctx, ox, oy, U, 12, 10, 2, 5, kit.main);
      rect(ctx, ox, oy, U, 2, 14, 2, 2, '#eaeaea'); rect(ctx, ox, oy, U, 12, 14, 2, 2, '#eaeaea'); // gloves
      rect(ctx, ox, oy, U, 2, 14, 2, 1, '#c0282f');
    } else {
      rect(ctx, ox, oy, U, 2, 10, 2, 4, sk); rect(ctx, ox, oy, U, 12, 10, 2, 4, sk);
      rect(ctx, ox, oy, U, 2, 13, 2, 1, skD); rect(ctx, ox, oy, U, 12, 13, 2, 1, skD);
      rect(ctx, ox, oy, U, 2, 14, 2, 1, sk); rect(ctx, ox, oy, U, 12, 14, 2, 1, sk); // hands
    }

    // torso
    rect(ctx, ox, oy, U, 4, 9, 8, 6, kit.main);
    rect(ctx, ox, oy, U, 4, 9, 8, 1, kit.dark);          // shoulder shade
    rect(ctx, ox, oy, U, 4, 14, 8, 1, kit.dark);
    if (!gk) { rect(ctx, ox, oy, U, 7, 9, 2, 1, kit.trim); } // collar hint (front/back)
    if (back && !gk && o.number != null) drawNumber(ctx, ox, oy, U, 4, 10, o.number, kit.trim);

    // neck
    rect(ctx, ox, oy, U, 7, 8, 2, 1, skD);

    // head
    if (back) {
      rect(ctx, ox, oy, U, 5, 2, 6, 6, hc);       // back of head = hair
      rect(ctx, ox, oy, U, 6, 7, 4, 1, sk);       // bit of neck/skin
    } else {
      rect(ctx, ox, oy, U, 5, 3, 6, 5, sk);
      rect(ctx, ox, oy, U, 5, 7, 6, 1, skD);      // jaw shade
      if (o.beard) {                               // beard along the jaw + chin
        rect(ctx, ox, oy, U, 5, 6, 6, 2, hc);
        rect(ctx, ox, oy, U, 5, 5, 1, 2, hc); rect(ctx, ox, oy, U, 10, 5, 1, 2, hc);
        rect(ctx, ox, oy, U, 6, 6, 4, 1, sk);      // mouth gap
      }
      rect(ctx, ox, oy, U, 6, 5, 1, 1, EYE); rect(ctx, ox, oy, U, 9, 5, 1, 1, EYE);
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(Math.round(ox + 6.3 * U), Math.round(oy + 5 * U), Math.max(1, Math.round(0.5 * U)), Math.max(1, Math.round(U)));
      ctx.fillRect(Math.round(ox + 9.0 * U), Math.round(oy + 5 * U), Math.max(1, Math.round(0.5 * U)), Math.max(1, Math.round(U)));
    }
    hairTop(ctx, ox, oy, U, hc, o.hair, back);
  }

  // Small grid figure. box ~12 wide x 14 tall. Dominant kit colour, arms out.
  function drawGrid(ctx, ox, oy, U, o) {
    const [sk] = SKIN[o.skin] || SKIN.light;
    const hc = HAIR[o.hairColor] || HAIR.black;
    const kit = (o.role === 'gk' ? GK_KIT : KIT)[o.team] || KIT.blue;
    // legs
    rect(ctx, ox, oy, U, 4, 11, 2, 2, kit.shorts); rect(ctx, ox, oy, U, 6, 11, 2, 2, kit.shorts);
    rect(ctx, ox, oy, U, 4, 12, 2, 1, '#f0f0f0'); rect(ctx, ox, oy, U, 6, 12, 2, 1, '#f0f0f0');
    // arms out
    rect(ctx, ox, oy, U, 2, 6, 2, 3, o.role === 'gk' ? kit.main : sk);
    rect(ctx, ox, oy, U, 8, 6, 2, 3, o.role === 'gk' ? kit.main : sk);
    // body
    rect(ctx, ox, oy, U, 3, 6, 6, 5, kit.main);
    rect(ctx, ox, oy, U, 3, 6, 6, 1, kit.dark);
    // head
    rect(ctx, ox, oy, U, 4, 2, 4, 4, sk);
    rect(ctx, ox, oy, U, 3, 1, 6, 2, hc);
    rect(ctx, ox, oy, U, 3, 2, 1, 2, hc); rect(ctx, ox, oy, U, 8, 2, 1, 2, hc);
    if (o.hair === 'afro' || o.hair === 'curly') { rect(ctx, ox, oy, U, 3, 0, 6, 2, hc); }
  }

  function teamFromColor(c) { return c; } // 'red' | 'blue'

  globalThis.Sprites = {
    drawFigure, drawGrid, KIT, GK_KIT, SKIN, HAIR,
    SKINS: Object.keys(SKIN),
    HAIRCOLORS: Object.keys(HAIR),
    HAIRSTYLES: ['short', 'buzz', 'fade', 'spiky', 'curly', 'afro', 'cornrows', 'manbun', 'ponytail', 'long', 'mohawk', 'bald'],
    FIG_W: 16, FIG_H: 22, GRID_W: 12, GRID_H: 14,
  };
})();
