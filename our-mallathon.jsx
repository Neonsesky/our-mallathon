import { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   OUR MALLATHON '26 — Nirsh ♥ Shady
   A scrapbook album for the Dubai Mallathon week.
   Swipe between days · log steps · tape in polaroids ·
   slap patch stickers · unlock the finisher certificate.
   ============================================================ */

const DAY_THEMES = [
  { c1: "#FF4D2E", c2: "#FFB03C", name: "coral" },
  { c1: "#F2308F", c2: "#FF7AC3", name: "magenta" },
  { c1: "#7A3FF2", c2: "#B08CFF", name: "violet" },
  { c1: "#00A896", c2: "#6FE3C1", name: "teal" },
  { c1: "#FFB300", c2: "#FFE066", name: "amber" },
  { c1: "#2E5CFF", c2: "#7AA0FF", name: "blue" },
];

// page gradients: cover, 6 days, finale
const PAGE_COLORS = [
  ["#FF4D2E", "#7A3FF2"],
  ...DAY_THEMES.map((t) => [t.c1, t.c2]),
  ["#FFB300", "#FF4D2E"],
];

const DEFAULT_DAYS = [
  "Dubai Mall",
  "Mall of the Emirates",
  "Dubai Hills Mall",
  "Dubai Festival City",
  "City Centre Mirdif",
  "City Centre Deira",
].map((mall, i) => ({
  mall,
  date: "",
  time: "",
  stepsN: "",
  stepsF: "",
  caption: "",
  moodN: "",
  moodF: "",
  rating: 0,
  patchDone: false,
}));

const MOODS = ["😍", "🔥", "🥵", "💪", "🥹", "🤪", "😮‍💨", "🫠"];

const DEFAULT_NOTE =
  "shady — six malls, six early alarms, and a ridiculous number of steps… and i'd do it all again tomorrow as long as you're walking next to me. you turn even mall laps into my favourite adventure. this little book is ours now. i love you.";

/* ---------- tiny utilities ---------- */

function hexBlend(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

function fmt(n) {
  const v = parseInt(String(n).replace(/[^\d]/g, ""), 10);
  return isNaN(v) ? 0 : v;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// shrink an image file to a friendly base64 jpeg
function fileToDataUrl(file, maxDim = 1100, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("decode failed"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// spring animator — damping ratio + response, semi-implicit euler
function springTo({ from, to, velocity = 0, damping = 1, response = 0.4, onUpdate, onDone }) {
  const omega = (2 * Math.PI) / response;
  const k = omega * omega, c = 2 * damping * omega;
  let x = from, v = velocity, last = performance.now(), raf;
  const frame = (now) => {
    const dt = Math.min((now - last) / 1000, 0.034);
    last = now;
    const a = -k * (x - to) - c * v;
    v += a * dt;
    x += v * dt;
    if (Math.abs(x - to) < 0.15 && Math.abs(v) < 2) {
      onUpdate(to);
      onDone && onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function rubberband(over, dim, c = 0.55) {
  return (over * dim * c) / (dim + c * Math.abs(over));
}

function project(v, rate = 0.998) {
  return ((v / 1000) * rate) / (1 - rate);
}

/* ---------- instagram story designer (1080×1920 canvas) ---------- */

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}
function coverInto(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const nw = img.width * r, nh = img.height * r;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - nw) / 2, y + (h - nh) / 2, nw, nh);
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let p = 0; p < 10; p++) {
    const ang = -Math.PI / 2 + (p * Math.PI) / 5;
    const rad = p % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

async function buildStory({ photoSrc, stickerSrc, minis, c1, c2, kicker, big, sub, dateLine, caption, steps, stepsLabel, footer }) {
  try {
    await Promise.all([
      document.fonts.load('100px Anton'),
      document.fonts.load('60px "Permanent Marker"'),
    ]);
  } catch {}
  const W = 1080, H = 1920, INK = "#17120E", PAPER = "#F7F0E1";
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // gradient sky
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // doodles
  ctx.strokeStyle = "rgba(255,255,255,.8)";
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.setLineDash([30, 26]);
  ctx.beginPath(); ctx.arc(110, 1430, 150, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(60, 560); ctx.quadraticCurveTo(140, 460, 220, 550); ctx.quadraticCurveTo(300, 640, 380, 510);
  ctx.stroke();
  drawStar(ctx, 985, 560, 64);
  ctx.beginPath();
  ctx.moveTo(830, 1690); ctx.lineTo(990, 1690);
  ctx.moveTo(990, 1690); ctx.lineTo(930, 1640);
  ctx.moveTo(990, 1690); ctx.lineTo(930, 1740);
  ctx.stroke();

  // grain speckles
  for (let k = 0; k < 1200; k++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.06)";
    ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }

  // brand pill
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "44px Anton";
  const ktw = ctx.measureText(kicker).width;
  ctx.save();
  ctx.translate(W / 2, 128);
  ctx.rotate(-0.02);
  ctx.fillStyle = INK;
  rr(ctx, -ktw / 2 - 36, -44, ktw + 72, 88, 44);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.fillText(kicker, 0, 5);
  ctx.restore();
  ctx.textBaseline = "alphabetic";

  // big title with letterpress shadow
  ctx.font = "185px Anton";
  ctx.fillStyle = INK;
  ctx.fillText(big, W / 2 + 10, 420 + 10);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(big, W / 2, 420);

  // mall / subtitle — shrink to fit
  let fs = 84;
  ctx.font = fs + "px Anton";
  while (ctx.measureText(sub).width > W - 140 && fs > 38) {
    fs -= 4;
    ctx.font = fs + "px Anton";
  }
  ctx.fillStyle = INK;
  ctx.fillText(sub, W / 2 + 6, 530 + 6);
  ctx.fillStyle = "#FFDD33";
  ctx.fillText(sub, W / 2, 530);

  if (dateLine) {
    ctx.font = '46px "Permanent Marker"';
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fillText(dateLine, W / 2, 610);
  }

  // polaroid
  let photoImg = null, stickerImg = null;
  try { if (photoSrc) photoImg = await loadImg(photoSrc); } catch {}
  try { if (stickerSrc) stickerImg = await loadImg(stickerSrc); } catch {}

  ctx.save();
  ctx.translate(W / 2, 680 + 405);
  ctx.rotate(-0.045);
  ctx.shadowColor = "rgba(0,0,0,.38)";
  ctx.shadowBlur = 55;
  ctx.shadowOffsetY = 34;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(-360, -405, 720, 810);
  ctx.shadowColor = "transparent";
  if (photoImg) coverInto(ctx, photoImg, -320, -365, 640, 640);
  else { ctx.fillStyle = "#1c1712"; ctx.fillRect(-320, -365, 640, 640); }
  // caption (ellipsized)
  ctx.font = '52px "Permanent Marker"';
  ctx.fillStyle = "#2b2118";
  let cap = caption || "";
  while (ctx.measureText(cap).width > 630 && cap.length > 2) cap = cap.slice(0, -2);
  if (cap !== (caption || "")) cap += "…";
  ctx.fillText(cap, 0, 355);
  // tape
  ctx.save();
  ctx.rotate(0.06);
  ctx.fillStyle = "rgba(255,235,170,.85)";
  ctx.fillRect(-92, -448, 184, 52);
  ctx.restore();
  ctx.restore();

  // patch: a second, smaller polaroid of the real uploaded photo (day)
  // or mini badge row of real photos (finale)
  if (stickerImg) {
    ctx.save();
    ctx.translate(760, 1360);
    ctx.rotate(0.09);
    ctx.shadowColor = "rgba(0,0,0,.4)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 22;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(-170, -190, 340, 380);
    ctx.shadowColor = "transparent";
    coverInto(ctx, stickerImg, -150, -170, 300, 300);
    ctx.font = '38px "Permanent Marker"';
    ctx.fillStyle = "#2b2118";
    ctx.fillText("the patch!! ✌️", 0, 166);
    ctx.save();
    ctx.rotate(-0.12);
    ctx.fillStyle = "rgba(255,235,170,.85)";
    ctx.fillRect(-60, -212, 120, 36);
    ctx.restore();
    ctx.restore();
  } else if (minis && minis.length) {
    const startX = W / 2 - ((minis.length - 1) * 118) / 2;
    for (let m = 0; m < minis.length; m++) {
      const mi = minis[m];
      ctx.save();
      ctx.translate(startX + m * 118, 1520);
      ctx.rotate(m % 2 ? 0.08 : -0.08);
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2);
      if (mi.img) { ctx.save(); ctx.clip(); coverInto(ctx, mi.img, -48, -48, 96, 96); ctx.restore(); }
      else { ctx.fillStyle = mi.color; ctx.fill(); }
      ctx.restore();
    }
  }

  // steps pill
  if (steps) {
    ctx.save();
    ctx.translate(W / 2, 1668);
    ctx.rotate(0.015);
    ctx.fillStyle = INK;
    rr(ctx, -330 + 10, -95 + 12, 660, 190, 36); ctx.fill();
    ctx.fillStyle = PAPER;
    rr(ctx, -330, -95, 660, 190, 36); ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = "92px Anton";
    ctx.fillText(steps, 0, 18);
    ctx.font = "800 30px Inter, sans-serif";
    ctx.fillText(stepsLabel, 0, 70);
    ctx.restore();
  }

  // footer
  ctx.font = '58px "Permanent Marker"';
  ctx.fillStyle = INK;
  ctx.fillText(footer, W / 2 + 4, 1820 + 4);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(footer, W / 2, 1820);
  ctx.font = "34px Anton";
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.fillText("MOVE IN STYLE. TOGETHER.", W / 2, 1878);

  return new Promise((resolve) => cv.toBlob(resolve, "image/png"));
}

/* ---------- storage helpers ----------
   Inside Claude: shared cloud storage (both phones sync).
   As a standalone website (e.g. GitHub Pages): saved on this
   device via IndexedDB, with localStorage as a fallback.       */

const HAS_CLOUD = typeof window !== "undefined" && !!window.storage;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("our-mallathon", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function deviceGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const r = db.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result != null ? r.result : null);
      r.onerror = () => resolve(null);
    });
  } catch {
    try { return localStorage.getItem(key); } catch { return null; }
  }
}
async function deviceSet(key, val) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    try { localStorage.setItem(key, val); return true; } catch { return false; }
  }
}

