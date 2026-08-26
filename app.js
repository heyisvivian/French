/* ============================================================
   French grammar trainer
   Pure client-side. No backend. Progress lives in localStorage.
   ============================================================ */

"use strict";

/* ---------- config ---------- */
const CFG = {
  newVocabPerDay: 0,         // this app now focuses on grammar, not new vocab
  maxReviewPerDay: 30,       // cap due vocab cards
  grammarPerDay: 2,          // grammar lessons per session
  conjugationSetsPerDay: 4,  // verb-conjugation drill sets per session
  readingsPerDay: 2,         // grammar readings per session
  mistakeReviewPerDay: 12,   // past mistakes replayed at the start of a session
  targetMinutes: 45,
  rateNormal: 1.0,           // native speaking speed for audio
  rateSlow: 0.7,             // 🐢 slow replay
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
  conjugationIndex: 0,
  readingIndex: 0,
  streak: 0,
  lastCompleted: null,
  totalSessions: 0,
  stats: {},          // topic -> { seen, correct }  (lifetime accuracy per topic)
  mistakes: [],       // wrong answers, replayed until answered right twice
  history: [],        // one { date, mins, answered, correct } per completed session
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
let DATA = { vocab: [], grammar: [], conjugation: [], reading: [], knowledge: [] };
async function loadData() {
  const files = ["vocab", "grammar", "conjugation", "reading", "knowledge"];
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

/* ---------- learning tracker: per-topic stats + mistake notebook ---------- */
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "m" + h.toString(36);
}
function stepToMistake(step) {
  if (step.kind === "conj") {
    return { kind: "conj", topic: step.topic || step.set.tense_zh, tense: step.set.tense_zh, item: step.item };
  }
  return { kind: "mcq", topic: step.topic || "", ctx: step.ctx || "", q: step.q, options: step.options, answer: step.answer, explain: step.explain || "", src: step.src || "" };
}
function addMistake(payload) {
  const key = hashId(payload.kind + "|" + (payload.q || (payload.item ? payload.item.sentence : "")));
  const today = todayStr();
  const existing = state.mistakes.find((m) => m.id === key);
  if (existing) {
    existing.wrong += 1; existing.streak = 0; existing.due = today; existing.mastered = false;
  } else {
    state.mistakes.push(Object.assign({ id: key, wrong: 1, streak: 0, due: today, added: today, mastered: false }, payload));
    // keep the notebook bounded: drop oldest mastered entries beyond 200
    if (state.mistakes.length > 200) {
      const idx = state.mistakes.findIndex((m) => m.mastered);
      if (idx >= 0) state.mistakes.splice(idx, 1);
    }
  }
}
function gradeRetry(m, correct) {
  if (correct) {
    m.streak += 1;
    if (m.streak >= 2) m.mastered = true;
    else m.due = addDays(todayStr(), 2);
  } else {
    m.wrong += 1; m.streak = 0; m.due = todayStr();
  }
}
/* central per-answer bookkeeping, called from MCQ + conjugation screens */
function logAnswer(step, correct) {
  session.answered++;
  if (correct) session.correct++;
  const topic = step.topic;
  if (topic) {
    const s = state.stats[topic] || { seen: 0, correct: 0 };
    s.seen += 1; if (correct) s.correct += 1;
    state.stats[topic] = s;
    const t = session.topicLog[topic] || { seen: 0, correct: 0 };
    t.seen += 1; if (correct) t.correct += 1;
    session.topicLog[topic] = t;
  }
  if (step.retry) {
    gradeRetry(step.retry, correct);
    if (step.retry.mastered) session.fixedMistakes++;
  } else if (!correct) {
    addMistake(stepToMistake(step));
    session.newMistakes++;
  }
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
function speak(text, rate = CFG.rateNormal) {
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
function pickRotation(arr, startIndex, count) {
  const n = Math.min(count, arr.length);
  const out = [];
  for (let k = 0; k < n; k++) out.push(arr[(startIndex + k) % arr.length]);
  return out;
}
function dueRetries() {
  const today = todayStr();
  return state.mistakes.filter((m) => !m.mastered && m.due <= today);
}
function buildSession() {
  const today = todayStr();

  // due review cards (only cards we've already introduced)
  const due = Object.keys(state.srs)
    .filter((id) => state.srs[id].due <= today)
    .map((id) => DATA.vocab.find((v) => v.id === id))
    .filter(Boolean)
    .slice(0, CFG.maxReviewPerDay);

  // past mistakes to replay first
  const retries = dueRetries().slice(0, CFG.mistakeReviewPerDay);

  // rotating blocks: several grammar lessons + readings + conjugation sets per session
  const grammars = pickRotation(DATA.grammar, state.grammarIndex, CFG.grammarPerDay);
  const readings = pickRotation(DATA.reading, state.readingIndex, CFG.readingsPerDay);
  const conjSets = pickRotation(DATA.conjugation, state.conjugationIndex, CFG.conjugationSetsPerDay);

  // flatten into ordered steps
  const steps = [];
  if (retries.length) {
    steps.push({ kind: "section", icon: "📕", title: "错题重练 · Corrections", sub: `${retries.length} 道之前做错的题 · 连对 2 次才算掌握` });
    retries.forEach((m) => {
      if (m.kind === "conj") {
        steps.push({ kind: "conj", set: { tense_zh: m.tense || m.topic || "" }, item: m.item, topic: m.topic, retry: m });
      } else {
        steps.push({ kind: "mcq", ctx: "错题重练 · " + (m.topic || m.ctx || ""), q: m.q, options: m.options, answer: m.answer, explain: m.explain, topic: m.topic, retry: m });
      }
    });
  }
  if (due.length) {
    steps.push({ kind: "section", icon: "🔁", title: "词卡复习 · Mémoire", sub: `${due.length} 张到期卡片，先唤醒记忆` });
    due.forEach((card) => steps.push({ kind: "flash", mode: "review", card }));
  }
  grammars.forEach((grammar, gi) => {
    steps.push({ kind: "section", icon: "✍️", title: `语法主题 ${gi + 1}/${grammars.length} · Grammaire`, sub: grammar.title });
    steps.push({ kind: "grammar", lesson: grammar });
    (grammar.exercises || []).forEach((ex) =>
      steps.push({ kind: "mcq", ctx: "语法练习 · " + grammar.title, q: ex.q, options: ex.options, answer: ex.answer, explain: ex.hint_zh, topic: grammar.title })
    );
  });
  if (conjSets.length) {
    steps.push({ kind: "section", icon: "🔤", title: "动词变位 · Conjugaison", sub: `${conjSets.length} 组时态 · 在空格里填入正确形式` });
    conjSets.forEach((set) =>
      (set.items || []).forEach((item) => steps.push({ kind: "conj", set, item, topic: set.tense_zh }))
    );
  }
  readings.forEach((reading, ri) => {
    steps.push({ kind: "section", icon: "📖", title: `语法阅读 ${ri + 1}/${readings.length} · Lecture`, sub: reading.title });
    steps.push({ kind: "reading", item: reading });
    (reading.questions || []).forEach((qq) =>
      steps.push({ kind: "mcq", ctx: (qq.ctx || "阅读理解") + " · " + reading.title, q: qq.q, options: qq.options, answer: qq.answer, explain: qq.explain_zh, topic: qq.ctx || "阅读理解", src: reading.title })
    );
  });
  steps.push({ kind: "summary" });

  session = {
    steps, idx: 0,
    grammarCount: grammars.length,
    readingCount: readings.length,
    conjCount: conjSets.length,
    retryCount: retries.length,
    startTime: Date.now(),
    answered: 0, correct: 0, reviewed: due.length,
    newMistakes: 0, fixedMistakes: 0,
    topicLog: {},   // per-session topic accuracy shown on the summary screen
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
  const doneToday = state.lastCompleted === today;
  const retryCount = Math.min(dueRetries().length, CFG.mistakeReviewPerDay);

  const grammars = pickRotation(DATA.grammar, state.grammarIndex, CFG.grammarPerDay);
  const readings = pickRotation(DATA.reading, state.readingIndex, CFG.readingsPerDay);
  const conjSets = pickRotation(DATA.conjugation, state.conjugationIndex, CFG.conjugationSetsPerDay);
  const grammarEx = grammars.reduce((n, g) => n + (g.exercises || []).length, 0);
  const conjItems = conjSets.reduce((n, s) => n + (s.items || []).length, 0);
  const readingQs = readings.reduce((n, r) => n + (r.questions || []).length, 0);
  const totalQs = retryCount + grammarEx + conjItems + readingQs;

  const grammarTitles = grammars.map((g) => g.title).join("｜");
  const readingTitles = readings.map((r) => r.title).join("｜");

  const node = el(`
    <div>
      <div class="home-hero">
        <div style="font-size:46px">🇫🇷</div>
        <h1>今日语法 · B2</h1>
        <p>${doneToday ? "今天已完成 ✅ 可以再练一轮" : `今天共约 ${totalQs} 道题 · 目标 ${CFG.targetMinutes} 分钟`}</p>
      </div>
      <div class="card">
        <ul class="plan-list">
          ${retryCount ? `<li><span class="pico">📕</span><span class="ptxt"><b>错题重练</b><small>之前做错的题，连对 2 次才移出错题本</small></span><span class="pcount">${retryCount}</span></li>` : ""}
          ${dueCount ? `<li><span class="pico">🔁</span><span class="ptxt"><b>旧卡片复习</b><small>以前学过的词卡，到期才出现</small></span><span class="pcount">${dueCount}</span></li>` : ""}
          <li><span class="pico">✍️</span><span class="ptxt"><b>语法主题 ×${grammars.length}</b><small>${escapeHtml(grammarTitles || "—")}</small></span><span class="pcount">${grammarEx}</span></li>
          <li><span class="pico">🔤</span><span class="ptxt"><b>动词变位 ×${conjSets.length} 组</b><small>${escapeHtml(conjSets.map((s) => s.tense_zh).join("｜") || "—")}</small></span><span class="pcount">${conjItems}</span></li>
          <li><span class="pico">📖</span><span class="ptxt"><b>语法阅读 ×${readings.length}</b><small>${escapeHtml(readingTitles || "—")}</small></span><span class="pcount">${readingQs}</span></li>
          <li><span class="pico">🗂️</span><span class="ptxt"><b>语法知识库</b><small>笔记 + 进阶主题，随时查阅</small></span><span class="pcount">${DATA.knowledge.length}</span></li>
        </ul>
      </div>
      <p class="hint">连续学习 ${state.streak} 天 · 累计 ${state.totalSessions} 次 · 错题本待攻克 ${dueRetries().length} 题</p>
    </div>
  `);
  setView(node);
  setActions([
    btn("开始 ▶", "btn-primary", startSession),
    btn("知识库", "btn-secondary", renderKnowledgeBase),
    btn("学习报告", "btn-secondary", renderReport)
  ]);
}

function renderKnowledgeBase() {
  session = null;
  clearInterval(timerInterval);
  $("#timer").textContent = "⏱️ 0:00";
  $("#progress-wrap").hidden = true;

  const topics = DATA.knowledge.map((topic) => `
    <button class="topic-card" data-id="${escapeHtml(topic.id)}">
      <span>
        <b>${escapeHtml(topic.title)}</b>
        <small>${escapeHtml(topic.subtitle)}</small>
      </span>
      <em>${escapeHtml(topic.level)}</em>
    </button>
  `).join("");

  const node = el(`
    <div>
      <div class="kb-head">
        <div class="lesson-level">你的法语笔记 + B2 进阶主题</div>
        <h1>语法知识库</h1>
        <p>按主题复习语法、句型和容易混淆的用法。做题卡壳时随时回来查。</p>
      </div>
      <div class="topic-list">${topics}</div>
    </div>
  `);
  setView(node);
  node.querySelectorAll(".topic-card").forEach((card) => {
    card.addEventListener("click", () => renderKnowledgeTopic(card.dataset.id));
  });
  setActions([btn("回到首页", "btn-secondary", renderHome)]);
}

function renderKnowledgeTopic(id) {
  const topic = DATA.knowledge.find((item) => item.id === id);
  if (!topic) return renderKnowledgeBase();

  const rulesHtml = (topic.rules || []).map((rule) => {
    const examples = (rule.examples || []).map((ex) => `
      <div class="kb-example" role="button" tabindex="0" data-speak="${escapeHtml(ex.fr)}">
        <div class="ex-fr">${escapeHtml(ex.fr)}</div>
        <div class="ex-zh">${escapeHtml(ex.zh)}</div>
      </div>
    `).join("");
    return `
      <section class="kb-rule">
        <h3>${escapeHtml(rule.label)}</h3>
        <p>${escapeHtml(rule.text_zh)}</p>
        ${examples ? `<div class="kb-examples">${examples}</div>` : ""}
      </section>
    `;
  }).join("");

  const reviewHtml = (topic.review || []).map((item) => `
    <details class="review-card">
      <summary>${escapeHtml(item.q)}</summary>
      <p>${escapeHtml(item.a)}</p>
    </details>
  `).join("");

  const srcRaw = topic.source_pages || "notes";
  const srcLabel = /^\d/.test(srcRaw) ? "笔记 p." + srcRaw : srcRaw;
  const node = el(`
    <article class="card kb-detail">
      <div class="lesson-level">${escapeHtml(topic.level)} · ${escapeHtml(srcLabel)}</div>
      <h2 class="lesson-title">${escapeHtml(topic.title)}</h2>
      <p class="kb-subtitle">${escapeHtml(topic.subtitle)}</p>
      <div class="explain">${escapeHtml(topic.summary_zh)}</div>
      ${rulesHtml}
      ${reviewHtml ? `<h3 class="kb-review-title">快速自测</h3><div class="review-list">${reviewHtml}</div>` : ""}
    </article>
  `);
  setView(node);
  node.querySelectorAll(".kb-example").forEach((example) => {
    const play = () => speak(example.dataset.speak);
    example.addEventListener("click", play);
    example.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
  });
  setActions([
    btn("返回知识库", "btn-secondary", renderKnowledgeBase),
    btn("回到首页", "btn-secondary", renderHome)
  ]);
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
    case "conj": return renderConjugation(step);
    case "reading": return renderReading(step);
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

function renderHighlightedText(text, focusItems) {
  let html = escapeHtml(text);
  (focusItems || []).forEach((item, idx) => {
    const quote = escapeHtml(item.quote || "");
    if (!quote || !html.includes(quote)) return;
    const label = escapeHtml(item.label || `G${idx + 1}`);
    html = html.replace(quote, `<mark class="grammar-mark" data-focus="${idx}">${quote}<span>${label}</span></mark>`);
  });
  return html;
}

function normFr(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ").replace(/[’']/g, "'");
}
function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function renderConjugation(step) {
  const it = step.item;
  const sentenceHtml = escapeHtml(it.sentence).replace("___", '<b style="color:var(--blue)">_____</b>');
  const node = el(`
    <div class="card">
      <div class="mcq-ctx">动词变位 · ${escapeHtml(step.set.tense_zh)}</div>
      <div class="mcq-q">${sentenceHtml}</div>
      <p style="color:var(--muted);margin:-6px 0 14px">原形 infinitif：<b>${escapeHtml(it.infinitive)}</b></p>
      <input id="cinput" type="text" inputmode="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="输入动词变位形式…" />
      <div id="fb"></div>
    </div>
  `);
  setView(node);
  const input = node.querySelector("#cinput");
  setTimeout(() => input.focus(), 60);

  let done = false;
  function check() {
    if (done) return;
    if (!input.value.trim()) return;
    done = true;
    input.disabled = true;
    const answers = it.answers.map(normFr);
    const u = normFr(input.value);
    let ok, cls, msg;
    if (answers.includes(u)) {
      ok = true; cls = "ok"; msg = "✅ 正确！";
    } else if (answers.map(stripAccents).includes(stripAccents(u))) {
      ok = true; cls = "ok";
      msg = "基本正确 ✅ 注意重音符号：<b>" + escapeHtml(it.answers[0]) + "</b>";
    } else {
      ok = false; cls = "no"; msg = "❌ 正确答案：<b>" + escapeHtml(it.answers[0]) + "</b>";
    }
    logAnswer(step, ok);
    if (step.retry && ok && step.retry.mastered) msg += "<br>🎯 连对 2 次，已从错题本移除";
    else if (step.retry && !ok) msg += "<br>📕 记回错题本，下次再来";
    else if (!step.retry && !ok) msg += "<br>📕 已加入错题本，之后会重练";
    node.querySelector("#fb").appendChild(
      el(`<div class="feedback ${cls}">${msg}${it.hint_zh ? "<br>" + escapeHtml(it.hint_zh) : ""}</div>`)
    );
    if (it.full) speak(it.full);
    setActions([btn("继续 →", "btn-primary", next)]);
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
  setActions([btn("检查", "btn-primary", check)]);
}

function renderReading(step) {
  const r = step.item;
  const focus = r.grammar_focus || [];
  const focusHtml = focus.map((item, idx) => `
    <li>
      <button class="focus-card" data-focus="${idx}">
        <b>${escapeHtml(item.label || "")}</b>
        <span>${escapeHtml(item.grammar || "")}</span>
        <small>${escapeHtml(item.note_zh || "")}</small>
      </button>
    </li>
  `).join("");
  const node = el(`
    <div class="card">
      <div class="lesson-level">${escapeHtml(r.level || "")}</div>
      <h2 class="lesson-title">${escapeHtml(r.title)}</h2>
      <p class="reading-text">${renderHighlightedText(r.text_fr, focus)}</p>
      ${focusHtml ? `<h3 class="focus-title">文章里的语法重点</h3><ol class="focus-list">${focusHtml}</ol>` : ""}
    </div>
  `);
  setView(node);
  node.querySelectorAll(".focus-card, .grammar-mark").forEach((item) => {
    item.addEventListener("click", () => {
      const idx = Number(item.dataset.focus);
      const target = node.querySelector(`.focus-card[data-focus="${idx}"]`);
      if (!target) return;
      target.classList.add("pulse");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => target.classList.remove("pulse"), 650);
    });
  });
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
    const correct = i === step.answer;
    logAnswer(step, correct);
    const all = [...opts.querySelectorAll(".opt")];
    all.forEach((b, j) => {
      b.classList.add(j === step.answer ? "correct" : (j === i ? "wrong" : "dim"));
    });
    let extra = "";
    if (step.retry && correct && step.retry.mastered) extra = "<br>🎯 连对 2 次，已从错题本移除";
    else if (step.retry && !correct) extra = "<br>📕 记回错题本，下次再来";
    else if (!step.retry && !correct) extra = "<br>📕 已加入错题本，之后会重练";
    const fb = node.querySelector("#fb");
    fb.appendChild(el(`<div class="feedback ${correct ? "ok" : "no"}">${correct ? "✅ 正确！" : "❌ 正确答案：" + escapeHtml(step.options[step.answer])}${extra}${step.explain ? "<br>" + escapeHtml(step.explain) : ""}</div>`));
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
  state.grammarIndex += session.grammarCount;
  state.conjugationIndex += session.conjCount;
  state.readingIndex += session.readingCount;

  clearInterval(timerInterval);
  const mins = Math.max(1, Math.round((Date.now() - session.startTime) / 60000));
  const acc = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
  state.history.push({ date: today, mins, answered: session.answered, correct: session.correct });
  if (state.history.length > 90) state.history = state.history.slice(-90);
  saveState();

  $("#streak").textContent = `🔥 ${state.streak}`;
  $("#progress-bar").style.width = "100%";

  // per-topic breakdown of this session, weakest first
  const topics = Object.entries(session.topicLog)
    .map(([topic, t]) => ({ topic, seen: t.seen, correct: t.correct, acc: t.seen ? t.correct / t.seen : 0 }))
    .sort((a, b) => a.acc - b.acc);
  const topicRows = topics.map((t) => {
    const pct = Math.round(t.acc * 100);
    const cls = pct >= 80 ? "good" : pct >= 60 ? "mid" : "bad";
    return `<div class="bar-row"><span class="bar-label">${escapeHtml(t.topic)}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${pct}%"></span></span><span class="bar-val">${t.correct}/${t.seen}</span></div>`;
  }).join("");

  setView(el(`
    <div>
      <div class="done-emoji">🎉</div>
      <h2 style="text-align:center;margin:6px 0">今日完成！Bravo !</h2>
      <p style="text-align:center;color:var(--muted)">连续 ${state.streak} 天 🔥</p>
      <div class="summary-grid">
        <div class="stat"><div class="num">${session.answered}</div><div class="lbl">完成题目</div></div>
        <div class="stat"><div class="num">${session.answered ? acc + "%" : "—"}</div><div class="lbl">正确率</div></div>
        <div class="stat"><div class="num">${session.newMistakes}</div><div class="lbl">新增错题</div></div>
        <div class="stat"><div class="num">${mins}</div><div class="lbl">分钟</div></div>
      </div>
      ${session.fixedMistakes ? `<p class="hint">🎯 本次巩固掌握了 ${session.fixedMistakes} 道旧错题</p>` : ""}
      ${topicRows ? `<div class="card"><h3 class="report-h3">本次各主题正确率（弱项在前）</h3>${topicRows}</div>` : ""}
      <p class="hint">错题已记入错题本，明天开场会先重练。想让内容跟着弱项进化，去「学习报告」把数据交给 Claude。</p>
    </div>
  `));
  setActions([
    btn("学习报告", "btn-secondary", renderReport),
    btn("回到首页", "btn-primary", renderHome)
  ]);
}

/* ============================================================
   LEARNING REPORT — stats, mistake notebook, backup, Claude loop
   ============================================================ */

function copyText(text, feedbackEl) {
  const done = () => { if (feedbackEl) { feedbackEl.textContent = "✅ 已复制到剪贴板"; setTimeout(() => (feedbackEl.textContent = ""), 2500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) {}
  document.body.removeChild(ta);
}

function exportPayload() {
  const active = state.mistakes.filter((m) => !m.mastered);
  return {
    exported: todayStr(),
    totalSessions: state.totalSessions,
    streak: state.streak,
    indices: { grammar: state.grammarIndex, conjugation: state.conjugationIndex, reading: state.readingIndex },
    statsByTopic: state.stats,
    activeMistakes: active.map((m) => ({
      topic: m.topic || "", kind: m.kind,
      q: m.kind === "conj" ? (m.item && m.item.sentence) : m.q,
      wrongCount: m.wrong,
    })),
    recentSessions: state.history.slice(-14),
  };
}

function buildClaudePrompt() {
  return [
    "你是我的法语教练。我的语法训练 App 在 GitHub 仓库 heyisvivian/French-daily（纯静态 PWA，内容都在 data/*.json）。",
    "下面是 App 导出的我的真实学习数据。请根据它更新仓库内容：",
    "1. 针对 statsByTopic 里正确率最低的主题，在 data/grammar.json 新增更难的课程和练习，在 data/conjugation.json 新增对应变位组；",
    "2. 把 activeMistakes 里的每道错题改写成 2-3 道【同知识点、不同句子】的变体练习加进对应文件（避免我背答案）；",
    "3. 在 data/reading.json 新增 1-2 篇 B2-C1 语法阅读（带 grammar_focus 精确引文标注和 6 道以上题目）；",
    "4. 正确率 ≥90% 且练习次数 ≥8 的主题算已掌握，减少同类新内容；",
    "5. 新内容放到数组前部让我尽快练到；改完 bump sw.js 的缓存版本号，校验 JSON 后提交并开 PR。",
    "",
    "=== 学习数据 JSON ===",
    JSON.stringify(exportPayload(), null, 2),
  ].join("\n");
}

function renderReport() {
  session = null;
  clearInterval(timerInterval);
  $("#timer").textContent = "⏱️ 0:00";
  $("#progress-wrap").hidden = true;

  const topics = Object.entries(state.stats)
    .map(([topic, s]) => ({ topic, seen: s.seen, correct: s.correct, acc: s.seen ? s.correct / s.seen : 0 }))
    .filter((t) => t.seen >= 3)
    .sort((a, b) => a.acc - b.acc);
  const weakRows = topics.slice(0, 10).map((t) => {
    const pct = Math.round(t.acc * 100);
    const cls = pct >= 80 ? "good" : pct >= 60 ? "mid" : "bad";
    return `<div class="bar-row"><span class="bar-label">${escapeHtml(t.topic)}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${pct}%"></span></span><span class="bar-val">${pct}%</span></div>`;
  }).join("");

  const active = state.mistakes.filter((m) => !m.mastered);
  const masteredCount = state.mistakes.length - active.length;
  const mistakeRows = active.slice(0, 20).map((m) => {
    const label = m.kind === "conj" ? (m.item ? m.item.sentence : "") : m.q;
    return `<li class="mist-item"><span class="mist-q">${escapeHtml(label || "")}</span><span class="mist-meta">${escapeHtml(m.topic || "")} · 错 ${m.wrong} 次</span></li>`;
  }).join("");

  const totalAnswered = Object.values(state.stats).reduce((n, s) => n + s.seen, 0);
  const totalCorrect = Object.values(state.stats).reduce((n, s) => n + s.correct, 0);
  const globalAcc = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const node = el(`
    <div>
      <div class="kb-head">
        <div class="lesson-level">数据只存在这台设备的浏览器里</div>
        <h1>学习报告</h1>
        <p>累计 ${state.totalSessions} 次练习 · ${totalAnswered} 道题 · 总正确率 ${totalAnswered ? globalAcc + "%" : "—"} · 错题本 ${active.length} 题待攻克${masteredCount ? `（已掌握 ${masteredCount}）` : ""}</p>
      </div>

      <div class="card">
        <h3 class="report-h3">薄弱主题（正确率从低到高）</h3>
        ${weakRows || '<p class="hint" style="text-align:left">还没有足够数据，先做几次练习吧。</p>'}
      </div>

      <div class="card">
        <h3 class="report-h3">错题本（待攻克）</h3>
        ${mistakeRows ? `<ul class="mist-list">${mistakeRows}</ul>` : '<p class="hint" style="text-align:left">目前没有待重练的错题 🎉</p>'}
        ${active.length > 20 ? `<p class="hint" style="text-align:left">…还有 ${active.length - 20} 题未显示</p>` : ""}
      </div>

      <div class="card">
        <h3 class="report-h3">🤖 让 App 自我进化</h3>
        <p class="report-p">这个 App 是纯本地的，不会自己变聪明。进化循环是：<b>App 记录你的弱项 → 复制下面的指令发给 Claude → Claude 按弱项生成新内容更新仓库 → App 拉取新内容</b>。建议每 1-2 周做一次。</p>
        <button class="btn-primary" id="copy-claude" style="width:100%">复制给 Claude 的更新指令</button>
        <span class="copy-fb" id="fb-claude"></span>
      </div>

      <div class="card">
        <h3 class="report-h3">💾 进度备份（防换手机/清缓存丢失）</h3>
        <p class="report-p">学习进度只存在本机浏览器 localStorage。换设备或怕丢失时：导出备份 → 在新设备粘贴导入。</p>
        <div style="display:flex;gap:8px">
          <button class="btn-secondary" id="btn-export" style="flex:1">导出备份</button>
          <button class="btn-secondary" id="btn-import" style="flex:1">导入备份</button>
        </div>
        <span class="copy-fb" id="fb-backup"></span>
        <textarea id="backup-ta" rows="5" placeholder="导出：备份 JSON 会出现在这里并复制到剪贴板。导入：把备份 JSON 粘贴到这里再点「确认导入」。" hidden></textarea>
        <button class="btn-primary" id="btn-import-confirm" style="width:100%;margin-top:8px" hidden>确认导入（覆盖当前进度）</button>
      </div>
    </div>
  `);
  setView(node);

  node.querySelector("#copy-claude").addEventListener("click", () => {
    copyText(buildClaudePrompt(), node.querySelector("#fb-claude"));
  });
  const ta = node.querySelector("#backup-ta");
  node.querySelector("#btn-export").addEventListener("click", () => {
    const json = JSON.stringify(state);
    ta.hidden = false; ta.value = json;
    node.querySelector("#btn-import-confirm").hidden = true;
    copyText(json, node.querySelector("#fb-backup"));
  });
  node.querySelector("#btn-import").addEventListener("click", () => {
    ta.hidden = false; ta.value = "";
    node.querySelector("#btn-import-confirm").hidden = false;
    ta.focus();
  });
  node.querySelector("#btn-import-confirm").addEventListener("click", () => {
    try {
      const parsed = JSON.parse(ta.value);
      if (!parsed || typeof parsed !== "object" || !("totalSessions" in parsed)) throw new Error("不是有效的备份");
      state = Object.assign(defaultState(), parsed);
      saveState();
      node.querySelector("#fb-backup").textContent = "✅ 导入成功，正在刷新…";
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      node.querySelector("#fb-backup").textContent = "❌ 导入失败：" + e.message;
    }
  });

  setActions([btn("回到首页", "btn-primary", renderHome)]);
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
