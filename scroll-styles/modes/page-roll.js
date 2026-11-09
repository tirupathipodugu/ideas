// Page Roll: the feed column becomes a book, one post per page, and the paper follows your hand.
// X's menu, header and sidebar are left alone.
(() => {
  const COLUMN = '[data-testid="primaryColumn"]';
  const NOT_A_FEED = /\/status\/|^\/(messages|settings|compose|i\/)/;
  const NOTE = 'data-ssx-note';
  const NOTE_STYLES = 6;
  const BAR = 58; // Strip under the book that holds the sticky-note controls.

  const LEAF_STEP = 6; // Width of one slice of the turning sheet, in pixels.
  const REST_STEP = 12; // A resting page barely bends, so it uses wider slices.
  const CURL = 2.2; // Higher is a tighter roll in the turning sheet.
  const LEAN = 0.24; // How far the fold slants when you grab near the top or bottom.
  const WHEEL_TRAVEL = 720; // Trackpad pixels for a full turn.
  const WHEEL_NOTCH = 80; // A single event this big is a mouse wheel click, not a trackpad.
  const WHEEL_HOLD = 200; // No wheel events for this long (ms) means the fingers lifted.
  const WHEEL_COMMIT = 0.14;
  const DRAG_COMMIT = 0.45;
  const DRAG_START = 8;
  const MAX_QUEUE = 3;
  const FAN_LAYERS = 14;
  const FAN_DX = 4.5, FAN_DY = 1.2, FAN_DZ = 1.6;
  const FAN_MIN_LEFT = 10; // Pages already behind you when the book opens.
  const READ_AHEAD = 10; // Posts to keep collected beyond the open page.

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const dialogOpen = () => !!document.querySelector('[aria-modal="true"]');
  const isTyping = (t) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function hasInnerScroller(target) {
    let n = target instanceof Element ? target : null;
    while (n && n !== document.body && n !== document.documentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
      n = n.parentElement;
    }
    return false;
  }

  function isPinnedToScreen(node, col) {
    for (let n = node; n && n !== col; n = n.parentElement) {
      if (/(sticky|fixed)/.test(getComputedStyle(n).position)) return true;
    }
    return false;
  }

  // How far down the column's pinned header reaches.
  function headerBottom(col) {
    const r = col.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const isHeader = (y) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && col.contains(hit) && isPinnedToScreen(hit, col);
    };
    for (let y = 0; y < Math.min(260, innerHeight / 2); y += 4) {
      if (isHeader(y)) continue;
      while (y > 0 && !isHeader(y - 1)) y--; // Coarse probe found it; settle on the exact pixel.
      return y;
    }
    return 0;
  }

  // The pieces of X around the book that are dressed as sticky notes. They stay X's own working elements.
  function sidebarBlocks() {
    const side = document.querySelector('[data-testid="sidebarColumn"]');
    if (!side) return [];
    const found = [...side.querySelectorAll('form[role="search"], aside, section, nav')];
    return found
      .filter((n) => !found.some((other) => other !== n && other.contains(n)))
      .map((n) => {
        let block = n; // Take the card around it, so X's own border and background go too.
        for (let i = 0; i < 4 && block.parentElement !== side && block.parentElement.children.length === 1; i++) block = block.parentElement;
        return block;
      });
  }

  function pinnedHeader(col) {
    const r = col.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, 2);
    if (!hit || !col.contains(hit) || hit.closest('.ssx-book')) return null;
    for (let n = hit; n && n !== col; n = n.parentElement) {
      if (/(sticky|fixed)/.test(getComputedStyle(n).position)) return n;
    }
    return null;
  }

  let noteCount = 0;
  function markNotes(col) {
    const pieces = [...document.querySelectorAll('header[role="banner"] a, header[role="banner"] button, [data-testid="DMDrawer"]'), ...sidebarBlocks()];
    pieces.forEach((n) => { if (!n.hasAttribute(NOTE)) n.setAttribute(NOTE, String(noteCount++ % NOTE_STYLES)); });
    const head = pinnedHeader(col);
    if (head) head.setAttribute(NOTE, 'flat'); // Straight, so the feed never peeks out behind it.
  }

  const clearNotes = () => document.querySelectorAll(`[${NOTE}]`).forEach((n) => n.removeAttribute(NOTE));

  // Text of a node, keeping the emoji X draws as images.
  function textOf(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue;
      else if (n.nodeName === 'IMG') out += n.alt || '';
      else if (n.nodeName === 'BR') out += '\n';
      else if (n.nodeType === Node.ELEMENT_NODE) out += textOf(n);
    });
    return out;
  }

  function readPost(article) {
    const byline = article.querySelector('[data-testid="User-Name"]');
    if (!byline) return null;
    const links = [...byline.querySelectorAll('a')];
    const name = textOf(links[0] || byline).trim().split('\n')[0];
    const handle = (textOf(byline).match(/@\w+/) || [''])[0];
    const words = article.querySelector('[data-testid="tweetText"]');
    const text = words ? textOf(words).trim() : '';
    const time = article.querySelector('time');
    const stamp = time && time.closest('a');
    const photos = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src.replace(/name=\w+/, 'name=large'));
    const video = article.querySelector('video');
    const card = article.querySelector('[data-testid="card.wrapper"] img');
    const social = article.querySelector('[data-testid="socialContext"]');
    const count = (...ids) => {
      for (const id of ids) {
        const n = article.querySelector(`[data-testid="${id}"]`);
        if (n) return n.textContent.trim();
      }
      return '';
    };
    const media = photos.length ? photos.slice(0, 4) : video && video.poster ? [video.poster] : card ? [card.src] : [];
    if (!text && !media.length) return null;
    return {
      key: stamp ? stamp.href : name + text.slice(0, 80),
      name, handle, text, media,
      isVideo: !photos.length && !!(video && video.poster),
      link: stamp ? stamp.href : '',
      bookmarked: !!article.querySelector('[data-testid="removeBookmark"]'),
      date: time ? new Date(time.dateTime).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '',
      social: social ? textOf(social).trim() : '',
      replies: count('reply'), reposts: count('retweet', 'unretweet'), likes: count('like', 'unlike'),
    };
  }

  // Everything measured from the feed column, shared by the page, the fans and the turn.
  function measure(col, top) {
    const r = col.getBoundingClientRect();
    const W = r.width, H = innerHeight - top - BAR;
    const P = Math.max(W, H) * 1.5;
    const margin = FAN_LAYERS * FAN_DX + 9;
    const PW = W - 2 * margin;
    const B = clamp(PW * 0.1, 18, 46);
    const PH = H - 2 * (8 + FAN_LAYERS * FAN_DY + (H / 2) * (B / P));
    // Height of the paper above the table: it rises out of the spine, then falls to the outer edge.
    const rise = (s) => B * (1 - Math.exp(-s / (PW * 0.11))) * (1 - 0.62 * Math.pow(s / PW, 2.4));
    const slope = (s) => Math.atan(rise(Math.max(0.5, s) + 0.5) - rise(Math.max(0.5, s) - 0.5));
    const fit = (step) => Math.round(PW / step);
    return { left: r.left, top, W, H, P, PW, PH, margin, spineX: margin, slope, leafStep: PW / fit(LEAF_STEP), restStep: PW / fit(REST_STEP), scale: clamp(Math.min(PW / 560, PH / 740), 0.62, 1.5) };
  }

  // Walks along the sheet from the spine, so the paper keeps its length as it bends.
  function restChain(g) {
    const n = Math.round(g.PW / g.restStep), points = [];
    let x = 0, z = 0;
    for (let i = 0; i <= n; i++) {
      const s = i * g.restStep, a0 = g.slope(s), a1 = g.slope(s + g.restStep);
      points.push({ s, x, z, a0, a1 });
      const mid = (a0 + a1) / 2;
      x += Math.cos(mid) * g.restStep;
      z += Math.sin(mid) * g.restStep;
    }
    return points;
  }

  // Darkness of the paper: light comes from the upper left, and the spine falls into shadow.
  function shadeAt(a, facing, s, g) {
    const sign = facing ? 1 : -1;
    const light = Math.max(0, sign * Math.sin(a) * 0.28 + sign * Math.cos(a) * 0.96);
    const gutter = 0.3 * Math.exp(-s / (g.PW * 0.035)) + 0.1 * Math.exp(-s / (g.PW * 0.14));
    return clamp(0.5 * (1 - light) + gutter, 0, 0.82);
  }

  function paintShade(strip, a0, a1) {
    const value = `linear-gradient(to right, rgba(36,22,8,${a0.toFixed(3)}), rgba(36,22,8,${a1.toFixed(3)}))`;
    if (strip.paint !== value) {
      strip.paint = value;
      strip.shade.style.backgroundImage = value;
    }
  }

  function buildStrips(parent, g, step, count) {
    const strips = [];
    for (let i = 0; i < count; i++) {
      const node = el('div', 'ssx-strip');
      node.style.width = `${step + 1.2}px`; // The extra hides hairline gaps between slices.
      node.style.height = `${g.PH}px`;
      const strip = { el: node, s: i * step, face: el('div', 'ssx-face'), tint: el('div', 'ssx-tint'), shade: el('div', 'ssx-shade'), facing: null, paint: '' };
      node.append(strip.face, strip.tint, strip.shade);
      parent.appendChild(node);
      strips.push(strip);
    }
    return strips;
  }

  function fillFaces(strips, sheet) {
    for (const strip of strips) {
      const copy = sheet.cloneNode(true);
      copy.style.left = `${-strip.s}px`;
      strip.face.replaceChildren(copy);
    }
  }

  function shapeLeaf(leaf, g, p, lean) {
    const step = g.leafStep, eyeX = g.W / 2 - g.spineX;
    const angle = (s) => {
      const e = smooth(clamp(p * (1 + CURL) - CURL * (1 - s / g.PW), 0, 1));
      const rest = g.slope(s);
      return rest + (Math.PI - 2 * rest) * e;
    };
    const tilt = lean * Math.sin(Math.PI * p);
    let x = 0, z = 0, xMax = -Infinity;
    for (const strip of leaf.strips) {
      const a0 = angle(strip.s), a1 = angle(strip.s + step), a = (a0 + a1) / 2;
      const nextX = x + Math.cos(a) * step, nextZ = z + Math.sin(a) * step;
      const facing = -Math.sin(a) * (eyeX - (x + nextX) / 2) + Math.cos(a) * (g.P - (z + nextZ) / 2) > 0;
      // The slant is applied in the book's own plane, pinned at the spine, so neighbouring slices stay joined.
      strip.el.style.transform = `translate3d(0, ${-g.PH / 2}px, 0) skewX(${-tilt * (x / g.PW)}rad) translate3d(${x}px, 0, ${z}px) rotateY(${-a}rad)`;
      if (facing !== strip.facing) {
        strip.facing = facing;
        strip.tint.style.opacity = facing ? 0 : 0.84; // The back of the sheet: the post shows through, mirrored and faint.
      }
      paintShade(strip, shadeAt(a0, facing, strip.s, g), shadeAt(a1, facing, strip.s + step, g));
      xMax = Math.max(xMax, x, nextX);
      x = nextX; z = nextZ;
    }
    return xMax;
  }

  // The shadow the moving sheet throws on the page beneath it.
  function castShadow(side, xMax, p) {
    const lift = Math.sin(Math.PI * p);
    const full = 0.3 * Math.min(1, lift * 2.2), fall = 18 + 70 * lift;
    const on = (x) => (x <= xMax ? full : full * Math.exp(-(x - xMax) / fall));
    side.strips.forEach((strip, i) => {
      paintShade(strip, clamp(side.base[i][0] + on(side.chain[i].x), 0, 0.85), clamp(side.base[i][1] + on(side.chain[i + 1].x), 0, 0.85));
    });
  }

  function buildSide(frame, g) {
    const chain = restChain(g);
    const strips = buildStrips(frame, g, g.restStep, chain.length - 1);
    const base = strips.map((strip, i) => {
      const p = chain[i], a = (p.a0 + p.a1) / 2;
      strip.el.style.transform = `translate3d(${p.x}px, ${-g.PH / 2}px, ${p.z}px) rotateY(${-a}rad)`;
      return [shadeAt(p.a0, true, p.s, g), shadeAt(p.a1, true, p.s + g.restStep, g)];
    });
    strips.forEach((strip, i) => paintShade(strip, base[i][0], base[i][1]));
    return { chain, strips, base, shown: undefined };
  }

  const SVG = 'http://www.w3.org/2000/svg';

  // A stack of page edges fanning out in a curve, drawn with the same camera as the page.
  function drawFan(group, g, chain, dir, layers) {
    const project = (x, y, z) => {
      const f = g.P / (g.P - z);
      return `${(g.W / 2 + (g.spineX - g.W / 2 + x) * f).toFixed(1)} ${(g.H / 2 + y * f).toFixed(1)}`;
    };
    const end = chain[chain.length - 1];
    const outline = (j) => {
      const reach = j * FAN_DX;
      const y = (s) => g.PH / 2 + j * FAN_DY * (0.3 + 0.7 * (s / g.PW));
      const along = (p) => dir * (Math.abs(p.x) + reach * 0.42 * Math.pow(p.s / g.PW, 2));
      const top = chain.map((p) => project(along(p), -y(p.s), p.z - j * FAN_DZ));
      const bottom = chain.map((p) => project(along(p), y(p.s), p.z - j * FAN_DZ)).reverse();
      const fore = [];
      for (let v = -0.9; v <= 0.91; v += 0.1) {
        fore.push(project(dir * (Math.abs(end.x) + reach * (0.42 + 0.58 * (1 - v * v))), v * y(g.PW), end.z - j * FAN_DZ));
      }
      return `M${top.join('L')}L${fore.join('L')}L${bottom.join('L')}Z`;
    };
    const paths = [];
    const cover = document.createElementNS(SVG, 'path');
    cover.setAttribute('d', outline(FAN_LAYERS + 1));
    cover.setAttribute('class', 'ssx-cover');
    paths.push(cover);
    for (let j = layers; j >= 1; j--) {
      const sheet = document.createElementNS(SVG, 'path');
      sheet.setAttribute('d', outline(j));
      sheet.setAttribute('class', j % 2 ? 'ssx-edge' : 'ssx-edge ssx-edge-alt');
      paths.push(sheet);
    }
    group.replaceChildren(...paths);
  }

  // A short burst of filtered noise that sounds like paper.
  let audio;
  function rustle(seconds = 0.28, from = 2600, to = 900, level = 0.16) {
    if (!navigator.userActivation || !navigator.userActivation.hasBeenActive) return; // Browsers block sound until a click.
    audio = audio || new AudioContext();
    audio.resume();
    const size = Math.floor(audio.sampleRate * seconds);
    const buffer = audio.createBuffer(1, size, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 1.6);
    const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass'; filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(from, audio.currentTime);
    filter.frequency.exponentialRampToValueAtTime(to, audio.currentTime + seconds);
    gain.gain.value = level;
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start();
  }

  function fitWords(flow, words, plates) {
    const steps = plates ? [1, 0.88, 0.76, 0.66, 0.56] : [1.2, 1, 0.88, 0.76, 0.66, 0.56, 0.48];
    const base = parseFloat(words.style.fontSize);
    if (plates) plates.style.flex = '0 0 0';
    const room = flow.clientHeight * (plates ? 0.6 : 1);
    for (const step of steps) {
      words.style.fontSize = `${base * step}px`;
      if (flow.scrollHeight <= flow.clientHeight && flow.lastElementChild.getBoundingClientRect().bottom - flow.getBoundingClientRect().top <= room) break;
    }
    if (plates) plates.style.flex = '';
  }

  globalThis.ScrollStyles.modes['page-roll'] = (ctx) => {
    let root = null, g = null, world = null, measureBox = null;
    let leaf = null, under = null, fans = null, emptyLeft = null;
    let closeBtn = null, link = null, reopen = null, muteBtn = null, markBtn = null, ribbon = null, toastBox = null, toastTimer = 0;
    let acting = false, muted = new Set();
    let open = false, dismissed = false, autoOpen = false, savedY = 0, path = location.pathname, top = 0;
    let posts = [], seen = new Set(), page = 0; // Page 0 is the title page; page n shows post n.
    let sheets = new Map();
    let session = null, queued = 0, drag = null, touch = null, resizeTimer = 0;

    const postAt = (index) => (index >= 1 ? posts[index - 1] : undefined);

    function writeBody(sheet, post, index) {
      const flow = el('div', 'ssx-flow');
      if (post.social) flow.appendChild(el('div', 'ssx-running', post.social));
      flow.appendChild(el('div', 'ssx-name', post.name));
      flow.appendChild(el('div', 'ssx-meta', [post.handle, post.date].filter(Boolean).join('  ·  ')));
      flow.appendChild(el('div', 'ssx-orn', '❦'));

      let words = null;
      if (post.text) {
        words = el('div', 'ssx-words', post.text);
        words.style.fontSize = `${20 * g.scale}px`;
        if (post.text.length > 120 && /^[A-Za-z]/.test(post.text)) words.classList.add('ssx-dropcap');
        if (post.text.length > 100) words.classList.add('ssx-justify');
        words.lang = 'en';
        flow.appendChild(words);
      }
      let plates = null;
      if (post.media.length) {
        plates = el('div', `ssx-plates ssx-plates-${post.media.length}`);
        post.media.forEach((src) => {
          const img = el('img');
          img.src = src;
          img.decoding = 'sync';
          plates.appendChild(img);
        });
        if (post.isVideo) plates.appendChild(el('div', 'ssx-play', 'Video'));
        flow.appendChild(plates);
      }
      const tally = [[post.replies, 'replies'], [post.reposts, 'reposts'], [post.likes, 'likes']].filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join('   ·   ');
      flow.appendChild(el('div', 'ssx-tally', tally));
      sheet.appendChild(flow);
      sheet.appendChild(el('div', 'ssx-folio', String(index)));

      measureBox.replaceChildren(sheet);
      if (words) fitWords(flow, words, plates);
      measureBox.replaceChildren();

      // Ink from the other side of the leaf, showing faintly through the paper.
      const through = flow.cloneNode(true);
      through.classList.add('ssx-bleed');
      through.querySelectorAll('.ssx-plates').forEach((n) => n.remove());
      sheet.prepend(through);
    }

    function sheetFor(index) {
      const post = postAt(index);
      const key = index === 0 ? 'title' : post ? index : 'blank';
      if (sheets.has(key)) return sheets.get(key);
      const sheet = el('div', 'ssx-sheet');
      sheet.style.width = `${g.PW}px`;
      sheet.style.height = `${g.PH}px`;
      sheet.style.fontSize = `${16 * g.scale}px`;
      if (index === 0) {
        sheet.classList.add('ssx-title');
        sheet.append(el('div', 'ssx-title-rule'), el('div', 'ssx-title-name', 'The Feed'), el('div', 'ssx-title-sub', 'Posts, bound by hand'), el('div', 'ssx-title-rule'));
      } else if (post) {
        writeBody(sheet, post, index);
      }
      sheets.set(key, sheet);
      return sheet;
    }

    function showUnder(index) {
      const key = postAt(index) || index === 0 ? index : 'blank';
      if (under.shown === key) return;
      under.shown = key;
      fillFaces(under.strips, sheetFor(index));
    }

    function redrawFans() {
      drawFan(fans.right, g, under.chain, 1, FAN_LAYERS);
      drawFan(fans.left, g, emptyLeft, -1, clamp(FAN_MIN_LEFT + page, FAN_MIN_LEFT, FAN_LAYERS));
    }

    function refreshLink() {
      const post = postAt(page), ready = !!post && !session && !acting;
      link.style.display = ready && post.link ? '' : 'none';
      if (post) link.href = post.link;
      muteBtn.style.display = markBtn.style.display = ready ? '' : 'none';
      markBtn.textContent = post && post.bookmarked ? 'Bookmarked' : 'Bookmark';
      ribbon.style.display = ready && post.bookmarked ? '' : 'none';
    }

    function toast(message) {
      if (!toastBox) return;
      toastBox.textContent = message;
      toastBox.style.display = '';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastBox.style.display = 'none'; }, 2600);
    }

    async function waitFor(find, ms) {
      const end = performance.now() + ms;
      for (;;) {
        const found = find();
        if (found || performance.now() > end) return found;
        await new Promise((done) => setTimeout(done, 50));
      }
    }

    function findArticle(post) {
      const col = document.querySelector(COLUMN);
      if (!col || !post.link) return null;
      return [...col.querySelectorAll('article')].find((a) => {
        const stamp = a.querySelector('time');
        return stamp && stamp.closest('a') && stamp.closest('a').href === post.link;
      }) || null;
    }

    // Runs an action on X's real post. X drops posts far from view, so the hidden feed goes back to it first.
    async function onRealPost(post, action) {
      if (acting || session || !post) return false;
      acting = true;
      refreshLink();
      const feedY = scrollY;
      document.documentElement.setAttribute('data-ssx-acting', '');
      try {
        if (!findArticle(post) && post.y !== undefined) scrollTo({ top: post.y - 200, behavior: 'instant' });
        const article = await waitFor(() => findArticle(post), 1500);
        return article ? await action(article) : false;
      } catch (e) {
        return false;
      } finally {
        scrollTo({ top: feedY, behavior: 'instant' });
        document.documentElement.removeAttribute('data-ssx-acting');
        acting = false;
        if (root) refreshLink();
      }
    }

    async function toggleBookmark() {
      const post = postAt(page);
      const want = post && !post.bookmarked;
      const ok = await onRealPost(post, async (article) => {
        const button = article.querySelector(`[data-testid="${want ? 'bookmark' : 'removeBookmark'}"]`);
        if (!button) return false;
        button.click();
        return !!(await waitFor(() => (findArticle(post) || article).querySelector(`[data-testid="${want ? 'removeBookmark' : 'bookmark'}"]`), 1500));
      });
      if (!ok) { toast("Couldn't reach X's bookmark button"); return; }
      post.bookmarked = want;
      refreshLink();
      toast(want ? 'Bookmarked on X' : 'Bookmark removed on X');
    }

    function closeXMenu() {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    async function muteAuthor() {
      const post = postAt(page);
      const ok = await onRealPost(post, async (article) => {
        const caret = article.querySelector('[data-testid="caret"]');
        if (!caret) return false;
        caret.click();
        const item = await waitFor(() => document.querySelector('[role="menu"] [data-testid="mute"]') || [...document.querySelectorAll('[role="menuitem"]')].find((m) => /\bmute\b/i.test(m.textContent)), 1500);
        if (!item) { closeXMenu(); return false; }
        item.click();
        return true;
      });
      if (!ok) { toast("Couldn't reach X's mute option. Page kept."); return; }
      await tearPage(post);
      toast(`Muted ${post.handle} on X`);
    }

    // Rips the page out along a ragged line; the two pieces fall away and the next post is underneath.
    async function tearPage(post) {
      acting = true;
      refreshLink();
      if (ctx.sound()) rustle(0.5, 4200, 1400, 0.24);
      const sheet = sheetFor(page);
      const ragged = [];
      let x = 46;
      for (let i = 0; i <= 26; i++) {
        x = clamp(x + (Math.random() - 0.5) * 9, 34, 66);
        ragged.push(`${x.toFixed(1)}% ${((i / 26) * 100).toFixed(1)}%`);
      }
      const layer = el('div', 'ssx-tear');
      layer.style.cssText = `left:${g.spineX}px;top:${(g.H - g.PH) / 2}px;width:${g.PW}px;height:${g.PH}px;`;
      const piece = (shape) => {
        const outer = el('div', 'ssx-tear-piece'), inner = el('div', 'ssx-tear-clip');
        inner.style.clipPath = `polygon(${shape.join(',')})`;
        const copy = sheet.cloneNode(true);
        copy.style.left = '0';
        inner.appendChild(copy);
        outer.appendChild(inner);
        layer.appendChild(outer);
        return outer;
      };
      const leftPiece = piece(['0 0', ...ragged, '0 100%']);
      const rightPiece = piece(['100% 0', ...ragged, '100% 100%']);
      root.appendChild(layer);

      muted.add(post.handle);
      posts = [...posts.slice(0, page - 1), ...posts.slice(page - 1).filter((p) => p.handle !== post.handle)];
      sheets = new Map();
      under.shown = undefined;
      showUnder(page);

      const fall = `${g.H + 240}px`;
      const options = { duration: 900, easing: 'cubic-bezier(.45,.05,.8,.5)', fill: 'forwards' };
      const motions = [
        leftPiece.animate([{ transform: 'none' }, { transform: 'translate(-16px, 4px) rotate(-3deg)', offset: 0.18 }, { transform: `translate(-90px, ${fall}) rotate(-26deg)` }], options).finished,
        rightPiece.animate([{ transform: 'none' }, { transform: 'translate(18px, -5px) rotate(4deg)', offset: 0.18 }, { transform: `translate(110px, ${fall}) rotate(31deg)` }], options).finished,
      ];
      await Promise.all(motions).catch(() => {});
      layer.remove();
      acting = false;
      if (root) refreshLink();
    }

    function placeRoot() {
      root.style.left = `${g.left}px`;
      root.style.top = `${g.top}px`;
      root.style.width = `${g.W}px`;
      root.style.height = `${g.H + BAR}px`;
      ribbon.style.left = `${g.spineX + g.PW - 64}px`;
      ribbon.style.top = `${(g.H - g.PH) / 2 - 6}px`;
    }

    function buildWorld(col) {
      if (world) world.remove();
      g = measure(col, top);
      placeRoot();
      sheets = new Map();
      world = el('div', 'ssx-world');
      world.style.perspective = `${g.P}px`;

      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ssx-fans');
      svg.setAttribute('width', g.W);
      svg.setAttribute('height', g.H);
      fans = { left: document.createElementNS(SVG, 'g'), right: document.createElementNS(SVG, 'g') };
      fans.left.setAttribute('class', 'ssx-fan-left');
      fans.right.setAttribute('class', 'ssx-fan-right');
      svg.append(fans.left, fans.right);

      const restFrame = el('div', 'ssx-frame ssx-rest');
      const leafFrame = el('div', 'ssx-frame ssx-leaf');
      restFrame.style.left = leafFrame.style.left = `${g.spineX}px`;
      leafFrame.style.visibility = 'hidden';
      under = buildSide(restFrame, g);
      emptyLeft = Array.from({ length: 9 }, (_, i) => ({ s: (g.PW * i) / 8, x: 0, z: 0 }));
      leaf = { frame: leafFrame, strips: buildStrips(leafFrame, g, g.leafStep, Math.round(g.PW / g.leafStep)) };
      world.append(svg, restFrame, leafFrame);
      root.prepend(world);
      showUnder(page);
      redrawFans();
    }

    function harvest() {
      const col = document.querySelector(COLUMN);
      if (!col) return;
      col.querySelectorAll('article').forEach((article) => {
        const post = readPost(article);
        if (post && !seen.has(post.key) && !muted.has(post.handle)) {
          post.y = article.getBoundingClientRect().top + scrollY;
          seen.add(post.key);
          posts.push(post);
          post.media.forEach((src) => { new Image().src = src; }); // Ready before its page opens.
        }
      });
    }

    function eligible() {
      if (NOT_A_FEED.test(location.pathname)) return false;
      const col = document.querySelector(COLUMN);
      return !!col && !!col.querySelector('article');
    }

    function openBook() {
      if (open) return;
      const col = document.querySelector(COLUMN);
      if (!col) return;
      open = true;
      dismissed = false;
      autoOpen = true;
      savedY = scrollY;
      if (reopen) reopen.style.display = 'none';
      posts = []; seen = new Set(); page = 0; queued = 0; muted = new Set();
      top = headerBottom(col); // Measured before the book covers the column.
      markNotes(col);
      scrollTo({ top: 0, behavior: 'instant' });
      root = el('div', 'ssx-book');
      root.id = 'ssx-book';
      root.style.background = getComputedStyle(document.body).backgroundColor;
      measureBox = el('div', 'ssx-measure');
      closeBtn = el('button', 'ssx-pill ssx-close', 'Close book');
      closeBtn.addEventListener('click', () => { dismissed = true; closeBook(true); });
      muteBtn = el('button', 'ssx-pill ssx-mute', 'Mute');
      muteBtn.addEventListener('click', muteAuthor);
      markBtn = el('button', 'ssx-pill ssx-mark', 'Bookmark');
      markBtn.addEventListener('click', toggleBookmark);
      ribbon = el('div', 'ssx-ribbon');
      toastBox = el('div', 'ssx-toast');
      toastBox.style.display = 'none';
      link = el('a', 'ssx-pill ssx-open', 'Open on X');
      link.target = '_blank';
      link.rel = 'noopener';
      const bar = el('div', 'ssx-bar');
      bar.append(muteBtn, markBtn, link, closeBtn);
      root.append(measureBox, ribbon, toastBox, bar);
      col.appendChild(root); // Inside the column, so X's own pop-ups and dialogs still sit on top.
      buildWorld(col);
      harvest();
      refreshLink();
    }

    function closeBook(restore) {
      if (!open) return;
      if (session) endSession(session);
      open = false;
      root.remove();
      root = world = null;
      clearNotes();
      if (restore) scrollTo({ top: savedY, behavior: 'instant' });
      syncReopen();
    }

    function syncReopen() {
      const col = document.querySelector(COLUMN);
      if (!reopen) {
        reopen = el('button', 'ssx-pill ssx-reopen', 'Open book');
        reopen.addEventListener('click', openBook);
        document.body.appendChild(reopen);
      }
      const show = dismissed && eligible() && !dialogOpen();
      reopen.style.display = show ? '' : 'none';
      if (show) reopen.style.left = `${col.getBoundingClientRect().right - 130}px`;
    }

    function tick() {
      if (location.pathname !== path) {
        path = location.pathname;
        if (open) closeBook(false);
        dismissed = false;
      }
      if (open && !root.isConnected) { // X rebuilt the column.
        open = false;
        session = null;
        root = world = null;
        clearNotes();
      }
      if (!open) {
        if (!dismissed && eligible()) openBook();
        else syncReopen();
        return;
      }
      harvest();
      markNotes(document.querySelector(COLUMN)); // X re-renders these as you use it.
      // X only loads more posts as it scrolls; this moves the feed hidden behind the book.
      if (!acting && posts.length < page + READ_AHEAD) scrollBy({ top: innerHeight * 0.9, behavior: 'instant' });
      if (session || acting) return;
      showUnder(page);
      refreshLink();
      if (autoOpen && posts.length >= 1) {
        autoOpen = false;
        const s = begin(1);
        if (s) autoTurn(s);
      }
    }

    function show(s) {
      const p = s.dir > 0 ? s.q : 1 - s.q;
      const xMax = shapeLeaf(leaf, g, p, s.lean);
      castShadow(under, xMax, p);
      if (!s.sounded && s.q > 0.1) {
        s.sounded = true;
        if (ctx.sound()) rustle();
      }
    }

    // Lifts a sheet with the next page already underneath. Returns the turn, or null if there is no page.
    function begin(dir, lean = 0.12) {
      if (session || !open || acting) return null;
      if (dir < 0 && page <= 0) return null;
      if (dir > 0 && !postAt(page + 1)) return null; // Still collecting posts.
      fillFaces(leaf.strips, sheetFor(dir > 0 ? page : page - 1));
      if (dir > 0) showUnder(page + 1);
      session = { dir, lean, q: 0, v: 0, at: performance.now(), raf: 0, timer: 0, settling: false, sounded: false, source: '' };
      show(session);
      leaf.frame.style.visibility = 'visible';
      root.setAttribute('data-turning', '');
      refreshLink();
      return session;
    }

    function endSession(s) {
      cancelAnimationFrame(s.raf);
      clearTimeout(s.timer);
      session = null;
      if (root) root.removeAttribute('data-turning');
    }

    function finish(s, done) {
      endSession(s);
      if (done) page += s.dir;
      showUnder(page);
      under.strips.forEach((strip, i) => paintShade(strip, under.base[i][0], under.base[i][1]));
      leaf.frame.style.visibility = 'hidden';
      redrawFans();
      refreshLink();
      if (queued) {
        const dir = Math.sign(queued);
        const next = begin(dir);
        if (next) { queued -= dir; autoTurn(next); } else queued = 0;
      }
    }

    function scrub(s, q) {
      const next = clamp(q, 0, 1), now = performance.now();
      s.v = s.v * 0.7 + ((next - s.q) / Math.max(1, now - s.at)) * 1000 * 0.3;
      s.q = next;
      s.at = now;
      show(s);
    }

    // Springs the page to rest, carrying the speed of the gesture into it.
    function settle(s, target, velocity, stiffness = 170, damping = 25) {
      s.settling = true;
      clearTimeout(s.timer);
      let x = s.q, v = velocity, last = performance.now();
      const step = (t) => {
        if (session !== s) return;
        const dt = clamp((t - last) / 1000, 0, 0.032);
        last = t;
        v += (stiffness * (target - x) - damping * v) * dt;
        x += v * dt;
        s.q = clamp(x, 0, 1);
        show(s);
        const reached = target === 1 ? x >= 1 : x <= 0;
        if (reached || (Math.abs(target - x) < 0.012 && Math.abs(v) < 0.2)) finish(s, target === 1);
        else s.raf = requestAnimationFrame(step);
      };
      s.raf = requestAnimationFrame(step);
    }

    function release(s, threshold) {
      const v = performance.now() - s.at > 90 ? 0 : s.v; // A pause before letting go cancels the flick.
      settle(s, s.q + v * 0.12 >= threshold ? 1 : 0, v);
    }

    function autoTurn(s) {
      s.source = s.source || 'auto';
      if (queued) settle(s, 1, 0, 130, 23);
      else settle(s, 1, 0, 70, 17);
    }

    function queueTurn(dir) {
      if (session.dir !== dir) queued = 0;
      else queued = clamp(queued + dir, -MAX_QUEUE, MAX_QUEUE);
    }

    function turnOrQueue(dir) {
      if (session) { queueTurn(dir); return; }
      const s = begin(dir);
      if (s) autoTurn(s);
    }

    function onWheel(e) {
      if (!open || dialogOpen() || e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (hasInnerScroller(e.target)) return; // Panels with their own scrolling keep it.
      e.preventDefault(); // The window itself never scrolls while the book is open.
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
      const notch = Math.abs(px) >= WHEEL_NOTCH;
      if (session && session.source !== 'wheel') {
        if (notch && session.settling) queueTurn(Math.sign(px));
        return;
      }
      if (session && session.settling) return;
      if (!session) {
        if (notch) { turnOrQueue(Math.sign(px)); return; }
        if (Math.abs(px) < 3) return;
        const s = begin(Math.sign(px));
        if (!s) return;
        s.source = 'wheel';
      }
      const s = session;
      const q = s.q + (px * s.dir) / WHEEL_TRAVEL;
      if (q <= 0) { finish(s, false); return; }
      if (q >= 1) { scrub(s, 1); finish(s, true); return; }
      scrub(s, q);
      clearTimeout(s.timer);
      s.timer = setTimeout(() => release(s, WHEEL_COMMIT), WHEEL_HOLD);
    }

    function onKey(e) {
      if (!open || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      let dir = 0;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') dir = 1;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') dir = -1;
      if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, a, [role="button"], video'))) dir = e.shiftKey ? -1 : 1;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) turnOrQueue(dir);
    }

    const leanAt = (y) => clamp((y - g.top - g.H / 2) / (g.PH / 2), -1, 1) * LEAN;
    const onBook = (t) => !!root && t instanceof Element && root.contains(t) && !t.closest('.ssx-pill');

    function onPointerDown(e) {
      if (!open || e.button !== 0 || e.pointerType === 'touch' || session || !onBook(e.target)) return;
      drag = { zone: e.clientX >= g.left + g.W / 2 ? 1 : -1, x: e.clientX, started: false };
    }

    function onPointerMove(e) {
      if (!open || !drag) return;
      const pulled = (e.clientX - drag.x) * -drag.zone;
      if (!drag.started) {
        if (pulled < DRAG_START) return;
        const s = begin(drag.zone);
        if (!s) { drag = null; return; }
        s.source = 'drag';
        drag.started = true;
        root.setAttribute('data-dragging', '');
      }
      const s = session;
      if (!s) { drag = null; return; }
      s.lean = leanAt(e.clientY);
      scrub(s, (pulled - DRAG_START) / (g.PW * 1.2));
    }

    function onPointerUp() {
      if (!open || !drag) return;
      const { started, zone } = drag;
      drag = null;
      root.removeAttribute('data-dragging');
      if (started && session) release(session, DRAG_COMMIT);
      else if (!started) turnOrQueue(zone); // A plain click turns the page: right half forward, left half back.
    }

    function onTouchStart(e) {
      touch = open && onBook(e.target) && e.touches.length === 1 && !session ? { x: e.touches[0].clientX, started: false } : null;
    }

    function onTouchMove(e) {
      if (!open || !touch) return;
      if (e.cancelable) e.preventDefault();
      const dx = touch.x - e.touches[0].clientX;
      if (!touch.started) {
        if (Math.abs(dx) < DRAG_START) return;
        const s = begin(Math.sign(dx));
        if (!s) { touch = null; return; }
        s.source = 'touch';
        touch.started = true;
      }
      const s = session;
      s.lean = leanAt(e.touches[0].clientY);
      scrub(s, (dx * s.dir) / (g.PW * 1.2));
    }

    function onTouchEnd() {
      const started = touch && touch.started;
      touch = null;
      if (open && started && session) release(session, DRAG_COMMIT);
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const col = document.querySelector(COLUMN);
        if (open && !session && col) buildWorld(col);
      }, 150);
    }

    const ticker = setInterval(tick, 300);
    tick();

    const listen = { capture: true, passive: false };
    const handlers = { wheel: onWheel, keydown: onKey, pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: onPointerUp, pointercancel: onPointerUp, touchstart: onTouchStart, touchmove: onTouchMove, touchend: onTouchEnd, resize: onResize };
    for (const type in handlers) addEventListener(type, handlers[type], listen);

    return () => {
      clearInterval(ticker);
      clearTimeout(resizeTimer);
      for (const type in handlers) removeEventListener(type, handlers[type], listen);
      closeBook(true);
      if (reopen) reopen.remove();
    };
  };
})();