/* ---- GitHub sync: the app talks to a private data repo itself.
   Nirsh's phone writes on every change; Shady's phone only reads. ---- */

let GH = null; // { owner, repo, token, role } when mode === "github"
const GH_CONF_KEY = "mallathon:ghconf";

async function loadGhConf() {
  const v = await deviceGet(GH_CONF_KEY);
  const conf = v ? JSON.parse(v) : null;
  GH = conf && conf.mode === "github" ? conf : null;
  return conf;
}
async function saveGhConf(conf) {
  GH = conf && conf.mode === "github" ? conf : null;
  await deviceSet(GH_CONF_KEY, JSON.stringify(conf));
}

const shaCache = {};
const ghPath = (key) => key.replace(/:/g, "-") + ".json";
const utf8b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const b64utf8 = (s) => decodeURIComponent(escape(atob(s)));
const ghHeaders = (raw) => ({
  Authorization: "Bearer " + GH.token,
  Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
});
const ghUrl = (path) => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${path}`;

async function ghGet(key) {
  const path = ghPath(key);
  const res = await fetch(ghUrl(path) + "?t=" + Date.now(), { headers: ghHeaders(false), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("gh get " + res.status);
  const j = await res.json();
  shaCache[path] = j.sha;
  let text;
  if (j.content) {
    text = b64utf8(j.content.replace(/\n/g, ""));
  } else {
    const raw = await fetch(ghUrl(path) + "?t=" + Date.now(), { headers: ghHeaders(true), cache: "no-store" });
    if (!raw.ok) throw new Error("gh raw " + raw.status);
    text = await raw.text();
  }
  return JSON.parse(text);
}

async function ghSet(key, val) {
  const path = ghPath(key);
  const put = async () => {
    const body = { message: "scrapbook update: " + path, content: utf8b64(JSON.stringify(val)) };
    if (shaCache[path]) body.sha = shaCache[path];
    return fetch(ghUrl(path), { method: "PUT", headers: { ...ghHeaders(false), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };
  let res = await put();
  if (res.status === 409 || res.status === 422) {
    try { await ghGet(key); } catch { delete shaCache[path]; }
    res = await put();
  }
  if (!res.ok) return false;
  try {
    const j = await res.json();
    if (j.content && j.content.sha) shaCache[path] = j.content.sha;
  } catch {}
  return true;
}

async function sGet(key) {
  try {
    if (GH) {
      try {
        const v = await ghGet(key);
        if (v != null) deviceSet(key, JSON.stringify(v)); // offline mirror
        if (v != null) return v;
      } catch {}
      const local = await deviceGet(key); // offline fallback
      return local != null ? JSON.parse(local) : null;
    }
    if (HAS_CLOUD) {
      const r = await window.storage.get(key, true);
      return r ? JSON.parse(r.value) : null;
    }
    const v = await deviceGet(key);
    return v != null ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
async function sSet(key, val) {
  try {
    if (GH) {
      if (GH.role === "viewer") return false;
      deviceSet(key, JSON.stringify(val)); // always keep a local copy too
      return await ghSet(key, val);
    }
    if (HAS_CLOUD) {
      await window.storage.set(key, JSON.stringify(val), true);
      return true;
    }
    return await deviceSet(key, JSON.stringify(val));
  } catch {
    return false;
  }
}

/* ---------- decorative bits ---------- */

function Doodles({ theme, seed }) {
  // stop-motion scribbles floating behind each page
  const col = "rgba(255,255,255,0.85)";
  return (
    <div className="doodles" aria-hidden="true">
      <svg className="stopmo s1" style={{ top: "6%", left: "-14px" }} width="90" height="90" viewBox="0 0 90 90">
        <path d="M10 60 Q 30 10 50 45 T 85 30" fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" />
      </svg>
      <svg className="stopmo s2" style={{ top: "18%", right: "-10px" }} width="74" height="74" viewBox="0 0 74 74">
        <path d="M37 6 L45 28 L68 28 L50 42 L57 65 L37 51 L17 65 L24 42 L6 28 L29 28 Z" fill={col} opacity="0.9" />
      </svg>
      <svg className="stopmo s3" style={{ bottom: "26%", left: "-18px" }} width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="34" fill="none" stroke={col} strokeWidth="7" strokeDasharray="14 12" />
      </svg>
      <svg className="stopmo s4" style={{ bottom: "10%", right: "-8px" }} width="86" height="60" viewBox="0 0 86 60">
        <path d="M6 30 H62 M62 30 L44 12 M62 30 L44 48" fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg className="stopmo s5" style={{ top: "44%", right: "8%" }} width="46" height="42" viewBox="0 0 46 42">
        <path d="M23 40 C 6 26 0 14 8 7 C 14 2 21 5 23 11 C 25 5 32 2 38 7 C 46 14 40 26 23 40 Z" fill={col} />
      </svg>
    </div>
  );
}

function Tape({ style, tint = "rgba(255,235,170,0.75)" }) {
  return <div className="tape" aria-hidden="true" style={{ ...style, background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.35))` }} />;
}

