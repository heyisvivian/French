/* ============================================================
   French B2 — daily trainer (Phase 1)
   Pure client-side. No backend. Progress lives in localStorage.
   ============================================================ */

"use strict";

/* ---------- config ---------- */
const CFG = {
  newVocabPerDay: 8,    // new frequency words introduced each session
  maxReviewPerDay: 24,  // cap due-cards so a session stays ~30 min
  targetMinutes: 30,
  storeKey: "frenchB2_state_v1",
};

/* ---------- date helpers ---------- */
const DAY = 86400000;
function todayStr(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  return todayStr(new Date(new Date(dateStr).getTime() + n * DAY));
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / DAY);
}

/* ---------- state ---------- */
const defaultState = () => ({
  srs: {},            // cardId -> { ease, interval, due, reps }
  vocabIndex: 0,      // next new vocab word to introduce
  grammarIndex: 0,
  readingIndex: 0,
  listeningIndex: 0,
  streak: 0,
  lastCompleted: null,
  totalSessions: 0,
});

let state = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(CFG.storeKey);
    return raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
  } catch (e) {
    return defaultState();
  }
}
function saveState() {
  try { localStorage.setItem(CFG.storeKey, JSON.stringify(state)); } catch (e) {}
}

/* ---------- data ---------- */
let DATA = { vocab: [], grammar: [], reading: [], listening: [] };
async function loadData() {
  const files = ["vocab", "grammar", "reading", "listening"];
  const results = await Promise.all(
    files.map((f) => fetch(`data/${f}.json`).then((r) => r.json()))
  );
  files.forEach((f, i) => (DATA[f] = results[i]));
}

/* ---------- spaced repetition (simplified SM-2) ---------- */
function gradeCard(id, quality) {
  // quality: 0 = again, 1 = good, 2 = easy
  const today = todayStr();
  let c = state.srs[id] || { ease: 2.5, interval: 0, due: today, reps: 0 };
  if (quality === 0) {
    c.reps = 0;
    c.interval = 0;            // due again next session
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = today;
  } else {
    if (c.reps === 0) c.interval = 1;
    else if (c.reps === 1) c.interval = 3;
    else c.interval = Math.round(c.interval * c.ease);
    if (quality === 2) {
      c.interval = Math.round(c.interval * 1.3) || 1;
      c.ease = Math.min(3.2, c.ease + 0.15);
    }
    c.reps += 1;
    c.due = addDays(today, c.interval);
  }
  state.srs[id] = c;
  saveState();
}

/* ---------- audio (browser text-to-speech, free) ---------- */
let frVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices() || [];
  frVoice = voices.find((v) => v.lang === "fr-FR") ||
            voices.find((v) => v.lang && v.lang.startsWith("fr")) || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text, rate = 0.92) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fr-FR";
  u.rate = rate;
  if (frVoice) u.voice = frVoice;
  speechSynthesis.speak(u);
}

/* ---------- session builder ---------- */
let session = null;
function buildSession() {
  const today = todayStr();

  // due review cards (only cards we've already introduced)
  const due = Object.keys(state.srs)
    .filter((id) => state.srs[id].due <= today)
    .map((id) => DATA.vocab.find((v) => v.id === id))
    .filter(Boolean)
    .slice(0, CFG.maxReviewPerDay);

  // new vocab
  const newVocab = DATA.vocab.slice(state.vocabIndex, state.vocabIndex + CFG.newVocabPerDay);

  // rotate the single-item blocks
  const grammar = DATA.grammar.length ? DATA.grammar[state.grammarIndex % DATA.grammar.length] : null;
  const reading = DATA.reading.length ? DATA.reading[state.readingIndex % DATA.reading.length] : null;
  const listening = DATA.listening.length ? DATA.listening[state.listeningIndex % DATA.listening.length] : null;

  // flatten into ordered steps
  const steps = [];
  if (due.length) {
    steps.push({ kind: "section", icon: "🔁", title: "复习 · Mémoire", sub: `${due.length} 张到期卡片，先唤醒记忆` });
    due.forEach((card) => steps.push({ kind: "flash", mode: "review", card }));
  }
  if (newVocab.length) {
    steps.push({ kind: "section", icon: "📚", title: "新词 · Vocabulaire", sub: `${newVocab.length} 个高频词` });
    newVocab.forEach((card) => steps.push({ kind: "flash", mode: "new", card }));
  }
  if (grammar) {
    steps.push({ kind: "section", icon: "✍️", title: "语法 · Grammaire", sub: grammar.title });
    steps.push({ kind: "grammar", lesson: grammar });
    (grammar.exercises || []).forEach((ex) =>
      steps.push({ kind: "mcq", ctx: "语法练习", q: ex.q, options: ex.options, answer: ex.answer, explain: ex.hint_zh })
    );
  }
  if (reading) {
    steps.push({ kind: "section", icon: "📖", title: "阅读 · Lecture", sub: reading.title });
    steps.push({ kind: "reading", item: reading });
    (reading.questions || []).forEach((qq) =>
      steps.push({ kind: "mcq", ctx: "阅读理解", q: qq.q, options: qq.options, answer: qq.answer, explain: qq.explain_zh })
    );
  }
  if (listening) {
    steps.push({ kind: "section", icon: "🎧", title: "听力 · Écoute", sub: listening.title });
    steps.push({ kind: "listening", item: listening });
    (listening.questions || []).forEach((qq) =>
      steps.push({ kind: "mcq", ctx: "听力理解", q: qq.q, options: qq.options, answer: qq.answer, explain: qq.explain_zh })
    );
  }
  steps.push({ kind: "summary" });

  session = {
    steps, idx: 0,
    newVocabCount: newVocab.length,
    hadGrammar: !!grammar, hadReading: !!reading, hadListening: !!listening,
    startTime: Date.now(),
    answered: 0, correct: 0, reviewed: due.length, learned: newVocab.length,
  };
}

