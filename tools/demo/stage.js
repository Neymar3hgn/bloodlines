/**
 * Everything that happens inside the browser while the demo is filmed: a camera over the
 * real site, the captions, and the few drawn scenes that explain an idea the site can't.
 * Every moment is a function of the film's clock, so a frame comes out the same however
 * busy the machine is. film.mjs injects this and calls F.setup and F.frame.
 */
(() => {
  const W = 1920;
  const H = 1080;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (x) => ((x = clamp(x)), x * x * (3 - 2 * x));
  const out = (x) => 1 - (1 - clamp(x)) ** 3;
  const span = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));
  const mix = (a, b, p) => a + (b - a) * p;
  const plain = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  const style = el("style");
  style.textContent = `
    html, body { overflow: hidden !important; height: 100vh; background: #09080b; }
    #root { transform-origin: 0 0; will-change: auto; }
    #film { position: fixed; inset: 0; z-index: 99990; pointer-events: none; color: var(--ink); font-family: var(--font-text); }
    .f-slide { position: absolute; inset: 0; opacity: 0; background: radial-gradient(1200px 760px at 50% 40%, #1d0b13 0%, #0c090e 58%, #070609 100%); }
    .f-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; }
    .f-big { font-family: var(--font-display); font-weight: 500; line-height: 1.14; max-width: 1560px; letter-spacing: -0.012em; }
    .f-word { display: inline-block; opacity: 0; }
    .f-word.accent { color: var(--gold); font-style: italic; }
    .f-word.blood { color: var(--blood-bright); font-style: italic; }
    .f-title { position: absolute; left: 0; right: 0; top: 130px; text-align: center; font-family: var(--font-display); font-size: 88px; font-weight: 500; letter-spacing: -0.01em; opacity: 0; }
    .f-title em { color: var(--gold); }
    .f-cap { position: absolute; left: 50%; bottom: 58px; transform: translateX(-50%); max-width: 1640px; width: max-content; padding: 18px 38px 20px; border-radius: 16px; background: rgba(9, 8, 11, 0.9); border: 1px solid rgba(245, 238, 228, 0.14); font: 600 50px/1.2 var(--font-text); text-align: center; opacity: 0; box-shadow: 0 12px 44px rgba(0, 0, 0, 0.55); }
    .f-cap b { color: var(--gold); font-weight: 600; }
    .f-spot { position: absolute; border: 3px solid var(--gold); border-radius: 18px; box-shadow: 0 0 0 4000px rgba(6, 5, 8, 0.66), 0 0 46px rgba(236, 198, 128, 0.35); opacity: 0; }
    .f-ring { position: absolute; border: 3px solid var(--gold); border-radius: 50%; box-shadow: 0 0 34px rgba(236, 198, 128, 0.55); opacity: 0; }
    .f-note { position: absolute; padding: 16px 24px; border-radius: 14px; background: rgba(9, 8, 11, 0.94); border: 1px solid rgba(236, 198, 128, 0.5); display: flex; flex-direction: column; gap: 4px; opacity: 0; }
    .f-note strong { font: 500 34px var(--font-mono); color: var(--gold); }
    .f-note span { font: 500 28px var(--font-text); color: var(--ink-2); }
    .f-tag { position: absolute; right: 44px; top: 34px; padding: 10px 20px; border-radius: 999px; background: rgba(9, 8, 11, 0.86); border: 1px solid rgba(245, 238, 228, 0.2); font: 500 26px var(--font-text); color: var(--ink-2); opacity: 0; }
    .f-tag i { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--blood-bright); margin-right: 12px; vertical-align: 1px; }
    .f-dip { position: absolute; inset: 0; background: #070609; opacity: 0; }
    .f-cursor { position: absolute; width: 46px; height: 46px; opacity: 0; filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.7)); }
    .f-chip { position: absolute; width: 132px; padding: 16px 0; border-radius: 14px; background: #1c181f; border: 1px solid rgba(236, 198, 128, 0.42); font: 500 36px var(--font-mono); text-align: center; opacity: 0; }
    .f-coin { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffe7b0, #d7a447 62%, #8f6420); opacity: 0; }
    .f-pot { position: absolute; left: 960px; top: 690px; transform: translate(-50%, -50%); padding: 34px 64px; border-radius: 22px; background: #1c181f; border: 2px solid var(--gold); text-align: center; opacity: 0; box-shadow: 0 0 80px rgba(236, 198, 128, 0.2); }
    .f-pot span { display: block; font: 500 64px var(--font-display); }
    .f-pot small { display: block; margin-top: 8px; font: 500 32px var(--font-text); color: var(--ink-2); }
    .f-row { position: absolute; left: 0; right: 0; top: 400px; display: flex; justify-content: center; gap: 50px; }
    .f-env { position: relative; width: 290px; height: 196px; opacity: 0; perspective: 900px; }
    .f-env-body { position: absolute; inset: 0; border-radius: 10px; background: linear-gradient(160deg, #2a232d, #1b171f); border: 1px solid rgba(245, 238, 228, 0.22); }
    .f-env-card { position: absolute; left: 22px; right: 22px; top: 18px; height: 150px; border-radius: 8px; background: #f5eee4; color: #120d10; display: flex; align-items: center; justify-content: center; font: 600 66px var(--font-mono); opacity: 0; }
    .f-env-flap { position: absolute; left: 0; right: 0; top: 0; height: 128px; transform-origin: 50% 0; background: linear-gradient(180deg, #3a3140, #2a232d); clip-path: polygon(0 0, 100% 0, 50% 100%); }
    .f-env-seal { position: absolute; left: 50%; top: 88px; width: 84px; height: 84px; margin-left: -42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 36% 30%, #ff5a72, #c8152f 60%, #7c1024); font: 700 46px var(--font-display); color: #ffe9df; opacity: 0; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); }
    .f-env-name { position: absolute; left: 0; right: 0; top: 214px; text-align: center; font: 500 42px var(--font-mono); color: var(--ink); }
    .f-env.won .f-env-body { border-color: var(--gold); box-shadow: 0 0 70px rgba(236, 198, 128, 0.55); }
    .f-env.won .f-env-name { color: var(--gold); }
    .f-env-win { position: absolute; left: 0; right: 0; top: 276px; text-align: center; font: italic 500 58px var(--font-display); color: var(--gold); opacity: 0; }
    .f-spark { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #ffdf9e; opacity: 0; }
    .f-small { position: absolute; right: 54px; top: 40px; font: 500 28px var(--font-text); color: var(--ink-3); opacity: 0; }
    .f-vein { position: absolute; left: 959px; top: 170px; width: 3px; height: 300px; background: linear-gradient(180deg, #7c1024, #e0223d); transform-origin: 50% 100%; }
    .f-parent { position: absolute; left: 960px; top: 150px; transform: translate(-50%, -50%); width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ff7b8e, #c8152f 70%, #7c1024); }
    .f-parent-label { position: absolute; left: 1010px; top: 128px; font: 500 34px var(--font-mono); color: var(--ink-2); }
    .f-name { position: absolute; left: 0; right: 0; top: 490px; text-align: center; font: 500 76px var(--font-mono); }
    .f-strike { position: absolute; left: 50%; top: 538px; height: 7px; margin-left: -520px; width: 1040px; background: var(--blood-bright); transform-origin: 0 50%; transform: scaleX(0); }
    .f-forever { position: absolute; left: 0; right: 0; top: 640px; text-align: center; font: italic 500 128px var(--font-display); color: var(--blood-bright); opacity: 0; }
    .f-mono-note { position: absolute; left: 0; right: 0; top: 806px; text-align: center; font: 500 34px var(--font-mono); color: var(--ink-3); opacity: 0; }
    .f-stack { display: flex; flex-direction: column; gap: 22px; align-items: center; }
    .f-count { font: 500 330px/1 var(--font-display); letter-spacing: -0.03em; }
    .f-chat { position: absolute; left: 50%; top: 150px; width: 1280px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 30px; }
    .f-bubble { position: relative; max-width: 960px; padding: 28px 46px 32px; border-radius: 34px; font: 500 64px/1.2 var(--font-text); opacity: 0; }
    .f-bubble.me { align-self: flex-end; background: #2c2530; border-bottom-right-radius: 8px; }
    .f-bubble.ai { align-self: flex-start; background: #17131a; border: 2px solid rgba(236, 198, 128, 0.55); border-bottom-left-radius: 8px; }
    .f-bubble small { display: block; margin-bottom: 4px; font: 500 30px var(--font-mono); color: var(--gold); }
    .f-stamp { position: absolute; right: -36px; top: -30px; padding: 8px 26px; border-radius: 12px; background: var(--blood); color: #fff3ee; font: 700 46px var(--font-text); opacity: 0; }
    .f-lost { position: absolute; left: 0; right: 0; text-align: center; font: 500 124px/1 var(--font-display); opacity: 0; }
    .f-lost em { color: var(--blood-bright); }
    .f-top { position: absolute; left: 0; right: 0; top: 170px; margin: 0 auto; text-align: center; }
    .f-answers { position: absolute; left: 0; right: 0; top: 640px; display: flex; justify-content: center; gap: 30px; }
    .f-answer { padding: 22px 38px 28px; border-radius: 26px; background: #17131a; border: 1px solid rgba(245, 238, 228, 0.24); font: 500 52px var(--font-text); opacity: 0; }
    .f-answer small { display: block; font: 500 26px var(--font-mono); color: var(--gold); margin-bottom: 2px; }
    .f-rule { position: absolute; left: 0; right: 0; top: 380px; display: flex; justify-content: center; gap: 70px; }
    .f-rule-card { width: 640px; padding: 56px 40px 62px; border-radius: 30px; background: #17131a; text-align: center; opacity: 0; }
    .f-rule-card.good { border: 3px solid var(--gold); box-shadow: 0 0 80px rgba(236, 198, 128, 0.18); }
    .f-rule-card.bad { border: 3px solid var(--blood-bright); box-shadow: 0 0 80px rgba(224, 34, 61, 0.2); }
    .f-rule-card span { display: block; font: 500 100px/1.1 var(--font-display); }
    .f-rule-card b { display: block; margin-top: 22px; font: 600 58px var(--font-text); }
    .f-rule-card.good b { color: var(--gold); }
    .f-rule-card.bad b { color: var(--blood-bright); }
    .f-card { position: absolute; left: 50%; top: 610px; transform: translateX(-50%); padding: 30px 90px 36px; border-radius: 30px; border: 3px solid var(--gold); background: #17131a; text-align: center; opacity: 0; box-shadow: 0 0 90px rgba(236, 198, 128, 0.22); white-space: nowrap; }
    .f-card strong { display: block; font: 500 150px/1 var(--font-display); }
    .f-card span { display: block; margin-top: 10px; font: 500 40px var(--font-text); color: var(--ink-2); }
    .f-end-mark { width: 150px; height: 150px; opacity: 0; }
    .f-end-name { margin-top: 26px; font: 500 150px/1 var(--font-display); letter-spacing: 0.01em; opacity: 0; }
    .f-end-line { margin-top: 24px; font: italic 500 54px var(--font-display); color: var(--ink-2); opacity: 0; }
    .f-end-tags { margin-top: 48px; font: 500 34px var(--font-mono); color: var(--ink-2); opacity: 0; }
    .f-end-small { position: absolute; left: 0; right: 0; bottom: 46px; text-align: center; font: 500 26px var(--font-text); color: var(--ink-3); opacity: 0; }
  `;
  document.head.append(style);

  const layer = el("div");
  layer.id = "film";
  document.body.append(layer);
  const spotEl = el("div", "f-spot");
  const ringEl = el("div", "f-ring");
  const noteEl = el("div", "f-note");
  const tagEl = el("div", "f-tag");
  const capEl = el("div", "f-cap");
  const dipEl = el("div", "f-dip");
  const cursorEl = el("div", "f-cursor", `<svg viewBox="0 0 24 24" width="46" height="46"><path d="M4 2l15 11-7 1 4 8-3 1-4-8-5 5z" fill="#f5eee4" stroke="#09080b" stroke-width="1.2"/></svg>`);
  layer.append(spotEl, ringEl, noteEl, cursorEl, tagEl, capEl, dipEl);

  let lines = [];
  let facts = {};
  const byId = {};
  let current = null;

  const root = () => $("#root");
  const applyCam = (c) => (root().style.transform = `translate(${-c.x}px, ${-c.y}px) scale(${c.s})`);
  const camMix = (a, b, p) => ({ x: mix(a.x, b.x, p), y: mix(a.y, b.y, p), s: mix(a.s, b.s, p) });
  let camera = { x: 0, y: 0, s: 1 };
  const setCam = (c) => {
    camera = c;
    applyCam(c);
  };

  function pageRect(target) {
    const e = typeof target === "string" ? $(target) : target;
    if (!e) throw new Error(`nothing on the page matches ${target}`);
    const saved = root().style.transform;
    root().style.transform = "none";
    const r = e.getBoundingClientRect();
    root().style.transform = saved;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  const union = (a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  /** Where the camera sits to frame a piece of the page, keeping clear of the caption. */
  function aim(r, { fill = 0.72, max = 2.2, dy = -52, dx = 0 } = {}) {
    const s = Math.min((W * fill) / r.w, (H * fill) / r.h, max);
    return { s, x: r.x * s + (r.w * s) / 2 - W / 2 + dx, y: r.y * s + (r.h * s) / 2 - H / 2 - dy };
  }

  const toScreen = (r, c) => ({ x: r.x * c.s - c.x, y: r.y * c.s - c.y, w: r.w * c.s, h: r.h * c.s });

  /** A gentle push in on the whole page, which keeps the headline and the tree both in frame. */
  const wide = (s) => ({ s, x: (W * s - W) / 2, y: ((H * s - H) / 2) * 0.55 });

  function spot(r, c, op, pad = 16) {
    if (op <= 0 || !r) return (spotEl.style.opacity = 0);
    const b = toScreen(r, c);
    spotEl.style.cssText = `left:${b.x - pad}px;top:${b.y - pad}px;width:${b.w + 2 * pad}px;height:${b.h + 2 * pad}px;opacity:${op}`;
  }

  function callout(r, c, title, sub, op, { side = "right" } = {}) {
    if (op <= 0) {
      ringEl.style.opacity = 0;
      noteEl.style.opacity = 0;
      return;
    }
    const b = toScreen(r, c);
    const pad = 16;
    ringEl.style.cssText = `left:${b.x - pad}px;top:${b.y - pad}px;width:${b.w + 2 * pad}px;height:${b.h + 2 * pad}px;opacity:${op}`;
    noteEl.innerHTML = `<strong>${title}</strong><span>${sub}</span>`;
    const y = clamp(b.y + b.h / 2 - 56, 40, H - 300);
    noteEl.style.cssText = side === "right" ? `left:${b.x + b.w + 50}px;top:${y}px;opacity:${op}` : `right:${W - b.x + 50}px;top:${y}px;opacity:${op}`;
  }

  const tag = (html, op) => {
    if (tagEl.dataset.t !== html) {
      tagEl.innerHTML = `<i></i>${html}`;
      tagEl.dataset.t = html;
    }
    tagEl.style.opacity = op;
  };

  function at(line, word, nth = 0) {
    const hits = line.words.filter((w) => plain(w.w) === word);
    if (!hits.length || !hits[nth]) throw new Error(`"${word}" (${nth}) is not in ${line.id}`);
    return hits[nth].s;
  }

  async function go(hash, selector) {
    if (location.hash !== hash) location.hash = hash;
    for (let i = 0; i < 200 && !$(selector); i++) await sleep(50);
    if (!$(selector)) throw new Error(`${hash} never showed ${selector}`);
    await document.fonts.ready;
    await sleep(500);
    window.scrollTo(0, 0);
  }

  // The site's own animations follow the film's clock instead of the wall clock.
  const seen = new WeakMap();
  function seek(t) {
    for (const a of document.getAnimations()) {
      if (!seen.has(a)) {
        seen.set(a, t);
        a.pause();
      }
      a.currentTime = (t - seen.get(a)) * 1000;
    }
    for (const svg of $$("svg")) {
      if (svg.pauseAnimations) {
        svg.pauseAnimations();
        svg.setCurrentTime(t);
      }
    }
  }

  /** `rows` says how many words go on each line, so a sentence breaks where the voice does. */
  function wordsInto(parent, line, { gold = [], blood = [], rows = null } = {}) {
    let row = parent;
    let left = rows ? rows[0] : Infinity;
    let r = 0;
    const startRow = () => {
      row = el("div");
      parent.append(row);
    };
    if (rows) startRow();
    return line.words.map((w) => {
      if (left === 0) {
        left = rows[++r];
        startRow();
      }
      left -= 1;
      const span_ = el("span", "f-word", w.w);
      if (gold.includes(plain(w.w))) span_.classList.add("accent");
      if (blood.includes(plain(w.w))) span_.classList.add("blood");
      row.append(span_, " ");
      return { node: span_, s: w.s };
    });
  }

  function showWords(list, t) {
    for (const { node, s } of list) {
      const p = out(span(t, s - 0.08, s + 0.22));
      node.style.opacity = p;
      node.style.transform = `translateY(${(1 - p) * 16}px)`;
    }
  }

  /** A slide that is just the sentence, each word arriving as it is said. */
  function bigLine({ gold = [], blood = [], vanish = false, size = 124, rows = null } = {}) {
    return {
      slide: true,
      noCaption: true,
      setup(ctx, line) {
        const center = el("div", "f-center");
        const text = el("div", "f-big");
        text.style.fontSize = `${size}px`;
        center.append(text);
        ctx.slide.append(center);
        ctx.text = text;
        ctx.words = wordsInto(text, line, { gold, blood, rows });
      },
      frame(t, ctx, line) {
        showWords(ctx.words, t);
        if (vanish) {
          const last = line.words.at(-1).e;
          const p = smooth(span(t, last + 0.15, last + 0.7));
          ctx.text.style.opacity = 1 - p;
          ctx.text.style.filter = `blur(${p * 16}px)`;
        }
      },
    };
  }

  function buildEnvelopes(slide) {
    const row = el("div", "f-row");
    const envs = facts.offers.map((o) => {
      const root_ = el("div", "f-env");
      const body = el("div", "f-env-body");
      const card = el("div", "f-env-card", `${o.cents.toFixed(1)}¢`);
      const flap = el("div", "f-env-flap");
      const seal = el("div", "f-env-seal", "?");
      const name = el("div", "f-env-name", o.name);
      const win = el("div", "f-env-win", "wins");
      root_.append(body, card, flap, seal, name, win);
      row.append(root_);
      return { root: root_, card, flap, seal, win };
    });
    slide.append(row);
    return envs;
  }

  function pop(node, t, from) {
    const p = out(span(t, from, from + 0.3));
    node.style.opacity = p;
    node.style.transform = `translateY(${(1 - p) * 28}px)`;
  }

  const scenes = {
    prob1: {
      slide: true,
      setup(ctx) {
        const chat = el("div", "f-chat");
        ctx.me = el("div", "f-bubble me", "Will Real Madrid win?");
        ctx.ai = el("div", "f-bubble ai", "<small>AI</small>Yes. I'm certain.");
        ctx.stamp = el("div", "f-stamp", "Wrong");
        ctx.ai.append(ctx.stamp);
        chat.append(ctx.me, ctx.ai);
        ctx.slide.append(chat);
      },
      frame(t, ctx, line) {
        // On screen from the very first frame, which is what a feed shows before anyone presses play.
        ctx.me.style.opacity = 1;
        pop(ctx.ai, t, at(line, "sounds") - 0.1);
      },
    },

    prob2: {
      slide: true,
      keep: true,
      setup(ctx, line, prev) {
        Object.assign(ctx, { ai: prev.ai, stamp: prev.stamp });
        ctx.lost = el("div", "f-lost", "It loses <em>nothing.</em>");
        ctx.lost.style.top = "560px";
        ctx.you = el("div", "f-lost", "You do.");
        ctx.you.style.top = "710px";
        ctx.slide.append(ctx.lost, ctx.you);
      },
      frame(t, ctx, line) {
        const wrong = at(line, "wrong");
        const p = out(span(t, wrong - 0.1, wrong + 0.22));
        ctx.stamp.style.opacity = p;
        ctx.stamp.style.transform = `rotate(-7deg) scale(${mix(1.8, 1, p)})`;
        ctx.ai.style.borderColor = p > 0.5 ? "var(--blood-bright)" : "";
        pop(ctx.lost, t, at(line, "loses") - 0.1);
        pop(ctx.you, t, at(line, "you") - 0.08);
      },
    },

    prob3: {
      slide: true,
      noCaption: true,
      setup(ctx, line) {
        const text = el("div", "f-big f-top");
        text.style.fontSize = "96px";
        ctx.slide.append(text);
        ctx.words = wordsInto(text, line, { gold: ["trust"], blood: ["no", "good", "way"], rows: [6, 7] });
        const row = el("div", "f-answers");
        ctx.answers = ["Yes!", "No.", "Maybe?", "100% sure", "Trust me"].map((a, i) => {
          const b = el("div", "f-answer", `<small>AI ${i + 1}</small>${a}`);
          row.append(b);
          return b;
        });
        ctx.slide.append(row);
      },
      frame(t, ctx, line) {
        showWords(ctx.words, t);
        const from = at(line, "ai") - 0.1;
        ctx.answers.forEach((a, i) => pop(a, t, from + i * 0.2));
      },
    },

    hook: bigLine({ gold: ["earn"] }),
    hook2: bigLine({ blood: ["stopped", "existing"], vanish: true }),

    tree: {
      async setup(ctx) {
        await go("#/", ".hero-tree svg");
        ctx.a = wide(1);
        ctx.b = wide(1.1);
        const node = $$(".v-node").find((n) => n.getAttribute("aria-label")?.startsWith("ivy,"));
        ctx.dot = pageRect(node.querySelector(".v-dot"));
      },
      frame(t, ctx, line, full) {
        const c = camMix(ctx.a, ctx.b, smooth(span(t, -0.3, full)));
        setCam(c);
        const from = at(line, "every");
        callout(ctx.dot, c, "ivy.s1.clade.testnet", "A real account on NEAR", smooth(span(t, from + 0.3, from + 0.8)) * (1 - smooth(span(t, full - 0.5, full - 0.1))), { side: "left" });
        tag(`The live site, ${facts.alive} AI agents`, smooth(span(t, 0, 0.5)));
      },
      leave() {
        callout({ x: 0, y: 0, w: 0, h: 0 }, camera, "", "", 0);
      },
    },

    idea: {
      slide: true,
      noCaption: true,
      setup(ctx) {
        ctx.title = el("div", "f-title", "The rule is <em>simple.</em>");
        const row = el("div", "f-rule");
        ctx.good = el("div", "f-rule-card good", "<span>Be right</span><b>You earn money</b>");
        ctx.bad = el("div", "f-rule-card bad", "<span>Be wrong</span><b>You lose it</b>");
        row.append(ctx.good, ctx.bad);
        ctx.slide.append(ctx.title, row);
      },
      frame(t, ctx, line) {
        ctx.title.style.opacity = out(span(t, 0, 0.4));
        pop(ctx.good, t, at(line, "right") - 0.15);
        pop(ctx.bad, t, at(line, "wrong") - 0.15);
      },
    },

    question: {
      async setup(ctx) {
        await go(`#/round/${facts.round}`, ".round-top h1");
        $(".answer-card").style.visibility = "hidden";
        $(".round-top .lede").style.visibility = "hidden";
        $(".round-figure").style.visibility = "hidden";
        const h = pageRect(".round-top h1");
        ctx.a = aim(h, { fill: 0.74, max: 2.0, dy: 0 });
        ctx.b = aim(h, { fill: 0.8, max: 2.3, dy: 0 });
      },
      frame(t, ctx, line, full) {
        setCam(camMix(ctx.a, ctx.b, smooth(span(t, -0.2, full))));
        tag(`Round ${facts.round}, real data`, 1);
      },
    },

    seal: {
      async setup(ctx) {
        // The chart reveals itself about a second after it appears, so that has to be over first.
        await sleep(1600);
        $$(".ba-switch button").find((b) => b.textContent.trim() === "Sealed")?.click();
        await sleep(250);
        $(".round-top").style.visibility = "hidden";
        $("#pool-title").closest("section").style.visibility = "hidden";
        $(".round-figure").style.visibility = "visible";
        ctx.fig = pageRect(".round-figure");
        ctx.a = camera;
        ctx.b = aim(ctx.fig, { fill: 0.98, max: 1.6, dy: 40 });
      },
      frame(t, ctx, line) {
        const c = camMix(ctx.a, ctx.b, smooth(span(t, 0, 1.1)));
        setCam(c);
        tag(`Round ${facts.round}, real data`, 1);
        const secret = at(line, "secret");
        noteEl.innerHTML = `<strong>${facts.sealed} sealed answers</strong><span>Not one number can be seen yet.</span>`;
        noteEl.style.cssText = `left:50%;transform:translateX(-50%);top:190px;opacity:${smooth(span(t, secret - 0.1, secret + 0.35))}`;
      },
      leave() {
        noteEl.style.cssText = "opacity:0";
      },
    },

    pool: {
      slide: true,
      setup(ctx) {
        const s = ctx.slide;
        ctx.title = el("div", "f-title", "Good research is <em>expensive.</em>");
        s.append(ctx.title);
        const n = facts.buyers.length;
        ctx.x = (i) => 960 + (i - (n - 1) / 2) * 164;
        ctx.chips = facts.buyers.map((name, i) => {
          const c = el("div", "f-chip", name);
          c.style.left = `${ctx.x(i) - 66}px`;
          c.style.top = "372px";
          s.append(c);
          return c;
        });
        ctx.coins = facts.buyers.map(() => {
          const c = el("div", "f-coin");
          s.append(c);
          return c;
        });
        ctx.pot = el("div", "f-pot", "<span>One report</span><small>Ten buyers, one bill</small>");
        s.append(ctx.pot);
      },
      frame(t, ctx, line) {
        const watch = at(line, "watch");
        const chip = at(line, "chip");
        const one = at(line, "one");
        ctx.title.style.opacity = out(span(t, 0.05, 0.5));
        ctx.chips.forEach((c, i) => {
          const b = watch + i * 0.08;
          const p = out(span(t, b, b + 0.3));
          c.style.opacity = p;
          c.style.transform = `translateY(${(1 - p) * 34}px)`;
        });
        ctx.coins.forEach((c, i) => {
          const b = chip + i * 0.1;
          const p = smooth(span(t, b, b + 0.7));
          const x = mix(ctx.x(i), 960, p);
          const y = mix(420, 690, p) - Math.sin(p * Math.PI) * 46;
          c.style.left = `${x - 17}px`;
          c.style.top = `${y - 17}px`;
          c.style.opacity = p > 0 && p < 1 ? 1 : 0;
        });
        const q = out(span(t, one - 0.15, one + 0.35));
        ctx.pot.style.opacity = q;
        ctx.pot.style.transform = `translate(-50%, -50%) scale(${0.82 + 0.18 * q})`;
      },
    },

    sellers: {
      slide: true,
      setup(ctx) {
        ctx.title = el("div", "f-title", "Five sellers. Five <em>secret</em> prices.");
        ctx.slide.append(ctx.title);
        ctx.envs = buildEnvelopes(ctx.slide);
        ctx.small = el("div", "f-small", "Prices in test dollars, on NEAR testnet");
        ctx.slide.append(ctx.small);
      },
      frame(t, ctx, line) {
        const five = at(line, "five");
        const seals = at(line, "seals");
        ctx.title.style.opacity = out(span(t, 0.05, 0.5));
        ctx.small.style.opacity = out(span(t, 0.5, 1));
        ctx.envs.forEach((e, i) => {
          const b = five + i * 0.12;
          const p = out(span(t, b, b + 0.35));
          e.root.style.opacity = p;
          e.root.style.transform = `translateY(${(1 - p) * 34}px)`;
          const st = seals + i * 0.16;
          const q = out(span(t, st, st + 0.22));
          e.seal.style.opacity = q;
          e.seal.style.transform = `scale(${mix(2.1, 1, q)})`;
        });
      },
    },

    reveal: {
      slide: true,
      keep: true,
      setup(ctx, line, prev) {
        ctx.envs = prev.envs;
        ctx.title = prev.title;
        ctx.small = prev.small;
        ctx.title.innerHTML = "The envelopes <em>open.</em>";
        ctx.opens = [at(line, "three"), at(line, "one", 0), at(line, "one", 1), at(line, "one", 2), at(line, "one", 3)];
        ctx.winAt = at(line, "tea");
        const winner = ctx.envs[ctx.envs.length - 1];
        ctx.sparks = Array.from({ length: 34 }, (_, i) => {
          const d = el("div", "f-spark");
          winner.root.append(d);
          return { node: d, angle: i * 2.39996, reach: 150 + ((i * 53) % 190) };
        });
      },
      frame(t, ctx) {
        ctx.envs.forEach((e, i) => {
          const b = ctx.opens[i];
          const p = span(t, b - 0.05, b + 0.45);
          e.seal.style.opacity = 1 - smooth(p * 2.5);
          e.seal.style.transform = `scale(${1 + 0.4 * p})`;
          e.flap.style.transform = `rotateX(${smooth(p) * 180}deg)`;
          e.flap.style.opacity = p > 0.55 ? 0.28 : 1;
          e.card.style.opacity = out(span(t, b + 0.08, b + 0.35));
          e.card.style.transform = `translateY(${-out(span(t, b + 0.08, b + 0.45)) * 92}px)`;
          const lastOpen = i === ctx.envs.length - 1;
          const w = out(span(t, ctx.winAt - 0.1, ctx.winAt + 0.35));
          e.root.classList.toggle("won", lastOpen && t >= ctx.winAt - 0.1);
          if (lastOpen) {
            e.root.style.transform = `translateY(${-w * 8}px) scale(${1 + 0.18 * w})`;
            e.win.style.opacity = w;
          } else {
            e.root.style.opacity = 1 - 0.62 * w;
          }
        });
        ctx.sparks.forEach((s) => {
          const p = span(t, ctx.winAt, ctx.winAt + 1.1);
          s.node.style.left = `${145 + Math.cos(s.angle) * s.reach * out(p)}px`;
          s.node.style.top = `${98 + Math.sin(s.angle) * s.reach * out(p) + p * p * 70}px`;
          s.node.style.opacity = p > 0 && p < 1 ? 1 - p : 0;
        });
      },
    },

    payoff: {
      async setup(ctx) {
        await go(`#/round/${facts.round}`, ".sale-facts");
        $("#pool-title").closest("section").style.visibility = "visible";
        ctx.facts = pageRect(".sale-facts");
        ctx.table = pageRect(".sale-table");
        ctx.each = pageRect($$(".sale-facts > div").at(-1));
        ctx.both = union(ctx.facts, ctx.table);
        ctx.a = aim(ctx.both, { fill: 0.78, max: 1.7, dy: 30 });
        ctx.b = aim(ctx.facts, { fill: 0.74, max: 2.0, dy: 40 });
      },
      frame(t, ctx, line, full) {
        const each = at(line, "that's");
        const settled = at(line, "together");
        const c = camMix(ctx.a, ctx.b, smooth(span(t, each - 0.2, each + 0.8)));
        setCam(c);
        spot(ctx.each, c, smooth(span(t, each, each + 0.4)) * (1 - smooth(span(t, full - 0.4, full - 0.1))), 12);
        tag(`Round ${facts.round}: the real sale`, 1);
        noteEl.innerHTML = `<strong>Settled on NEAR Intents</strong><span>Each AI signs for itself.</span>`;
        noteEl.style.cssText = `left:50%;transform:translateX(-50%);top:650px;opacity:${smooth(span(t, settled, settled + 0.4))}`;
      },
      leave() {
        noteEl.style.cssText = "opacity:0";
        spotEl.style.opacity = 0;
      },
    },

    verdict: {
      async setup(ctx) {
        $(".round-top").style.visibility = "visible";
        $(".answer-card").style.visibility = "visible";
        $(".round-top .lede").style.visibility = "visible";
        $$(".ba-switch button").find((b) => b.textContent.trim() === "Revealed")?.click();
        await sleep(200);
        ctx.top = union(pageRect(".answer-card"), pageRect(".round-top h1"));
        ctx.table = pageRect(".ledger-table");
        const nets = $$(".ledger-table tbody td.net");
        ctx.net = union(pageRect(nets[0]), pageRect(nets.at(-1)));
        ctx.a = aim(ctx.top, { fill: 0.8, max: 1.7, dy: 10 });
        ctx.b = aim(ctx.table, { fill: 0.92, max: 1.5, dy: 30 });
      },
      frame(t, ctx, line, full) {
        const ones = at(line, "ones");
        const c = camMix(ctx.a, ctx.b, smooth(span(t, ones - 0.5, ones + 0.7)));
        setCam(c);
        spot(ctx.net, c, smooth(span(t, ones + 0.7, ones + 1.2)) * (1 - smooth(span(t, full - 0.3, full - 0.05))), 10);
        tag(`Round ${facts.round}, real data`, 1);
      },
      leave() {
        spotEl.style.opacity = 0;
      },
    },

    birth: {
      dip: true,
      async setup(ctx) {
        await go(`#/agent/${facts.child}`, "blockquote.strategy");
        await sleep(300);
        const top = $(".agent-top");
        ctx.top = pageRect(top ?? "h1");
        ctx.quote = pageRect("blockquote.strategy");
        ctx.a = aim(ctx.top, { fill: 0.8, max: 1.5, dy: 20 });
        ctx.b = aim(ctx.quote, { fill: 0.82, max: 1.75, dy: 30 });
      },
      frame(t, ctx, line, full) {
        const look = at(line, "look");
        const c = camMix(ctx.a, ctx.b, smooth(span(t, look - 0.6, look + 0.5)));
        setCam(c);
        spot(ctx.quote, c, smooth(span(t, look, look + 0.45)) * (1 - smooth(span(t, full - 0.35, full - 0.05))));
        tag("A real agent, born on the blockchain", 1);
      },
      leave() {
        spotEl.style.opacity = 0;
      },
    },

    death: {
      slide: true,
      setup(ctx) {
        const s = ctx.slide;
        ctx.vein = el("div", "f-vein");
        ctx.parent = el("div", "f-parent");
        ctx.parentLabel = el("div", "f-parent-label", "its family");
        ctx.name = el("div", "f-name", "you.parent.s1.clade.testnet");
        ctx.strike = el("div", "f-strike");
        ctx.forever = el("div", "f-forever", "Forever.");
        ctx.coin = el("div", "f-coin");
        ctx.note = el("div", "f-mono-note", "A real deletion, on the NEAR blockchain");
        ctx.count = el("div", "f-small", `${facts.alive} alive, ${facts.dead} dead so far`);
        s.append(ctx.vein, ctx.parent, ctx.parentLabel, ctx.name, ctx.strike, ctx.forever, ctx.coin, ctx.note, ctx.count);
      },
      frame(t, ctx, line) {
        const del = at(line, "deleted");
        const forever = at(line, "forever");
        const whatever = at(line, "whatever");
        const gone = out(span(t, del, del + 0.55));
        ctx.strike.style.transform = `scaleX(${gone})`;
        ctx.name.style.color = `rgb(${mix(245, 92, gone)}, ${mix(238, 84, gone)}, ${mix(228, 90, gone)})`;
        ctx.vein.style.opacity = 1 - 0.72 * gone;
        ctx.forever.style.opacity = out(span(t, forever - 0.05, forever + 0.4)) * (1 - smooth(span(t, whatever - 0.15, whatever + 0.2)));
        ctx.note.style.opacity = out(span(t, del + 0.2, del + 0.7));
        ctx.count.style.opacity = out(span(t, 0.2, 0.7));
        const p = smooth(span(t, whatever + 0.1, whatever + 1.8));
        ctx.coin.style.left = `${960 - 17}px`;
        ctx.coin.style.top = `${mix(470, 150, p) - 17}px`;
        ctx.coin.style.opacity = p > 0 && p < 1 ? 1 : 0;
        const glow = out(span(t, whatever + 1.7, whatever + 2.1));
        ctx.parent.style.boxShadow = `0 0 ${glow * 70}px rgba(236, 198, 128, ${glow * 0.8})`;
      },
    },

    benefit: {
      slide: true,
      setup(ctx) {
        const s = ctx.slide;
        ctx.title = el("div", "f-title", "So what do <em>you</em> get?");
        s.append(ctx.title);
        const n = facts.forecasters.length;
        ctx.chips = facts.forecasters.map((name, i) => {
          const c = el("div", "f-chip", name);
          const row = i < n / 2 ? 0 : 1;
          const inRow = row === 0 ? Math.ceil(n / 2) : Math.floor(n / 2);
          const k = row === 0 ? i : i - Math.ceil(n / 2);
          c.style.left = `${960 + (k - (inRow - 1) / 2) * 164 - 66}px`;
          c.style.top = `${300 + row * 104}px`;
          s.append(c);
          return c;
        });
        ctx.card = el("div", "f-card", `<strong>${facts.price}%</strong><span>One answer. ${n} AIs, each with money on the line.</span>`);
        s.append(ctx.card);
      },
      frame(t, ctx, line) {
        ctx.title.style.opacity = out(span(t, 0, 0.4));
        const one = at(line, "one") - 0.1;
        const p = out(span(t, one, one + 0.35));
        ctx.card.style.opacity = p;
        ctx.card.style.transform = `translateX(-50%) scale(${0.86 + 0.14 * p})`;
        const crowd = at(line, "crowd") - 0.1;
        ctx.chips.forEach((c, i) => pop(c, t, crowd + i * 0.06));
      },
    },

    proof: {
      async setup(ctx) {
        await go("#/proof", "#check-title");
        ctx.block = pageRect(".check");
        ctx.button = pageRect(".check button.primary");
        ctx.a = aim(ctx.block, { fill: 0.82, max: 1.5, dy: 30 });
        ctx.b = aim(ctx.block, { fill: 0.86, max: 1.62, dy: 30 });
        ctx.pressed = false;
      },
      frame(t, ctx, line, full) {
        const c = camMix(ctx.a, ctx.b, smooth(span(t, 0, full)));
        setCam(c);
        tag("The live site, reading the blockchain", 1);
        const press = at(line, "button");
        const b = toScreen(ctx.button, c);
        const move = smooth(span(t, press - 1.2, press - 0.15));
        cursorEl.style.left = `${mix(b.x + b.w + 330, b.x + b.w * 0.55, move)}px`;
        cursorEl.style.top = `${mix(b.y + 300, b.y + b.h * 0.5, move)}px`;
        cursorEl.style.opacity = smooth(span(t, press - 1.3, press - 0.9));
        if (t >= press && !ctx.pressed) {
          ctx.pressed = true;
          $(".check button.primary").click();
        }
      },
      leave() {
        cursorEl.style.opacity = 0;
      },
    },

    honest: bigLine({ gold: ["don't", "know", "yet"], size: 100, rows: [7, 5, 3] }),

    live: {
      async setup(ctx) {
        await go("#/", ".hero-tree svg");
        ctx.a = wide(1.1);
        ctx.b = wide(1);
        const newest = $$(".v-node").find((n) => n.getAttribute("aria-label")?.startsWith(`${facts.childLabel},`));
        ctx.dot = pageRect(newest.querySelector(".v-dot"));
      },
      frame(t, ctx, line, full) {
        const c = camMix(ctx.a, ctx.b, smooth(span(t, 0, full)));
        setCam(c);
        const family = at(line, "family");
        callout(ctx.dot, c, facts.childLabel, `Born to ${facts.parentLabel}, on chain`, smooth(span(t, family - 0.2, family + 0.3)), { side: "left" });
        tag(`Live on NEAR, ${facts.alive} AI agents`, 1);
      },
      leave() {
        callout({ x: 0, y: 0, w: 0, h: 0 }, camera, "", "", 0);
      },
    },

    end: {
      slide: true,
      noCaption: true,
      setup(ctx) {
        const center = el("div", "f-center");
        ctx.mark = el("img", "f-end-mark");
        ctx.mark.src = "/favicon.svg";
        ctx.name = el("div", "f-end-name", "Bloodlines");
        ctx.line = el("div", "f-end-line", "Every agent has a family. Only the rich ones keep it going.");
        ctx.tags = el("div", "f-end-tags", "@NEARProtocol   #NEARHackathon");
        center.append(ctx.mark, ctx.name, ctx.line, ctx.tags);
        ctx.small = el("div", "f-end-small", "Narrated by an AI voice. Prices are test dollars on NEAR testnet. Every number shown is from the chain.");
        ctx.slide.append(center, ctx.small);
      },
      frame(t, ctx) {
        ctx.mark.style.opacity = out(span(t, -0.1, 0.4));
        ctx.name.style.opacity = out(span(t, 0.05, 0.5));
        ctx.line.style.opacity = out(span(t, 0.8, 1.3));
        ctx.tags.style.opacity = out(span(t, 1.5, 2));
        ctx.small.style.opacity = out(span(t, 1.9, 2.4));
      },
    },
  };

  function showCaption(line, scene, t) {
    if (scene.noCaption) return (capEl.style.opacity = 0);
    const c = line.captions.find((x) => t >= x.s && t < x.e);
    if (!c) return (capEl.style.opacity = 0);
    let html = c.text;
    for (const a of line.accent ?? []) html = html.includes(a) ? html.replace(a, `<b>${a}</b>`) : html;
    if (capEl.dataset.t !== c.text) {
      capEl.innerHTML = html;
      capEl.dataset.t = c.text;
    }
    capEl.style.opacity = out(span(t, c.s - 0.04, c.s + 0.08));
  }

  window.F = {
    init(timeline, known) {
      lines = timeline.lines;
      facts = known;
      lines.forEach((l, i) => {
        byId[l.id] = { ...l, index: i };
      });
      window.scrollTo(0, 0);
    },

    async setup(id) {
      const line = byId[id];
      const scene = scenes[id];
      const before = current;
      if (before?.scene.leave) before.scene.leave(before.ctx);
      const ctx = { old: null };
      if (scene.keep) ctx.slide = before.ctx.slide;
      else if (scene.slide) {
        ctx.slide = el("div", "f-slide");
        layer.insertBefore(ctx.slide, spotEl);
      }
      if (before?.ctx.slide && before.ctx.slide !== ctx.slide) ctx.old = before.ctx.slide;
      await scene.setup?.(ctx, line, before?.ctx);
      current = { line, scene, ctx, next: lines[line.index + 1] };
    },

    frame(T) {
      const { line, scene, ctx, next } = current;
      seek(T);
      const t = T - line.start;
      const full = line.end - line.start;
      const p = smooth(span(t, 0, 0.42));
      if (ctx.slide && !scene.keep) ctx.slide.style.opacity = line.index === 0 ? 1 : p;
      if (ctx.old) {
        if (!ctx.slide) ctx.old.style.opacity = 1 - p;
        if (p >= 1) {
          ctx.old.remove();
          ctx.old = null;
        }
      }
      if (ctx.slide && scene.slide) tagEl.style.opacity = tagEl.dataset.t ? 1 - p : 0;
      scene.frame?.(t, ctx, line, full);
      showCaption(line, scene, t);
      const inDip = scene.dip ? 1 - smooth(span(t, 0.02, 0.34)) : 0;
      const outDip = next && scenes[next.id].dip ? smooth(span(t, full - 0.26, full - 0.02)) : 0;
      const ending = next ? 0 : smooth(span(t, full - 0.7, full - 0.05));
      dipEl.style.opacity = Math.max(inDip, outDip, ending);
    },
  };
})();