function LoveNote({ note, opened, unlocked, onNote, onOpen }) {
  const [editing, setEditing] = useState(false);
  const [shake, setShake] = useState(false);
  const tryOpen = () => {
    if (unlocked) onOpen();
    else {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
  };
  return (
    <div className="loveWrap">
      {!opened ? (
        <button className={"envelope" + (unlocked ? " ready" : "") + (shake ? " shake" : "")} onClick={tryOpen}>
          <span className="envFlap" aria-hidden="true" />
          <span className="waxSeal" aria-hidden="true">♥</span>
          <span className="envText marker">
            {unlocked ? "for shady — break the seal 💌" : "a letter for shady · seal breaks at 6/6 patches"}
          </span>
        </button>
      ) : (
        <div className="noteCard">
          <Tape style={{ top: -13, left: "16%", transform: "rotate(-6deg)" }} />
          <div className="noteKicker marker">for shady 💌</div>
          {editing ? (
            <textarea
              className="marker noteArea"
              value={note || ""}
              placeholder="write something mushy here…"
              onChange={(e) => onNote(e.target.value)}
              onBlur={() => setEditing(false)}
              rows={6}
              maxLength={500}
              autoFocus
            />
          ) : (
            <p className="marker noteText" onClick={() => setEditing(true)}>{note || DEFAULT_NOTE}</p>
          )}
          <div className="noteSig marker">— nirsh</div>
        </div>
      )}
    </div>
  );
}

function MoodStamp({ label, value, onChange, tone }) {
  const next = () => {
    const i = MOODS.indexOf(value);
    onChange(MOODS[(i + 1) % MOODS.length]);
  };
  return (
    <button className="moodStamp" style={{ "--tone": tone }} onClick={next} aria-label={label + " mood — tap to change"}>
      <span className="moodEmoji">{value || "＋"}</span>
      <span className="moodWho">{label}</span>
    </button>
  );
}

/* ---------- polaroid ---------- */

function Polaroid({ src, caption, onPick, onCaption, rot = -3, label, busy, captionEditable = true }) {
  return (
    <figure className="polaroid" style={{ "--rot": rot + "deg" }}>
      <Tape style={{ top: -12, left: "50%", transform: "translateX(-50%) rotate(" + -rot * 1.4 + "deg)" }} />
      <button className="photoArea" onClick={onPick} aria-label={src ? "Replace photo" : "Add photo"}>
        {src ? (
          <>
            <img src={src} alt={label} draggable="false" />
            <span className="gloss" aria-hidden="true" />
          </>
        ) : (
          <span className="emptyPhoto">
            <span className="emptyIcon">📸</span>
            {busy ? "loading…" : "tap to add photo"}
          </span>
        )}
        {busy && <span className="spin" aria-hidden="true" />}
      </button>
      <figcaption>
        {captionEditable ? (
          <input
            className="marker capInput"
            value={caption || ""}
            placeholder={label}
            onChange={(e) => onCaption(e.target.value)}
            maxLength={40}
          />
        ) : (
          <span className="marker">{label}</span>
        )}
      </figcaption>
    </figure>
  );
}

// two polaroids stacked — tap "swap" to shuffle them like real prints
function PolaroidStack({ imgs, day, onPick, caption, onCaption, busyKey }) {
  const [front, setFront] = useState(0); // 0 = memory, 1 = patch shot
  const [anim, setAnim] = useState(false);
  const swap = () => {
    if (anim) return;
    setAnim(true);
    setTimeout(() => setFront((f) => 1 - f), 230);
    setTimeout(() => setAnim(false), 480);
  };
  const cards = [
    {
      key: "memory",
      src: imgs?.memory,
      label: "us, day " + day,
      cap: caption,
      capEdit: true,
    },
    {
      key: "patch",
      src: imgs?.patch,
      label: "the patch!! ✌️",
      cap: null,
      capEdit: false,
    },
  ];
  return (
    <div className="stackWrap">
      <div className={"stack" + (anim ? " swapping" : "")}>
        {cards.map((c, i) => {
          const isFront = front === i;
          return (
            <div
              key={c.key}
              className={
                "stackCard " +
                (isFront ? "front" : "back") +
                (anim && isFront ? " goingBack" : "") +
                (anim && !isFront ? " comingFront" : "")
              }
            >
              <Polaroid
                src={c.src}
                caption={c.cap}
                captionEditable={c.capEdit}
                label={c.label}
                rot={isFront ? -2.5 : 4}
                busy={busyKey === c.key}
                onPick={() => onPick(c.key)}
                onCaption={c.capEdit ? onCaption : () => {}}
              />
            </div>
          );
        })}
      </div>
      <button className="swapBtn" onClick={swap}>⇄ swap polaroids</button>
    </div>
  );
}

/* ---------- patch sticker ---------- */

function PatchSticker({ src, onPick, busy, theme, done }) {
  return (
    <button className={"sticker" + (src ? " stuck" : "")} onClick={onPick} style={{ "--ring": theme.c1 }}>
      {src ? (
        <img src={src} alt="patch sticker" draggable="false" />
      ) : (
        <span className="stickerEmpty">{busy ? "…" : "+ patch pic"}</span>
      )}
      {done && <span className="stickerCheck" aria-hidden="true">✓</span>}
    </button>
  );
}

/* ---------- setup (first run on a new phone) ---------- */

function SetupScreen({ initial, onDone, onClose }) {
  const init = initial && initial.mode === "github" ? initial : {};
  const [role, setRole] = useState(init.role || null);
  const [owner, setOwner] = useState(init.owner || "");
  const [repo, setRepo] = useState(init.repo || "mallathon-data");
  const [token, setToken] = useState(init.token || "");
  const canSave = owner.trim() && repo.trim() && token.trim();
  return (
    <div className="setup">
      <div className="setupCard">
        {onClose && <button className="setupClose" onClick={onClose}>✕</button>}
        <div className="setupKicker marker">our mallathon ’26</div>
        <div className="setupTitle">WHOSE PHONE IS THIS?</div>
        {!role ? (
          <div className="roleBtns">
            <button className="roleBtn" onClick={() => setRole("editor")}>
              <span className="roleName">NIRSH</span>
              <span className="roleDesc">✏️ i fill in the scrapbook</span>
            </button>
            <button className="roleBtn" onClick={() => setRole("viewer")}>
              <span className="roleName">SHADY</span>
              <span className="roleDesc">👀 i watch the magic appear</span>
            </button>
            <button className="roleSkip" onClick={() => onDone({ mode: "device" })}>
              skip — just save on this phone
            </button>
          </div>
        ) : (
          <div className="ghForm">
            <div className="ghNote marker">
              {role === "editor"
                ? "connect the secret data vault (a private github repo). the app saves there by itself — you never touch github again."
                : "ask nirsh for these three things — then the scrapbook updates here all by itself 💛"}
            </div>
            <label className="ghLabel">github username
              <input className="chip ghInput" value={owner} onChange={(e) => setOwner(e.target.value.trim())} placeholder="e.g. nirsh123" autoCapitalize="none" />
            </label>
            <label className="ghLabel">data repo name
              <input className="chip ghInput" value={repo} onChange={(e) => setRepo(e.target.value.trim())} placeholder="mallathon-data" autoCapitalize="none" />
            </label>
            <label className="ghLabel">access token
              <input className="chip ghInput" type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="github_pat_…" autoCapitalize="none" />
            </label>
            <button
              className="doneBtn ghSave"
              disabled={!canSave}
              onClick={() => onDone({ mode: "github", role, owner, repo, token })}
            >
              {role === "editor" ? "connect & start filling in" : "connect & start watching"}
            </button>
            <button className="roleSkip" onClick={() => setRole(null)}>← back</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- pages ---------- */

function CoverPage({ totals, doneCount, meta = {}, onMeta = () => {}, onExport = () => {}, onImport = () => {}, status = "", showRestore = true }) {
  return (
    <div className="page coverPage">
      <Doodles />
      <div className="coverInner">
        <div className="eyebrow marker">the official scrapbook of</div>
        <h1 className="mega">
          NIRSH<span className="heart">♥</span>SHADY
        </h1>
        <div className="subMega">DUBAI&nbsp;MALLATHON&nbsp;’26</div>
        <div className="tagline">move in style. together.</div>
        <div className="hiF marker">hi shady — i fill this in after every walk. come peek every day 💛</div>

        <div className="coverStats">
          <div className="statCard">
            <div className="statNum">{totals.toLocaleString()}</div>
            <div className="statLabel">our steps so far</div>
          </div>
          <div className="statCard">
            <div className="statNum">{doneCount}<span className="of">/6</span></div>
            <div className="statLabel">patches collected</div>
          </div>
        </div>

        <LoveNote
          note={meta.loveNote}
          opened={!!meta.noteOpened}
          unlocked={doneCount === 6}
          onNote={(v) => onMeta({ loveNote: v })}
          onOpen={() => onMeta({ noteOpened: true })}
        />

        <div className="swipeHint">
          swipe for day one <span className="arrowAnim">→</span>
        </div>

        <a className="siteLink" href="https://www.dubaimallathon.ae" target="_blank" rel="noreferrer">
          official mallathon site ↗
        </a>
        <div className="backupRow">
          <button className="tinyBtn" onClick={onExport}>⤓ backup</button>
          {showRestore && <button className="tinyBtn" onClick={onImport}>⤒ restore</button>}
        </div>
        <div className="saveNote">{status}</div>
      </div>
    </div>
  );
}

function DayPage({ i, day, imgs, theme, onDay, onPick, busyKey, onShare }) {
  const n = fmt(day.stepsN), f = fmt(day.stepsF);
  const total = n + f;
  const winner = n > f ? "N" : f > n ? "F" : null;
  return (
    <div className="page dayPage">
      <Doodles theme={theme} />
      <div className="scroll">
        <header className="dayHead">
          <div className="dayNum" aria-hidden="true">{String(i + 1).padStart(2, "0")}</div>
          <div className="dayHeadText">
            <div className="dayKicker marker">day {i + 1} of six</div>
            <input
              className="mallName"
              value={day.mall}
              onChange={(e) => onDay({ mall: e.target.value })}
              aria-label="Mall name"
            />
            <div className="chips">
              <input className="chip" value={day.date} placeholder="date · 15 Jun" onChange={(e) => onDay({ date: e.target.value })} />
              <input className="chip" value={day.time} placeholder="time · 6:30 am" onChange={(e) => onDay({ time: e.target.value })} />
            </div>
          </div>
        </header>

        <PolaroidStack
          imgs={imgs}
          day={i + 1}
          caption={day.caption}
          onCaption={(v) => onDay({ caption: v })}
          onPick={(slot) => onPick(slot)}
          busyKey={busyKey}
        />

        <section className="stepsCard">
          <div className="stepsTitle">STEPS WE DID</div>
          <div className="stepRow">
            <span className="who whoN">NIRSH</span>
            {winner === "N" && <span className="crown" aria-label="day winner">👑</span>}
            <input
              className="stepInput"
              inputMode="numeric"
              placeholder="0"
              value={day.stepsN}
              onChange={(e) => onDay({ stepsN: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div className="stepRow">
            <span className="who whoF">SHADY</span>
            {winner === "F" && <span className="crown" aria-label="day winner">👑</span>}
            <input
              className="stepInput"
              inputMode="numeric"
              placeholder="0"
              value={day.stepsF}
              onChange={(e) => onDay({ stepsF: e.target.value.replace(/[^\d]/g, "") })}
            />
          </div>
          <div className="stepTotal">
            <span>together</span>
            <strong>{total.toLocaleString()}</strong>
          </div>
        </section>

        <section className="patchRow">
          <PatchSticker
            src={imgs?.sticker}
            theme={theme}
            done={day.patchDone}
            busy={busyKey === "sticker"}
            onPick={() => onPick("sticker")}
          />
          <div className="patchText">
            <div className="patchTitle marker">today’s patch</div>
            <p className="patchNote">upload a close-up of the patch and it becomes a sticker.</p>
            <button
              className={"doneBtn" + (day.patchDone ? " isDone" : "")}
              onClick={() => onDay({ patchDone: !day.patchDone })}
            >
              {day.patchDone ? "✓ patch secured" : "mark patch collected"}
            </button>
          </div>
        </section>

        <section className="moodRow">
          <div className="moodTitle marker">how we felt</div>
          <div className="moodStamps">
            <MoodStamp label="NIRSH" value={day.moodN} tone="#FF4D2E" onChange={(v) => onDay({ moodN: v })} />
            <MoodStamp label="SHADY" value={day.moodF} tone="#F2308F" onChange={(v) => onDay({ moodF: v })} />
          </div>
        </section>

        <section className="rateRow">
          <div className="moodTitle marker">rate this mall</div>
          <div className="hearts" role="radiogroup" aria-label="Mall rating">
            {[1, 2, 3, 4, 5].map((h) => (
              <button
                key={h}
                className={"heartBtn" + ((day.rating || 0) >= h ? " on" : "")}
                style={{ "--hc": theme.c1 }}
                onClick={() => onDay({ rating: day.rating === h ? 0 : h })}
                aria-label={h + " hearts"}
              >
                ♥
              </button>
            ))}
          </div>
        </section>
        <button className="storyBtn" onClick={onShare}>📤 save for instagram story</button>
        <div className="pageFoot marker">keep going, {["habibi", "champ", "superstar", "legend", "cutie", "winner"][i]} →</div>
      </div>
    </div>
  );
}

function FinalePage({ days, imgs, totals, doneCount, onPick, busyKey, meta, onMeta, onShare }) {
  const unlocked = doneCount === 6;
  return (
    <div className="page finalePage">
      <Doodles />
      <div className="scroll">
        {!unlocked ? (
          <div className="lockedWrap">
            <div className="lockBadge">🔒</div>
            <h2 className="lockedTitle">THE GRAND FINALE</h2>
            <p className="lockedText">
              collect all <strong>6 patches</strong> to unlock your finisher certificate.
            </p>
            <div className="lockDots">
              {days.map((d, i) => (
                <span key={i} className={"lockDot" + (d.patchDone ? " on" : "")} style={{ "--c": DAY_THEMES[i].c1 }}>
                  {d.patchDone ? "✓" : i + 1}
                </span>
              ))}
            </div>
            <div className="lockedCount">{doneCount} / 6 collected</div>
          </div>
        ) : (
          <div className="certWrap">
            <div className="confetti" aria-hidden="true">
              {Array.from({ length: 26 }).map((_, i) => (
                <i key={i} style={{ "--i": i, "--c": DAY_THEMES[i % 6].c1 }} />
              ))}
            </div>
            <div className="cert">
              <div className="certStars" aria-hidden="true">★ ★ ★</div>
              <div className="certKicker">DUBAI MALLATHON ’26 · OFFICIAL FINISHERS*</div>
              <div className="certNames">NIRSH &amp; SHADY</div>
              <div className="certBody marker">
                walked, ran &amp; laughed through six malls, collected six patches, and racked up
              </div>
              <div className="certSteps">{totals.toLocaleString()} steps</div>
              {(() => {
                const best = [...days].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
                return best && best.rating > 0 ? (
                  <div className="certFav marker">favourite mall: {best.mall} {"♥".repeat(best.rating)}</div>
                ) : null;
              })()}
              <div className="certStickers">
                {days.map((d, i) => (
                  <span key={i} className="miniSticker" style={{ "--c": DAY_THEMES[i].c1 }}>
                    {imgs["d" + (i + 1)]?.sticker ? <img src={imgs["d" + (i + 1)].sticker} alt="" /> : i + 1}
                  </span>
                ))}
              </div>
              <Polaroid
                src={imgs.final?.merch}
                label="us + the merch we won 🏆"
                captionEditable={false}
                rot={2}
                busy={busyKey === "merch"}
                onPick={() => onPick("merch")}
              />
              <div className="certSign">
                <div><span className="marker sig">Nirsh</span><small>runner nº 1</small></div>
                <div><span className="marker sig">Shady</span><small>runner nº 2</small></div>
              </div>
              <input
                className="certDate chip"
                value={meta.certDate || ""}
                placeholder="finished on · __ Aug 2026"
                onChange={(e) => onMeta({ certDate: e.target.value })}
              />
              <div className="certFoot marker">*certified by us, for us. screenshot me &amp; keep me forever 💛</div>
            </div>
            <button className="storyBtn" onClick={onShare}>📤 share our finish to a story</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- root ---------- */

export default function App() {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [meta, setMeta] = useState({ certDate: "", loveNote: DEFAULT_NOTE, noteOpened: false });
  const [imgs, setImgs] = useState({}); // { d1:{memory,patch,sticker}, ... final:{merch} }
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(null); // "d3:sticker"
  const [toast, setToast] = useState("");
  const [ghConf, setGhConf] = useState(undefined); // undefined=checking, null=needs setup, {}=configured
  const [showSetup, setShowSetup] = useState(false);

  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const xRef = useRef(0);
  const stopSpring = useRef(null);
  const fileRef = useRef(null);
  const pickCb = useRef(null);
  const lastData = useRef("");
  const toastTimer = useRef(null);
  const N_PAGES = 8;

  const isViewer = !!(ghConf && ghConf.mode === "github" && ghConf.role === "viewer");
  const isGithub = !!(ghConf && ghConf.mode === "github");

  const flash = useCallback((msg, ms = 1600) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);

  /* ----- load everything (progressively, only applying real changes) ----- */
  const fetchImages = useCallback(() => {
    ["d1", "d2", "d3", "d4", "d5", "d6", "final"].forEach(async (k) => {
      const v = await sGet("mallathon:img:" + k);
      if (v) setImgs((cur) => (JSON.stringify(cur[k]) === JSON.stringify(v) ? cur : { ...cur, [k]: v }));
    });
  }, []);

  const loadAll = useCallback(async (announce) => {
    const data = await sGet("mallathon:data");
    const str = data ? JSON.stringify(data) : "";
    const changed = data && str !== lastData.current;
    if (changed) {
      lastData.current = str;
      if (data.days) setDays((cur) => cur.map((d, i) => ({ ...d, ...(data.days[i] || {}) })));
      if (data.meta) setMeta((m) => ({ ...m, ...data.meta }));
    }
    setLoaded(true);
    if (changed || !Object.keys(imgs).length) fetchImages();
    if (announce) flash(changed ? "new updates from nirsh ✨" : "you're all caught up 💛");
  }, [fetchImages, flash, imgs]);

  // boot: figure out where data lives, then load
  useEffect(() => {
    (async () => {
      if (HAS_CLOUD) {
        setGhConf({ mode: "cloud" });
        loadAll();
        return;
      }
      const conf = await loadGhConf();
      setGhConf(conf);
      if (conf) loadAll();
      else setLoaded(true); // show setup instead
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shady's phone: quietly check for updates every 90 seconds
  useEffect(() => {
    if (!isViewer) return;
    const id = setInterval(() => loadAll(false), 90000);
    return () => clearInterval(id);
  }, [isViewer, loadAll]);

  const finishSetup = async (conf) => {
    await saveGhConf(conf);
    setGhConf(conf);
    setShowSetup(false);
    lastData.current = "";
    loadAll();
    if (conf.mode === "github") flash(conf.role === "viewer" ? "connected — enjoy the show 👀" : "vault connected — everything auto-saves ✓");
  };

  /* ----- save data (debounced) ----- */
  const saveData = useMemo(
    () =>
      debounce(async (d, m) => {
        lastData.current = JSON.stringify({ days: d, meta: m });
        const ok = await sSet("mallathon:data", { days: d, meta: m });
        setToast(ok ? "saved ✓" : "offline — kept on this phone, will need a resave");
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 1400);
      }, 900),
    []
  );

  const patchDay = (i, patch) => {
    if (isViewer) { flash("view-only — nirsh fills this in 💌"); return; }
    setDays((cur) => {
      const next = cur.map((d, j) => (j === i ? { ...d, ...patch } : d));
      saveData(next, meta);
      return next;
    });
  };
  const patchMeta = (patch) => {
    if (isViewer) {
      // she can still break the seal on the letter — it opens on her phone
      if ("noteOpened" in patch) setMeta((m) => ({ ...m, ...patch }));
      else flash("view-only — nirsh fills this in 💌");
      return;
    }
    setMeta((m) => {
      const next = { ...m, ...patch };
      saveData(days, next);
      return next;
    });
  };

  /* ----- backup & restore (a single .json file with everything) ----- */
  const backupRef = useRef(null);
  const exportAll = () => {
    try {
      const dump = { app: "our-mallathon", v: 1, data: { days, meta }, imgs };
      const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "our-mallathon-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setToast("backup downloaded ✓");
      setTimeout(() => setToast(""), 1600);
    } catch {
      setToast("backup failed — try again");
      setTimeout(() => setToast(""), 1600);
    }
  };
  const onBackupFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || isViewer) return;
    try {
      const dump = JSON.parse(await file.text());
      if (dump.app !== "our-mallathon") throw new Error("wrong file");
      const d = (dump.data && dump.data.days) || [];
      const m = (dump.data && dump.data.meta) || {};
      setDays((cur) => cur.map((day, i) => ({ ...day, ...(d[i] || {}) })));
      setMeta((cur) => ({ ...cur, ...m }));
      const im = dump.imgs || {};
      setImgs(im);
      await sSet("mallathon:data", { days: d, meta: m });
      for (const k of Object.keys(im)) await sSet("mallathon:img:" + k, im[k]);
      setToast("scrapbook restored ✓");
      setTimeout(() => setToast(""), 1600);
    } catch {
      setToast("that's not a mallathon backup file");
      setTimeout(() => setToast(""), 1800);
    }
  };

  /* ----- instagram story ----- */
  const shareStory = async (which) => {
    try {
      flash("designing your story… 🎨", 5000);
      let blob;
      if (which === "final") {
        const photo =
          (imgs.final && imgs.final.merch) ||
          (imgs.d6 && imgs.d6.memory) || (imgs.d5 && imgs.d5.memory) ||
          (imgs.d4 && imgs.d4.memory) || (imgs.d3 && imgs.d3.memory) ||
          (imgs.d2 && imgs.d2.memory) || (imgs.d1 && imgs.d1.memory);
        if (!photo) { flash("add a photo first 📸"); return; }
        const total = days.reduce((s, d) => s + fmt(d.stepsN) + fmt(d.stepsF), 0);
        const minis = await Promise.all(
          DAY_THEMES.map(async (t, i) => {
            const bd = imgs["d" + (i + 1)] || {};
            const src = bd.sticker || bd.patch;
            let img = null;
            try { if (src) img = await loadImg(src); } catch {}
            return { img, color: t.c1 };
          })
        );
        blob = await buildStory({
          photoSrc: photo,
          minis,
          c1: "#FFB300", c2: "#FF4D2E",
          kicker: "DUBAI MALLATHON ’26",
          big: "WE DID IT!",
          sub: "6 MALLS · 6 PATCHES · ONE US",
          dateLine: meta.certDate || "",
          caption: "official finishers 🏆",
          steps: total ? total.toLocaleString() : "",
          stepsLabel: "STEPS TOGETHER",
          footer: "nirsh ♥ shady",
        });
      } else {
        const i = which;
        const d = days[i];
        const b = imgs["d" + (i + 1)] || {};
        if (!b.memory) { flash("add today's polaroid first 📸"); return; }
        const total = fmt(d.stepsN) + fmt(d.stepsF);
        blob = await buildStory({
          photoSrc: b.memory,
          stickerSrc: b.patch || b.sticker,
          c1: DAY_THEMES[i].c1, c2: DAY_THEMES[i].c2,
          kicker: "OUR MALLATHON ’26",
          big: "DAY " + String(i + 1).padStart(2, "0"),
          sub: (d.mall || "").toUpperCase(),
          dateLine: [d.date, d.time].filter(Boolean).join(" · "),
          caption: d.caption || "us, day " + (i + 1),
          steps: total ? total.toLocaleString() : "",
          stepsLabel: "STEPS TOGETHER",
          footer: "nirsh ♥ shady",
        });
      }
      if (!blob) { flash("couldn't build the story — try again"); return; }
      const file = new File([blob], "our-mallathon-story.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          flash("pick instagram → add to story ✨", 2400);
          return;
        } catch (err) {
          if (err && err.name === "AbortError") { setToast(""); return; }
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = "our-mallathon-story.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash("story saved — add it to your story from the gallery 📲", 2800);
    } catch {
      flash("couldn't build the story — try again");
    }
  };

  /* ----- photo picking ----- */
  const pickImage = (bundleKey, slot) => {
    if (isViewer) { flash("view-only — nirsh adds the photos 📸"); return; }
    pickCb.current = { bundleKey, slot };
    fileRef.current && fileRef.current.click();
  };
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || !pickCb.current) return;
    const { bundleKey, slot } = pickCb.current;
    setBusy(bundleKey + ":" + slot);
    try {
      const url = await fileToDataUrl(file, slot === "sticker" ? 700 : 1100);
      setImgs((cur) => {
        const bundle = { ...(cur[bundleKey] || {}), [slot]: url };
        sSet("mallathon:img:" + bundleKey, bundle).then((ok) => {
          setToast(ok ? "photo saved ✓" : "saved on this device");
          setTimeout(() => setToast(""), 1500);
        });
        return { ...cur, [bundleKey]: bundle };
      });
      if (slot === "sticker") {
        const idx = parseInt(bundleKey.slice(1), 10) - 1;
        if (!isNaN(idx)) patchDay(idx, { patchDone: true });
      }
    } catch {
      setToast("hmm, couldn’t read that photo");
      setTimeout(() => setToast(""), 1800);
    }
    setBusy(null);
  };

  /* ----- pager: 1:1 drag, velocity handoff, rubber-band ----- */
  const applyX = useCallback((x) => {
    xRef.current = x;
    const W = wrapRef.current ? wrapRef.current.clientWidth : 1;
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${x}px,0,0)`;
    // continuous gradient blend as you slide
    const p = Math.min(Math.max(-x / W, 0), N_PAGES - 1);
    const i = Math.floor(p), f = p - i;
    const a = PAGE_COLORS[i], b = PAGE_COLORS[Math.min(i + 1, N_PAGES - 1)];
    if (wrapRef.current) {
      wrapRef.current.style.background = `linear-gradient(165deg, ${hexBlend(a[0], b[0], f)} 0%, ${hexBlend(a[1], b[1], f)} 100%)`;
    }
    const rounded = Math.round(p);
    setPage((cur) => (cur === rounded ? cur : rounded));
  }, []);

  const goTo = useCallback(
    (idx, velocity = 0) => {
      const W = wrapRef.current ? wrapRef.current.clientWidth : 1;
      const target = -Math.min(Math.max(idx, 0), N_PAGES - 1) * W;
      if (stopSpring.current) stopSpring.current();
      const flick = Math.abs(velocity) > 350;
      stopSpring.current = springTo({
        from: xRef.current,
        to: target,
        velocity,
        damping: flick ? 0.85 : 1,
        response: 0.4,
        onUpdate: applyX,
      });
    },
    [applyX]
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    applyX(0);
    let startX = 0, startY = 0, baseX = 0, dragging = false, committed = false;
    let hist = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const down = (e) => {
      if (e.target.closest("input, button, textarea, a")) return;
      if (stopSpring.current) stopSpring.current(); // interruptible: grab mid-flight
      dragging = true;
      committed = false;
      startX = e.clientX;
      startY = e.clientY;
      baseX = xRef.current;
      hist = [{ t: performance.now(), x: e.clientX }];
      wrap.setPointerCapture && wrap.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!committed) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; } // vertical scroll wins
        committed = true;
      }
      const W = wrap.clientWidth;
      let x = baseX + dx;
      const min = -(N_PAGES - 1) * W, max = 0;
      if (x > max) x = max + rubberband(x - max, W);
      if (x < min) x = min + rubberband(x - min, W);
      applyX(x);
      hist.push({ t: performance.now(), x: e.clientX });
      if (hist.length > 6) hist.shift();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (!committed) return;
      const W = wrap.clientWidth;
      let v = 0;
      if (hist.length > 1) {
        const a = hist[0], b = hist[hist.length - 1];
        if (b.t > a.t) v = ((b.x - a.x) / (b.t - a.t)) * 1000;
      }
      if (reduced) { goTo(Math.round(-xRef.current / W), 0); return; }
      const projected = xRef.current + project(v);
      goTo(Math.round(-projected / W), v);
    };
    const cancel = () => { if (dragging) { dragging = false; goTo(Math.round(-xRef.current / (wrap.clientWidth || 1)), 0); } };
    const resize = () => { applyX(-Math.round(-xRef.current / (wrap.clientWidth || 1)) * wrap.clientWidth); };

    wrap.addEventListener("pointerdown", down);
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", cancel);
    window.addEventListener("resize", resize);
    return () => {
      wrap.removeEventListener("pointerdown", down);
      wrap.removeEventListener("pointermove", move);
      wrap.removeEventListener("pointerup", up);
      wrap.removeEventListener("pointercancel", cancel);
      window.removeEventListener("resize", resize);
    };
  }, [applyX, goTo]);

  const totals = days.reduce((s, d) => s + fmt(d.stepsN) + fmt(d.stepsF), 0);
  const doneCount = days.filter((d) => d.patchDone).length;

  return (
    <div className="appWrap" ref={wrapRef}>
      <style>{CSS}</style>
      <div className="grain" aria-hidden="true" />

      {/* top bar */}
      <div className="topBar">
        <div className="brandChip">OUR MALLATHON ’26</div>
        <div className="topRight">
          {isViewer && <div className="patchChip viewerChip">👀</div>}
          <div className="patchChip">🏅 {doneCount}/6</div>
          {(HAS_CLOUD || isGithub) && (
            <button className="syncBtn" title="check for updates" onClick={() => loadAll(true)}>↻</button>
          )}
          {!HAS_CLOUD && (
            <button className="syncBtn" title="settings" onClick={() => setShowSetup(true)}>⚙</button>
          )}
        </div>
      </div>

      {/* sliding album */}
      <div className="track" ref={trackRef}>
        <CoverPage
          totals={totals}
          doneCount={doneCount}
          meta={meta}
          onMeta={patchMeta}
          onExport={exportAll}
          onImport={() => backupRef.current && backupRef.current.click()}
          showRestore={!isViewer}
          status={
            HAS_CLOUD
              ? "synced through this chat link"
              : isGithub
                ? isViewer
                  ? "view-only · updates appear here automatically 👀"
                  : "auto-saved to your github vault — nothing to push ✓"
                : "saved on this device — backup now & then 💾"
          }
        />
        {days.map((d, i) => (
          <DayPage
            key={i}
            i={i}
            day={d}
            theme={DAY_THEMES[i]}
            imgs={imgs["d" + (i + 1)]}
            busyKey={busy && busy.startsWith("d" + (i + 1) + ":") ? busy.split(":")[1] : null}
            onDay={(p) => patchDay(i, p)}
            onPick={(slot) => pickImage("d" + (i + 1), slot)}
            onShare={() => shareStory(i)}
          />
        ))}
        <FinalePage
          days={days}
          imgs={imgs}
          totals={totals}
          doneCount={doneCount}
          meta={meta}
          onMeta={patchMeta}
          busyKey={busy === "final:merch" ? "merch" : null}
          onPick={() => pickImage("final", "merch")}
          onShare={() => shareStory("final")}
        />
      </div>

      {/* dots */}
      <nav className="dots" aria-label="Album pages">
        <button className={"dot cover" + (page === 0 ? " on" : "")} onClick={() => goTo(0)} aria-label="Cover">♥</button>
        {DAY_THEMES.map((t, i) => (
          <button
            key={i}
            className={"dot" + (page === i + 1 ? " on" : "")}
            style={{ "--c": t.c1 }}
            onClick={() => goTo(i + 1)}
            aria-label={"Day " + (i + 1)}
          />
        ))}
        <button className={"dot star" + (page === 7 ? " on" : "")} onClick={() => goTo(7)} aria-label="Finale">★</button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
      {!loaded && <div className="loading marker">opening our scrapbook…</div>}
      {loaded && !HAS_CLOUD && (ghConf === null || showSetup) && (
        <SetupScreen
          initial={ghConf}
          onDone={finishSetup}
          onClose={ghConf ? () => setShowSetup(false) : null}
        />
      )}
      <input type="file" accept="image/*" hidden ref={fileRef} onChange={onFile} />
      <input type="file" accept=".json,application/json" hidden ref={backupRef} onChange={onBackupFile} />
    </div>
  );
}

/* ============================ CSS ============================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800;900&family=Permanent+Marker&display=swap');

:root {
  --paper: #F7F0E1;
  --ink: #17120E;
  --ui: "SF Pro Display","SF Pro Text",-apple-system,"Samsung Sharp Sans","SamsungOne","Inter",system-ui,sans-serif;
  --display: "Anton","Arial Narrow Bold",var(--ui);
  --hand: "Permanent Marker",cursive;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body, #root { height: 100%; margin: 0; }
body { overscroll-behavior: none; }

.appWrap {
  position: fixed; inset: 0; overflow: hidden;
  font-family: var(--ui); color: var(--ink);
  background: linear-gradient(165deg,#FF4D2E,#7A3FF2);
  touch-action: pan-y;
  user-select: none;
  transition: none;
}
.appWrap input, .appWrap textarea { user-select: text; }

.grain {
  position: absolute; inset: -50%; pointer-events: none; z-index: 5; opacity: .07;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E");
  animation: grainShift 0.7s steps(3) infinite;
}
@keyframes grainShift { 0%{transform:translate(0,0)} 33%{transform:translate(-6px,4px)} 66%{transform:translate(5px,-5px)} 100%{transform:translate(0,0)} }

/* ---- top bar ---- */
.topBar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 30;
  display: flex; justify-content: space-between; align-items: center;
  padding: calc(10px + env(safe-area-inset-top)) 14px 8px;
  pointer-events: none;
}
.topBar > * { pointer-events: auto; }
.brandChip {
  font-family: var(--display); font-size: 14px; letter-spacing: .06em;
  background: var(--ink); color: var(--paper); padding: 7px 12px 6px;
  border-radius: 999px; transform: rotate(-1.5deg);
  box-shadow: 3px 3px 0 rgba(0,0,0,.25);
}
.topRight { display: flex; gap: 8px; align-items: center; }
.patchChip {
  background: var(--paper); border: 2px solid var(--ink); border-radius: 999px;
  font-weight: 800; font-size: 13px; padding: 5px 10px; box-shadow: 2px 2px 0 var(--ink);
}
.syncBtn {
  width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--ink);
  background: var(--paper); font-size: 16px; font-weight: 800; cursor: pointer;
  box-shadow: 2px 2px 0 var(--ink); transition: transform .1s ease-out;
}
.syncBtn:active { transform: scale(.92) rotate(40deg); }

/* ---- pager ---- */
.track { display: flex; height: 100%; will-change: transform; }
.page {
  flex: 0 0 100%; height: 100%; position: relative; overflow: hidden;
}
.scroll {
  height: 100%; overflow-y: auto; overscroll-behavior: contain;
  padding: calc(64px + env(safe-area-inset-top)) 18px calc(86px + env(safe-area-inset-bottom));
  max-width: 480px; margin: 0 auto;
}

/* ---- doodles ---- */
.doodles { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.stopmo { position: absolute; filter: drop-shadow(2px 3px 0 rgba(0,0,0,.15)); }
.s1 { animation: jit1 .9s steps(2) infinite; }
.s2 { animation: jit2 1.1s steps(2) infinite; }
.s3 { animation: jit1 1.3s steps(2) infinite reverse; }
.s4 { animation: jit2 .8s steps(2) infinite; }
.s5 { animation: jit1 1s steps(2) infinite; }
@keyframes jit1 { 0%{transform:rotate(-3deg) translate(0,0)} 100%{transform:rotate(4deg) translate(2px,-3px)} }
@keyframes jit2 { 0%{transform:rotate(5deg) translate(0,0)} 100%{transform:rotate(-4deg) translate(-3px,2px)} }

/* ---- cover ---- */
.coverPage { display: flex; align-items: center; justify-content: center; }
.coverInner { text-align: center; padding: 24px; max-width: 440px; z-index: 1; }
.eyebrow { color: rgba(255,255,255,.95); font-size: 18px; transform: rotate(-2deg); text-shadow: 2px 2px 0 rgba(0,0,0,.2); }
.mega {
  font-family: var(--display); color: var(--paper); margin: 8px 0 0;
  font-size: clamp(52px, 15vw, 96px); line-height: .92; letter-spacing: -0.015em;
  text-shadow: 4px 5px 0 var(--ink);
}
.heart { color: #FFDD33; display: inline-block; margin: 0 .06em; animation: beat 1s steps(2) infinite; }
@keyframes beat { 0%{transform:scale(1) rotate(-6deg)} 100%{transform:scale(1.14) rotate(6deg)} }
.subMega {
  font-family: var(--display); color: var(--ink); background: #FFDD33;
  display: inline-block; padding: 6px 14px 4px; margin-top: 14px; font-size: clamp(16px,4.6vw,24px);
  transform: rotate(1.5deg); box-shadow: 3px 3px 0 var(--ink); letter-spacing: .04em;
}
.tagline { color: rgba(255,255,255,.95); font-weight: 800; margin-top: 12px; letter-spacing: .16em; text-transform: uppercase; font-size: 12px; }
.coverStats { display: flex; gap: 12px; justify-content: center; margin-top: 26px; }
.statCard {
  background: var(--paper); border: 3px solid var(--ink); border-radius: 16px;
  padding: 14px 16px; min-width: 128px; box-shadow: 4px 4px 0 var(--ink);
  transform: rotate(-1deg);
}
.statCard + .statCard { transform: rotate(1.4deg); }
.statNum { font-family: var(--display); font-size: 30px; line-height: 1; letter-spacing: -0.01em; }
.of { font-size: 18px; opacity: .55; }
.statLabel { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-top: 5px; opacity: .75; }
.swipeHint { margin-top: 30px; color: #fff; font-weight: 800; font-size: 14px; }
.arrowAnim { display: inline-block; animation: nudge 1s steps(2) infinite; }
@keyframes nudge { 0%{transform:translateX(0)} 100%{transform:translateX(7px)} }

/* ---- day pages ---- */
.dayHead { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; z-index: 1; position: relative; }
.dayNum {
  font-family: var(--display); font-size: 64px; line-height: .9; color: var(--paper);
  text-shadow: 3px 4px 0 var(--ink); transform: rotate(-4deg); flex: 0 0 auto;
}
.dayHeadText { flex: 1; min-width: 0; }
.dayKicker { color: #fff; font-size: 15px; text-shadow: 1px 2px 0 rgba(0,0,0,.25); transform: rotate(-1deg); }
.mallName {
  width: 100%; border: none; background: transparent; padding: 0;
  font-family: var(--display); font-size: clamp(26px, 7.6vw, 36px); line-height: 1;
  letter-spacing: -0.01em; color: var(--paper); text-transform: uppercase;
  text-shadow: 3px 3px 0 var(--ink); outline: none;
}
.mallName:focus { border-bottom: 3px dashed rgba(255,255,255,.7); }
.chips { display: flex; gap: 8px; margin-top: 8px; }
.chip {
  border: 2px solid var(--ink); background: var(--paper); border-radius: 999px;
  padding: 5px 11px; font-family: var(--ui); font-weight: 700; font-size: 12px;
  width: 50%; min-width: 0; outline: none; box-shadow: 2px 2px 0 var(--ink);
}
.chip:focus { background: #fff; }
.chip::placeholder { color: rgba(23,18,14,.4); }

/* ---- polaroid stack ---- */
.stackWrap { position: relative; z-index: 1; margin: 10px 0 6px; }
.stack { position: relative; height: min(112vw, 470px); }
.stackCard { position: absolute; inset: 0; display: flex; justify-content: center; }
.stackCard.front { z-index: 2; }
.stackCard.back { z-index: 1; transform: translate(10px, 10px) scale(.97); filter: brightness(.94); }
.stackCard.goingBack { animation: goBack .48s cubic-bezier(.3,1.2,.4,1) forwards; }
.stackCard.comingFront { animation: comeFront .48s cubic-bezier(.3,1.2,.4,1) forwards; }
@keyframes goBack {
  0% { transform: translate(0,0) scale(1); }
  50% { transform: translate(66%, -4%) rotate(9deg) scale(.98); }
  100% { transform: translate(10px,10px) scale(.97); }
}
@keyframes comeFront {
  0% { transform: translate(10px,10px) scale(.97); }
  50% { transform: translate(-56%, 3%) rotate(-7deg) scale(.99); }
  100% { transform: translate(0,0) scale(1); }
}

.polaroid {
  margin: 0; width: min(78vw, 330px); position: relative;
  background:
    linear-gradient(155deg, #ffffff 0%, #fbf8f0 55%, #f2ecdd 100%);
  padding: 12px 12px 0; border-radius: 4px;
  transform: rotate(var(--rot));
  box-shadow:
    0 1px 2px rgba(0,0,0,.2),
    0 10px 24px rgba(0,0,0,.28),
    0 24px 48px rgba(0,0,0,.22),
    inset 0 0 0 1px rgba(0,0,0,.05);
}
.polaroid::after {
  content: ""; position: absolute; inset: 0; border-radius: 4px; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23p)'/%3E%3C/svg%3E");
  opacity: .05; mix-blend-mode: multiply;
}
.photoArea {
  display: block; width: 100%; aspect-ratio: 1/1.02; border: none; padding: 0;
  background: #1c1712; position: relative; overflow: hidden; cursor: pointer;
  box-shadow: inset 0 0 14px rgba(0,0,0,.55), inset 0 0 2px rgba(0,0,0,.8);
}
.photoArea img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(1.08) contrast(1.04); }
.gloss {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(115deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(255,255,255,.1) 100%);
}
.emptyPhoto {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;
  align-items: center; justify-content: center; color: rgba(255,255,255,.75);
  font-weight: 700; font-size: 13px; border: 2px dashed rgba(255,255,255,.35); margin: 10px;
}
.emptyIcon { font-size: 26px; }
.spin {
  position: absolute; top: 8px; right: 8px; width: 18px; height: 18px;
  border: 3px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.polaroid figcaption { padding: 10px 4px 14px; min-height: 46px; display:flex; align-items:center; justify-content:center; }
.marker { font-family: var(--hand); }
.capInput {
  width: 100%; border: none; background: transparent; outline: none; text-align: center;
  font-family: var(--hand); font-size: 19px; color: #2b2118;
}
.capInput::placeholder { color: rgba(43,33,24,.35); }
.polaroid figcaption .marker { font-size: 19px; color: #2b2118; }

.tape {
  position: absolute; width: 92px; height: 26px; z-index: 3;
  box-shadow: 0 2px 4px rgba(0,0,0,.18); opacity: .92;
  clip-path: polygon(2% 8%, 98% 0%, 100% 88%, 4% 100%);
}
.swapBtn {
  display: block; margin: 14px auto 0; border: 2px solid var(--ink); background: var(--paper);
  font-weight: 800; font-size: 13px; padding: 8px 16px; border-radius: 999px; cursor: pointer;
  box-shadow: 3px 3px 0 var(--ink); transition: transform .1s ease-out;
}
.swapBtn:active { transform: scale(.94); }

/* ---- steps card ---- */
.stepsCard {
  position: relative; z-index: 1; background: var(--paper); border: 3px solid var(--ink);
  border-radius: 18px; padding: 14px 16px; margin-top: 20px;
  box-shadow: 5px 5px 0 var(--ink); transform: rotate(-.6deg);
}
.stepsTitle { font-family: var(--display); font-size: 18px; letter-spacing: .05em; margin-bottom: 8px; }
.stepRow { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 2px dashed rgba(23,18,14,.18); }
.who {
  font-family: var(--display); font-size: 14px; letter-spacing: .04em; color: #fff;
  padding: 4px 10px 3px; border-radius: 999px; flex: 0 0 auto; box-shadow: 2px 2px 0 var(--ink);
}
.whoN { background: #FF4D2E; transform: rotate(-2deg); }
.whoF { background: #F2308F; transform: rotate(2deg); }
.stepInput {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none; text-align: right;
  font-family: var(--display); font-size: 30px; letter-spacing: .01em; color: var(--ink);
}
.stepInput::placeholder { color: rgba(23,18,14,.25); }
.stepTotal {
  display: flex; justify-content: space-between; align-items: baseline; margin-top: 8px;
  border-top: 3px solid var(--ink); padding-top: 8px;
}
.stepTotal span { font-weight: 800; text-transform: uppercase; font-size: 11px; letter-spacing: .14em; }
.stepTotal strong { font-family: var(--display); font-size: 26px; }

/* ---- patch sticker ---- */
.patchRow { position: relative; z-index: 1; display: flex; gap: 16px; align-items: center; margin-top: 22px; }
.sticker {
  flex: 0 0 auto; width: 118px; height: 118px; border-radius: 50%; border: none; padding: 0;
  background: rgba(255,255,255,.25); cursor: pointer; position: relative;
  box-shadow: 0 0 0 6px #fff, 0 0 0 9px var(--ring), 0 10px 20px rgba(0,0,0,.3);
  overflow: hidden; transition: transform .12s ease-out;
}
.sticker:active { transform: scale(.93) rotate(-4deg); }
.sticker img { width: 100%; height: 100%; object-fit: cover; }
.sticker.stuck { animation: slap .5s cubic-bezier(.2,1.6,.4,1); }
@keyframes slap { 0%{transform:scale(1.7) rotate(14deg); opacity:0} 60%{transform:scale(.92) rotate(-4deg); opacity:1} 100%{transform:scale(1) rotate(0)} }
.stickerEmpty {
  position: absolute; inset: 10px; border-radius: 50%; border: 3px dashed rgba(255,255,255,.8);
  display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 800; font-size: 12px;
}
.stickerCheck {
  position: absolute; bottom: 6px; right: 6px; width: 26px; height: 26px; border-radius: 50%;
  background: #17c964; color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,.3); font-size: 14px;
}
.patchText { flex: 1; min-width: 0; }
.patchTitle { color: #fff; font-size: 20px; text-shadow: 2px 2px 0 rgba(0,0,0,.25); transform: rotate(-1.5deg); }
.patchNote { color: rgba(255,255,255,.92); font-size: 13px; font-weight: 600; margin: 6px 0 10px; line-height: 1.45; }
.doneBtn {
  border: 2px solid var(--ink); background: var(--paper); font-weight: 800; font-size: 12px;
  padding: 8px 12px; border-radius: 999px; cursor: pointer; box-shadow: 3px 3px 0 var(--ink);
  transition: transform .1s ease-out;
}
.doneBtn:active { transform: scale(.94); }
.doneBtn.isDone { background: #17c964; color: #fff; border-color: var(--ink); }
.pageFoot { color: rgba(255,255,255,.95); text-align: center; margin-top: 26px; font-size: 18px; text-shadow: 2px 2px 0 rgba(0,0,0,.2); transform: rotate(-1deg); }

/* ---- finale ---- */
.finalePage .scroll { display: flex; flex-direction: column; }
.lockedWrap { margin: auto; text-align: center; color: #fff; z-index: 1; position: relative; }
.lockBadge { font-size: 46px; animation: jit1 1s steps(2) infinite; display:inline-block; }
.lockedTitle { font-family: var(--display); font-size: 40px; margin: 10px 0 6px; text-shadow: 3px 4px 0 var(--ink); letter-spacing: .01em; }
.lockedText { font-weight: 700; opacity: .95; }
.lockDots { display: flex; gap: 8px; justify-content: center; margin: 18px 0 10px; }
.lockDot {
  width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.25); border: 2px dashed rgba(255,255,255,.7); color: #fff; font-weight: 900;
}
.lockDot.on { background: var(--c); border: 3px solid #fff; box-shadow: 0 4px 10px rgba(0,0,0,.25); }
.lockedCount { font-weight: 800; letter-spacing: .1em; font-size: 13px; }

.certWrap { position: relative; z-index: 1; }
.cert {
  background: var(--paper); border: 4px solid var(--ink); border-radius: 8px;
  box-shadow: 0 0 0 6px #FFDD33, 0 0 0 10px var(--ink), 8px 12px 0 rgba(0,0,0,.3);
  padding: 22px 18px; text-align: center; position: relative; margin: 8px 4px 20px;
}
.cert::before {
  content: ""; position: absolute; inset: 8px; border: 2px dashed rgba(23,18,14,.35); border-radius: 4px; pointer-events: none;
}
.certStars { color: #E8A100; letter-spacing: .6em; font-size: 14px; }
.certKicker { font-weight: 900; font-size: 10px; letter-spacing: .18em; margin-top: 8px; }
.certNames { font-family: var(--display); font-size: clamp(34px, 10vw, 46px); line-height: 1; margin: 10px 0 8px; letter-spacing: -0.01em; }
.certBody { font-size: 17px; color: #4a3c2e; }
.certSteps { font-family: var(--display); font-size: clamp(28px, 8vw, 38px); margin: 8px 0 12px; color: #FF4D2E; text-shadow: 2px 2px 0 var(--ink); }
.certStickers { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px; }
.miniSticker {
  width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: var(--c);
  color: #fff; font-weight: 900; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 3px #fff, 0 0 0 4px rgba(0,0,0,.25); transform: rotate(-4deg);
}
.miniSticker:nth-child(even) { transform: rotate(5deg); }
.miniSticker img { width: 100%; height: 100%; object-fit: cover; }
.certWrap .polaroid { margin: 0 auto; width: min(64vw, 260px); }
.certWrap .stackWrap { margin: 0; }
.certSign { display: flex; justify-content: space-around; margin-top: 20px; }
.certSign > div { display: flex; flex-direction: column; gap: 2px; }
.sig { font-size: 26px; border-bottom: 2px solid var(--ink); padding: 0 14px 2px; transform: rotate(-2deg); }
.certSign small { font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; opacity: .6; }
.certDate { margin-top: 16px; width: auto; text-align: center; }
.certFoot { margin-top: 14px; font-size: 15px; color: #7a6a55; transform: rotate(-1deg); }

.confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.confetti i {
  position: absolute; top: -20px; left: calc(var(--i) * 3.9%);
  width: 9px; height: 14px; background: var(--c);
  animation: fall 2.6s cubic-bezier(.2,.6,.4,1) forwards;
  animation-delay: calc(var(--i) * 60ms);
  transform: rotate(calc(var(--i) * 47deg));
}
@keyframes fall { to { transform: translateY(110vh) rotate(720deg); opacity: .6; } }

/* ---- dots nav ---- */
.dots {
  position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(14px + env(safe-area-inset-bottom)); z-index: 30;
  display: flex; gap: 8px; align-items: center;
  background: rgba(23,18,14,.82); backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255,255,255,.22);
  padding: 8px 12px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
.dot {
  width: 14px; height: 14px; border-radius: 50%; border: none; padding: 0; cursor: pointer;
  background: var(--c, #fff); opacity: .45; transition: transform .18s cubic-bezier(.2,1.4,.4,1), opacity .18s;
  color: transparent; font-size: 11px; line-height: 1;
}
.dot.cover, .dot.star { background: transparent; color: #fff; width: auto; height: auto; font-size: 14px; }
.dot.on { opacity: 1; transform: scale(1.55); }
.dot.cover.on, .dot.star.on { transform: scale(1.3); color: #FFDD33; }

/* ---- toast / loading ---- */
.toast {
  position: absolute; top: calc(58px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  background: var(--ink); color: var(--paper); font-weight: 800; font-size: 12px;
  padding: 7px 14px; border-radius: 999px; z-index: 40; box-shadow: 0 6px 16px rgba(0,0,0,.3);
  animation: toastIn .25s cubic-bezier(.2,1.4,.4,1);
}
@keyframes toastIn { from { transform: translate(-50%, -8px); opacity: 0; } }
.loading {
  position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(165deg,#FF4D2E,#7A3FF2); color: #fff; font-size: 26px;
}

/* ---- site link & backup ---- */
.siteLink {
  display: inline-block; margin-top: 22px; color: #fff; font-weight: 800; font-size: 13px;
  text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 2px;
  text-decoration-color: #FFDD33;
}
.backupRow { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }
.tinyBtn {
  border: 2px solid rgba(255,255,255,.8); background: rgba(255,255,255,.14); color: #fff;
  font-weight: 800; font-size: 12px; padding: 6px 12px; border-radius: 999px; cursor: pointer;
  backdrop-filter: blur(6px); transition: transform .1s ease-out;
}
.tinyBtn:active { transform: scale(.93); }
.saveNote { margin-top: 8px; color: rgba(255,255,255,.75); font-weight: 700; font-size: 11px; letter-spacing: .04em; }

/* ---- story button ---- */
.storyBtn {
  position: relative; z-index: 1; display: block; width: 100%; margin-top: 22px;
  border: 3px solid var(--ink); background: #FFDD33; color: var(--ink);
  font-family: var(--display); font-size: 17px; letter-spacing: .04em;
  padding: 15px; border-radius: 16px; cursor: pointer;
  box-shadow: 5px 5px 0 var(--ink); transition: transform .1s ease-out;
  transform: rotate(-.5deg);
}
.storyBtn:active { transform: rotate(-.5deg) scale(.95); }
.finalePage .storyBtn { max-width: 380px; margin-left: auto; margin-right: auto; }

/* ---- setup screen ---- */
.setup {
  position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(165deg,#FF4D2E,#7A3FF2); padding: 20px;
}
.setupCard {
  position: relative; width: 100%; max-width: 380px; background: var(--paper);
  border: 3px solid var(--ink); border-radius: 20px; box-shadow: 6px 7px 0 var(--ink);
  padding: 22px 20px; transform: rotate(-.8deg); max-height: 86vh; overflow-y: auto;
}
.setupClose {
  position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid var(--ink); background: #fff; font-weight: 900; cursor: pointer; box-shadow: 2px 2px 0 var(--ink);
}
.setupKicker { font-size: 18px; color: #C21836; transform: rotate(-1.5deg); }
.setupTitle { font-family: var(--display); font-size: 26px; margin: 6px 0 16px; letter-spacing: .01em; }
.roleBtns { display: flex; flex-direction: column; gap: 12px; }
.roleBtn {
  border: 3px solid var(--ink); background: #fff; border-radius: 16px; padding: 14px;
  cursor: pointer; text-align: left; box-shadow: 4px 4px 0 var(--ink); transition: transform .1s ease-out;
  display: flex; flex-direction: column; gap: 3px;
}
.roleBtn:active { transform: scale(.96); }
.roleName { font-family: var(--display); font-size: 24px; }
.roleBtn:first-child .roleName { color: #FF4D2E; }
.roleBtn:nth-child(2) .roleName { color: #F2308F; }
.roleDesc { font-weight: 700; font-size: 13px; opacity: .8; }
.roleSkip {
  border: none; background: transparent; font-weight: 800; font-size: 12px;
  color: rgba(23,18,14,.55); text-decoration: underline; cursor: pointer; padding: 8px; margin-top: 2px;
}
.ghForm { display: flex; flex-direction: column; gap: 12px; }
.ghNote { font-size: 16px; color: #4a3c2e; line-height: 1.45; }
.ghLabel { display: flex; flex-direction: column; gap: 5px; font-weight: 800; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
.ghInput { width: 100%; font-size: 14px; padding: 9px 12px; border-radius: 12px; }
.ghSave { align-self: stretch; font-size: 14px; padding: 12px; border-radius: 14px; }
.ghSave:disabled { opacity: .4; cursor: not-allowed; }
.viewerChip { font-size: 15px; }

/* ---- welcome line ---- */
.hiF { color: #FFDD33; font-size: 17px; margin-top: 10px; text-shadow: 2px 2px 0 rgba(0,0,0,.3); transform: rotate(-1.2deg); }

/* ---- love letter ---- */
.loveWrap { margin: 22px auto 0; max-width: 340px; }
.envelope {
  position: relative; display: block; width: 100%; min-height: 108px; cursor: pointer;
  background: linear-gradient(160deg, #FBF5E8, #EFE6CF); border: 3px solid var(--ink);
  border-radius: 10px; box-shadow: 4px 5px 0 var(--ink); padding: 54px 14px 14px;
  transform: rotate(-1deg); transition: transform .12s ease-out;
}
.envelope:active { transform: rotate(-1deg) scale(.97); }
.envFlap {
  position: absolute; top: 0; left: 0; right: 0; height: 46px;
  background: linear-gradient(180deg, #F3EAD3, #E7DABB);
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  border-bottom: 2px solid rgba(23,18,14,.25);
}
.waxSeal {
  position: absolute; top: 26px; left: 50%; transform: translateX(-50%) rotate(-6deg);
  width: 42px; height: 42px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #FF6B7E, #C21836 62%, #8E0F26);
  color: #FFD9DE; font-size: 20px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 6px rgba(0,0,0,.35), inset 0 -2px 4px rgba(0,0,0,.3), inset 0 2px 3px rgba(255,255,255,.35);
  z-index: 2;
}
.envelope.ready .waxSeal { animation: sealPulse 1s steps(2) infinite; }
@keyframes sealPulse { 0%{transform:translateX(-50%) rotate(-6deg) scale(1)} 100%{transform:translateX(-50%) rotate(4deg) scale(1.12)} }
.envelope.shake { animation: envShake .45s steps(4); }
@keyframes envShake { 0%{transform:rotate(-1deg) translateX(0)} 25%{transform:rotate(-2deg) translateX(-5px)} 50%{transform:rotate(0) translateX(5px)} 75%{transform:rotate(-2deg) translateX(-3px)} 100%{transform:rotate(-1deg) translateX(0)} }
.envText { display: block; font-size: 16px; color: #4a3c2e; line-height: 1.35; }
.envelope.ready .envText { color: #C21836; font-size: 18px; }

.noteCard {
  position: relative; background: var(--paper); border: 3px solid var(--ink); border-radius: 10px;
  box-shadow: 4px 5px 0 var(--ink); padding: 16px 16px 12px; transform: rotate(1deg); text-align: left;
  animation: letterIn .5s cubic-bezier(.2,1.4,.4,1);
}
@keyframes letterIn { from { transform: rotate(1deg) translateY(14px) scale(.94); opacity: 0; } }
.noteKicker { font-size: 18px; color: #C21836; margin-bottom: 6px; }
.noteText { font-size: 18px; line-height: 1.5; color: #2b2118; margin: 0; white-space: pre-wrap; cursor: text; }
.noteArea {
  width: 100%; border: none; outline: none; background: transparent; resize: vertical;
  font-size: 18px; line-height: 1.5; color: #2b2118;
}
.noteSig { text-align: right; font-size: 20px; color: #2b2118; margin-top: 8px; transform: rotate(-2deg); }
.noteClose { display: none; }

/* ---- mood stamps ---- */
.moodRow, .rateRow { position: relative; z-index: 1; margin-top: 22px; }
.moodTitle { color: #fff; font-size: 20px; text-shadow: 2px 2px 0 rgba(0,0,0,.25); transform: rotate(-1.2deg); margin-bottom: 10px; }
.moodStamps { display: flex; gap: 14px; }
.moodStamp {
  flex: 1; border: 3px solid var(--ink); background: var(--paper); border-radius: 16px;
  padding: 10px 8px 8px; cursor: pointer; box-shadow: 4px 4px 0 var(--ink);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: transform .1s ease-out; transform: rotate(-1.2deg);
}
.moodStamp + .moodStamp { transform: rotate(1.4deg); }
.moodStamp:active { transform: scale(.93); }
.moodEmoji { font-size: 34px; line-height: 1; min-height: 36px; }
.moodWho {
  font-family: var(--display); font-size: 12px; letter-spacing: .06em; color: #fff;
  background: var(--tone); padding: 3px 10px 2px; border-radius: 999px; box-shadow: 2px 2px 0 var(--ink);
}

/* ---- hearts rating ---- */
.hearts { display: flex; gap: 8px; }
.heartBtn {
  flex: 1; border: 3px solid var(--ink); background: var(--paper); border-radius: 14px;
  font-size: 26px; line-height: 1; padding: 9px 0 7px; cursor: pointer; color: rgba(23,18,14,.18);
  box-shadow: 3px 3px 0 var(--ink); transition: transform .1s ease-out, color .12s;
}
.heartBtn:active { transform: scale(.9); }
.heartBtn.on { color: var(--hc); animation: heartPop .3s cubic-bezier(.2,1.6,.4,1); }
@keyframes heartPop { 0%{transform:scale(.6)} 100%{transform:scale(1)} }

.certFav { font-size: 17px; color: #4a3c2e; margin: 2px 0 12px; transform: rotate(-1deg); }

@media (prefers-reduced-motion: reduce) {
  .stopmo, .grain, .heart, .arrowAnim, .lockBadge, .envelope.ready .waxSeal, .envelope.shake, .heartBtn.on { animation: none !important; }
  .stackCard.goingBack, .stackCard.comingFront, .noteCard, .sticker.stuck { animation-duration: .01s; }
  .confetti i { animation-duration: .01s; opacity: 0; }
}
`;