/* ---------- timer ---------- */
let timerInterval = null;
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}
function updateTimer() {
  if (!session) return;
  const s = Math.floor((Date.now() - session.startTime) / 1000);
  const m = Math.floor(s / 60);
  $("#timer").textContent = `⏱️ ${m}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- tiny DOM helpers ---------- */
function $(sel) { return document.querySelector(sel); }
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function setView(node) { const v = $("#view"); v.innerHTML = ""; v.appendChild(node); v.scrollTop = 0; }
function setActions(nodes) { const a = $("#action-bar"); a.innerHTML = ""; (nodes || []).forEach((n) => a.appendChild(n)); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function btn(label, cls, onClick) { const b = el(`<button class="${cls}">${label}</button>`); b.addEventListener("click", onClick); return b; }

/* ---------- progress bar ---------- */
function updateProgress() {
  if (!session) { $("#progress-wrap").hidden = true; return; }
  $("#progress-wrap").hidden = false;
  const pct = Math.round((session.idx / (session.steps.length - 1)) * 100);
  $("#progress-bar").style.width = `${Math.min(100, pct)}%`;
}

/* ============================================================
   SCREENS
   ============================================================ */

function renderHome() {
  session = null;
  clearInterval(timerInterval);
  $("#timer").textContent = "⏱️ 0:00";
  $("#progress-wrap").hidden = true;
  $("#streak").textContent = `🔥 ${state.streak}`;

  const today = todayStr();
  const dueCount = Object.keys(state.srs).filter((id) => state.srs[id].due <= today).length;
  const newCount = Math.min(CFG.newVocabPerDay, Math.max(0, DATA.vocab.length - state.vocabIndex));
  const doneToday = state.lastCompleted === today;

  const node = el(`
    <div>
      <div class="home-hero">
        <div style="font-size:46px">🇫🇷</div>
        <h1>今日法语 · B2</h1>
        <p>${doneToday ? "今天已完成 ✅ 可以再练一轮" : "约 30 分钟 · 词汇 / 语法 / 阅读 / 听力"}</p>
      </div>
      <div class="card">
        <ul class="plan-list">
          <li><span class="pico">🔁</span><span class="ptxt"><b>记忆复习</b><small>间隔重复，巩固学过的词</small></span><span class="pcount">${dueCount}</span></li>
          <li><span class="pico">📚</span><span class="ptxt"><b>新高频词</b><small>带例句和发音</small></span><span class="pcount">${newCount}</span></li>
          <li><span class="pico">✍️</span><span class="ptxt"><b>语法</b><small>${DATA.grammar.length ? escapeHtml(DATA.grammar[state.grammarIndex % DATA.grammar.length].title) : "—"}</small></span><span class="pcount">1</span></li>
          <li><span class="pico">📖</span><span class="ptxt"><b>阅读理解</b><small>短文 + 问题</small></span><span class="pcount">1</span></li>
          <li><span class="pico">🎧</span><span class="ptxt"><b>听力</b><small>法语朗读 + 问题</small></span><span class="pcount">1</span></li>
        </ul>
      </div>
      <p class="hint">连续学习 ${state.streak} 天 · 累计 ${state.totalSessions} 次</p>
    </div>
  `);
  setView(node);
  setActions([btn("开始今日学习 ▶", "btn-primary", startSession)]);
}

function startSession() {
  buildSession();
  startTimer();
  renderStep();
}

function renderStep() {
  updateProgress();
  const step = session.steps[session.idx];
  switch (step.kind) {
    case "section": return renderSection(step);
    case "flash": return renderFlash(step);
    case "grammar": return renderGrammar(step);
    case "reading": return renderReading(step);
    case "listening": return renderListening(step);
    case "mcq": return renderMCQ(step);
    case "summary": return renderSummary();
  }
}
function next() { session.idx++; renderStep(); }

function renderSection(step) {
  setView(el(`
    <div class="section-banner">
      <div class="icon">${step.icon}</div>
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.sub || "")}</p>
    </div>
  `));
  setActions([btn("继续 →", "btn-primary", next)]);
}

function renderFlash(step) {
  const c = step.card;
  const tag = step.mode === "new"
    ? '<span class="tag tag-new">新词 NEW</span>'
    : '<span class="tag tag-review">复习 REVIEW</span>';
  const node = el(`
    <div class="card flash">
      <div>${tag}</div>
      <div class="pos">${escapeHtml(c.pos || "")}</div>
      <div class="word">${escapeHtml(c.fr)}</div>
      <button class="audio-btn" id="play">🔊</button>
      <div id="back" hidden>
        <div class="zh">${escapeHtml(c.zh)}</div>
        <div class="ex">${escapeHtml(c.example_fr || "")}
          <span class="ex-zh">${escapeHtml(c.example_zh || "")}</span>
        </div>
      </div>
    </div>
  `);
  setView(node);
  $("#play").addEventListener("click", () => speak(c.fr));
  speak(c.fr);

  setActions([btn("显示释义 👁", "btn-primary", reveal)]);
  function reveal() {
    $("#back").hidden = false;
    speak(c.example_fr || c.fr);
    const again = btn("不会", "grade-again", () => grade(0));
    const good = btn("会了", "grade-good", () => grade(1));
    const easy = btn("简单", "grade-easy", () => grade(2));
    const row = el('<div class="grade-row" style="flex:1"></div>');
    row.append(again, good, easy);
    setActions([row]);
  }
  function grade(q) { gradeCard(c.id, q); next(); }
}

function renderGrammar(step) {
  const g = step.lesson;
  const exHtml = (g.examples || []).map((e) =>
    `<div class="ex-item"><div class="ex-fr">${escapeHtml(e.fr)}</div><div class="ex-zh">${escapeHtml(e.zh)}</div></div>`
  ).join("");
  const node = el(`
    <div class="card">
      <div class="lesson-level">${escapeHtml(g.level || "")}</div>
      <h2 class="lesson-title">${escapeHtml(g.title)}</h2>
      <div class="explain">${escapeHtml(g.explain_zh)}</div>
      <div class="examples">${exHtml}</div>
    </div>
  `);
  setView(node);
  node.querySelectorAll(".ex-fr").forEach((e) =>
    e.addEventListener("click", () => speak(e.textContent))
  );
  setActions([btn("开始练习 →", "btn-primary", next)]);
}

function renderReading(step) {
  const r = step.item;
  const node = el(`
    <div class="card">
      <div class="lesson-level">${escapeHtml(r.level || "")}</div>
      <h2 class="lesson-title">${escapeHtml(r.title)}</h2>
      <p class="reading-text">${escapeHtml(r.text_fr)}</p>
      <button class="audio-btn" id="play">🔊</button>
    </div>
  `);
  setView(node);
  $("#play").addEventListener("click", () => speak(r.text_fr));
  setActions([btn("回答问题 →", "btn-primary", next)]);
}

function renderListening(step) {
  const l = step.item;
  const node = el(`
    <div class="card" style="text-align:center">
      <div class="lesson-level">${escapeHtml(l.level || "")}</div>
      <h2 class="lesson-title">${escapeHtml(l.title)}</h2>
      <p style="color:var(--muted)">点击播放，可重复听。听完再回答问题。</p>
      <button class="audio-btn" id="play" style="width:72px;height:72px;font-size:30px">🔊</button>
      <div style="margin-top:14px">
        <button class="btn-ghost" id="slow">🐢 慢速</button>
        <button class="btn-ghost" id="show">显示原文</button>
      </div>
      <p id="transcript" class="reading-text" style="text-align:left;margin-top:16px" hidden>${escapeHtml(l.transcript_fr)}</p>
    </div>
  `);
  setView(node);
  $("#play").addEventListener("click", () => speak(l.transcript_fr));
  $("#slow").addEventListener("click", () => speak(l.transcript_fr, 0.7));
  $("#show").addEventListener("click", () => { $("#transcript").hidden = !$("#transcript").hidden; });
  speak(l.transcript_fr);
  setActions([btn("回答问题 →", "btn-primary", next)]);
}

function renderMCQ(step) {
  const node = el(`
    <div class="card">
      <div class="mcq-ctx">${escapeHtml(step.ctx)}</div>
      <div class="mcq-q">${escapeHtml(step.q)}</div>
      <div id="opts"></div>
      <div id="fb"></div>
    </div>
  `);
  const opts = node.querySelector("#opts");
  step.options.forEach((opt, i) => {
    const b = el(`<button class="opt">${escapeHtml(opt)}</button>`);
    b.addEventListener("click", () => choose(i, b));
    opts.appendChild(b);
  });
  setView(node);
  setActions([]); // no action until answered

  let done = false;
  function choose(i, btnEl) {
    if (done) return;
    done = true;
    session.answered++;
    const correct = i === step.answer;
    if (correct) session.correct++;
    const all = [...opts.querySelectorAll(".opt")];
    all.forEach((b, j) => {
      b.classList.add(j === step.answer ? "correct" : (j === i ? "wrong" : "dim"));
    });
    const fb = node.querySelector("#fb");
    fb.appendChild(el(`<div class="feedback ${correct ? "ok" : "no"}">${correct ? "✅ 正确！" : "❌ 正确答案：" + escapeHtml(step.options[step.answer])}${step.explain ? "<br>" + escapeHtml(step.explain) : ""}</div>`));
    setActions([btn("继续 →", "btn-primary", next)]);
  }
}

function renderSummary() {
  // commit progress for the session
  const today = todayStr();
  if (state.lastCompleted !== today) {
    if (state.lastCompleted === addDays(today, -1)) state.streak += 1;
    else state.streak = 1;
    state.lastCompleted = today;
    state.totalSessions += 1;
  }
  // advance content pointers so tomorrow brings new material
  state.vocabIndex += session.newVocabCount;
  if (session.hadGrammar) state.grammarIndex += 1;
  if (session.hadReading) state.readingIndex += 1;
  if (session.hadListening) state.listeningIndex += 1;
  saveState();

  clearInterval(timerInterval);
  const mins = Math.max(1, Math.round((Date.now() - session.startTime) / 60000));
  const acc = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
  $("#streak").textContent = `🔥 ${state.streak}`;
  $("#progress-bar").style.width = "100%";

  setView(el(`
    <div>
      <div class="done-emoji">🎉</div>
      <h2 style="text-align:center;margin:6px 0">今日完成！Bravo !</h2>
      <p style="text-align:center;color:var(--muted)">连续 ${state.streak} 天 🔥</p>
      <div class="summary-grid">
        <div class="stat"><div class="num">${session.learned}</div><div class="lbl">新学单词</div></div>
        <div class="stat"><div class="num">${session.reviewed}</div><div class="lbl">复习卡片</div></div>
        <div class="stat"><div class="num">${session.answered ? acc + "%" : "—"}</div><div class="lbl">练习正确率</div></div>
        <div class="stat"><div class="num">${mins}</div><div class="lbl">分钟</div></div>
      </div>
      <p class="hint">明天的复习已自动安排好，记得回来打卡！</p>
    </div>
  `));
  setActions([btn("回到首页", "btn-secondary", renderHome)]);
}

/* ---------- service worker (offline + installable) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ---------- boot ---------- */
(async function boot() {
  setView(el('<div style="text-align:center;padding:60px;color:var(--muted)">加载中…</div>'));
  try {
    await loadData();
    renderHome();
  } catch (e) {
    setView(el(`<div class="card">内容加载失败。如果你是直接双击打开文件，请改用本地服务器或 GitHub Pages 链接打开。<br><br><small>${escapeHtml(String(e))}</small></div>`));
  }
})();
