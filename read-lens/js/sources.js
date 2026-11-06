// Stand-in "cameras" that feed the same pipeline as the real camera: a sample book page that drifts
// gently like a hand-held phone (public-domain text: Pride and Prejudice, ch. 1), and a still photo.

const SAMPLE = `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.
"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?" Mr. Bennet replied that he had not. "But it is," returned she; "for Mrs. Long has just been here, and she told me all about it." Mr. Bennet made no answer.
"Do not you want to know who has taken it?" cried his wife impatiently. "You want to tell me, and I have no objection to hearing it." This was invitation enough.
"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."`;

const SAMPLE2 = `"What is his name?" "Bingley." "Is he married or single?" "Oh! single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"
"How so? how can it affect them?" "My dear Mr. Bennet," replied his wife, "how can you be so tiresome! You must know that I am thinking of his marrying one of them."
"Is that his design in settling here?" "Design! nonsense, how can you talk so! But it is very likely that he may fall in love with one of them, and therefore you must visit him as soon as he comes."
"I see no occasion for that. You and the girls may go, or you may send them by themselves, which perhaps will be still better, for as you are as handsome as any of them, Mr. Bingley might like you the best of the party."`;

function wrap(ctx, text, maxW) {
  const out = [];
  text.split('\n').forEach((para, pi) => {
    let line = pi ? '    ' : '';
    para.split(' ').forEach((w) => {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line.trim()) { out.push(line); line = w; } else line = t;
    });
    out.push(line);
  });
  return out;
}

function renderPage(W, H, text, num) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f5efe1'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1d1a16';
  x.font = '600 30px Georgia, "Times New Roman", serif';
  x.textAlign = 'center';
  if (num === 1) x.fillText('Chapter 1', W / 2, 110);
  x.textAlign = 'left';
  x.font = '27px Georgia, "Times New Roman", serif';
  const lines = wrap(x, text, W - 150);
  lines.forEach((l, i) => x.fillText(l, 75, 180 + i * 44));
  x.font = '22px Georgia, serif'; x.textAlign = 'center'; x.fillStyle = '#6b6357';
  x.fillText(String(num), W / 2, H - 50);
  return c;
}

export function startDemo() {
  const W = 960, H = 1280;
  const pages = [renderPage(820, 1180, SAMPLE, 1), renderPage(820, 1180, SAMPLE2, 2)];
  let pageIx = 0, turnAt = -1;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  let raf = 0;
  const t0 = performance.now();
  const frame = (t) => {
    const s = (t - t0) / 1000;
    x.fillStyle = '#3b2a1e'; x.fillRect(0, 0, W, H);
    const dx = Math.sin(s * 0.7) * 9 + Math.sin(s * 1.9) * 3;
    const dy = Math.cos(s * 0.5) * 7 + Math.sin(s * 2.3) * 2;
    x.save();
    x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 30;
    // Page turn: the old page slides away, the next one slides in.
    let slide = 0;
    if (turnAt >= 0) {
      const p = Math.min(1, (t - turnAt) / 900);
      slide = p < 0.5 ? -p * 2 : (1 - p) * 2;
      if (p >= 0.5 && pageIx === 0) pageIx = 1;
      if (p >= 1) turnAt = -1;
    }
    x.drawImage(pages[pageIx], 70 + dx + slide * W, 50 + dy);
    x.restore();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const stream = c.captureStream(30);
  return {
    stream,
    stop: () => { cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); },
    turn: () => { if (pageIx === 0 && turnAt < 0) turnAt = performance.now(); },
  };
}

export function startPhoto(img) {
  const k = Math.min(1, 1800 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round((img.naturalWidth || 2) * k));
  c.height = Math.max(2, Math.round((img.naturalHeight || 2) * k));
  const x = c.getContext('2d');
  let raf = 0;
  // Keep repainting so captureStream keeps producing frames.
  const frame = () => { x.drawImage(img, 0, 0, c.width, c.height); raf = requestAnimationFrame(frame); };
  frame();
  const stream = c.captureStream(15);
  return { stream, stop: () => { cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); } };
}
