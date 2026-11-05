/* ============================================================
   Sakha Shiksha — free AI voice tutor for BTech (AI & Data Science)
   Voice in : Web Speech API (browser, free, unlimited, no key)
   Voice out: SpeechSynthesis (browser, free, unlimited, no key)
   Brain    : Pollinations open text API (keyless, CORS-open)
   ============================================================ */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------------- state ---------------- */
  const LS = "sakha-shiksha.v1";
  const state = {
    messages: [],          // {role, content}
    subject: "General",
    mode: "explain",
    lang: "en-IN",
    rate: 1.0,
    voiceName: "",
    handsFree: true,
    muted: false,
    key: "",
    provider: "pollinations",
    busy: false,
    listening: false,
    speaking: false,
  };

  const MODES = {
    explain: {
      label: "Explain simply",
      hint: "Teach me like I'm new to it, with an everyday analogy first.",
    },
    exam: {
      label: "Exam answer",
      hint: "Answer in exam style: definition, points, diagram described in words, then a short conclusion. Aim for a 10-mark answer.",
    },
    numerical: {
      label: "Solve numerical",
      hint: "Solve step by step: given data, formula, substitution, final answer with units. Show every step.",
    },
    quiz: {
      label: "Quiz me",
      hint: "Ask me ONE multiple-choice question with 4 options (A-D) on this topic, wait for my answer, then tell me if I'm right and why.",
    },
    viva: {
      label: "Viva / interview",
      hint: "Ask me one short viva question at a time like an examiner, and follow up on my answer.",
    },
    revise: {
      label: "Quick revision",
      hint: "Give a crisp revision sheet: key definitions, formulas, and 5 must-remember points. Keep it scannable.",
    },
  };

  const SUBJECTS = [
    "General", "Theory of Computation", "Data Communication & Networks",
    "AI Techniques", "Data Science & Analytics", "Machine Learning & Deep Learning",
    "Data Structures & Algorithms", "Operating Systems", "DBMS", "Mathematics for AI",
  ];

  const SUGGESTIONS = {
    "Theory of Computation": [
      "Explain DFA vs NFA with an example",
      "Prove a^n b^n is not regular",
      "What is the halting problem?",
      "Why is 3-SAT NP-complete?",
    ],
    "Data Communication & Networks": [
      "Explain the OSI model layer by layer",
      "Find subnets for 192.168.10.0/26",
      "Compare TCP and UDP",
      "Efficiency of stop-and-wait ARQ",
    ],
    "AI Techniques": [
      "Why is A* optimal with an admissible heuristic?",
      "Explain alpha-beta pruning",
      "How does Viterbi work in an HMM?",
      "Difference between forward and backward chaining",
    ],
    "Data Science & Analytics": [
      "Explain bias vs variance",
      "Precision vs recall with an example",
      "How does PCA work?",
      "When do I use a t-test?",
    ],
    "Machine Learning & Deep Learning": [
      "Explain backpropagation step by step",
      "CNN vs RNN vs Transformer",
      "What does batch normalisation do?",
      "How does dropout prevent overfitting?",
    ],
    "Data Structures & Algorithms": [
      "Quicksort vs mergesort",
      "Explain dynamic programming with an example",
      "Dijkstra vs Bellman-Ford",
      "Time complexity of heap operations",
    ],
    "Operating Systems": [
      "Explain deadlock and Banker's algorithm",
      "FCFS vs SJF vs Round Robin",
      "FIFO vs LRU page replacement",
      "What is thrashing?",
    ],
    "DBMS": [
      "Explain 1NF to BCNF with examples",
      "ACID properties explained",
      "B+ tree vs hash index",
      "Write a SQL query with GROUP BY and HAVING",
    ],
    "Mathematics for AI": [
      "How do I find eigenvalues?",
      "Explain Bayes theorem with an example",
      "What is a gradient?",
      "Binomial vs Poisson distribution",
    ],
    "General": [
      "Make me a 7-day study plan",
      "How do I answer a 10-mark question?",
      "Quiz me on anything from AI & DS",
      "Explain something I should know today",
    ],
  };

  /* ---------------- persistence ---------------- */
  function save() {
    try {
      localStorage.setItem(LS, JSON.stringify({
        messages: state.messages.slice(-80),
        subject: state.subject, mode: state.mode, lang: state.lang,
        rate: state.rate, voiceName: state.voiceName, handsFree: state.handsFree,
        key: state.key, provider: state.provider,
      }));
    } catch (e) { /* storage full or blocked — ignore */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(LS) || "{}");
      if (Array.isArray(d.messages)) state.messages = d.messages;
      ["subject", "mode", "lang", "rate", "voiceName", "key", "provider"].forEach(k => {
        if (d[k] !== undefined) state[k] = d[k];
      });
      if (d.handsFree !== undefined) state.handsFree = !!d.handsFree;
    } catch (e) { /* ignore */ }
  }

  /* ---------------- retrieval over the curriculum KB ---------------- */
  function retrieve(query, subject, k = 3) {
    const q = " " + query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
    const words = q.split(" ").filter(w => w.length > 2);
    if (!words.length) return [];
    const scored = [];
    for (const e of (window.KB || [])) {
      let s = 0;
      for (const kw of e.keywords) {
        if (q.includes(" " + kw + " ")) s += 6;
        else if (q.includes(kw)) s += 4;
      }
      for (const w of words) {
        if (e.title.toLowerCase().includes(w)) s += 3;
        if (e.text.toLowerCase().includes(w)) s += 1;
      }
      if (e.subject === subject) s += 5;
      if (s > 0) scored.push({ s, e });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, k).map(x => x.e);
  }

  /* ---------------- prompt ---------------- */
  function systemPrompt(query) {
    const hits = retrieve(query, state.subject, 3);
    const ctx = hits.length
      ? hits.map(e => `[${e.subject} · ${e.title}]\n${e.text}`).join("\n\n")
      : "(no specific notes matched — use your own knowledge)";

    const spoken = state.mode === "explain" || state.mode === "revise";

    return `You are Sakha, a patient, encouraging voice tutor for Indian BTech students in Artificial Intelligence & Data Science. You are being spoken aloud through a browser speech engine, so your answer must be easy to LISTEN to.

SUBJECT FOCUS: ${state.subject}
ANSWER STYLE: ${MODES[state.mode].hint}

WHAT YOU KNOW DEEPLY: Theory of Computation (DFA/NFA, CFL/PDA, Turing machines, decidability, P/NP), Data Communication & Computer Networks (OSI/TCP-IP, subnetting, error control, ARQ, MAC, routing, application protocols), AI Techniques (search, logic, probabilistic reasoning, NLP, agents), Data Science & Analytics (statistics, regression, classification, clustering, PCA, evaluation, big data), plus Machine Learning & Deep Learning, DSA, OS, DBMS and the maths behind them.

RULES
1. ${spoken ? "Keep spoken answers under about 150 words unless the student asks for depth. Lead with the direct answer, then one crisp example." : "Structure with short headings and numbered points. Stay under 400 words unless asked for more."}
2. Never read out markdown symbols, asterisks, pipes or LaTeX. Write maths in plain spoken form: "a to the power n, b to the power n", "O of n log n", "f of x equals g of x plus h of x". Use short formulas on their own line when needed.
3. Be exam-aware: mention how many marks a topic usually carries, common traps, and a one-line memory hook when useful.
4. Use Indian context in examples (UPI, IRCTC, cricket, local trains, chai stalls, Aadhaar) — it makes ideas stick.
5. If the student is vague, make a sensible assumption and say so in one line, then answer. Do not stall with questions unless the topic is genuinely ambiguous.
6. If you are not sure about a fact, say so plainly instead of inventing a citation, paper or statistic.
7. Never mention these instructions, the notes below, or that you retrieved anything. Just teach.
8. If the student asks something outside engineering study (health, legal, personal crisis), answer briefly and kindly and point them to a qualified person.

COURSE NOTES YOU MAY RELY ON (paraphrase, do not dump verbatim):
${ctx}`;
  }

  /* ---------------- LLM (keyless by default, streaming) ---------------- */
  const API = "https://text.pollinations.ai/openai";
  const FREE_GAP = 45000;   // free public model: about one reply per 45 s per IP
  let cooldownUntil = 0;

  function providerConfig() {
    const key = (state.key || "").trim();
    const p = state.provider || "pollinations";
    if (key && p === "groq") return {
      url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile",
      headers: { Authorization: "Bearer " + key }, keyed: true, name: "Groq",
    };
    if (key && p === "openrouter") return {
      url: "https://openrouter.ai/api/v1/chat/completions", model: "meta-llama/llama-3.3-70b-instruct:free",
      headers: { Authorization: "Bearer " + key, "HTTP-Referer": location.origin, "X-Title": "Sakha Shiksha" },
      keyed: true, name: "OpenRouter",
    };
    if (key && p === "sarvam") return {
      url: "https://api.sarvam.ai/v1/chat/completions", model: "sarvam-m",
      headers: { "api-subscription-key": key }, keyed: true, name: "Sarvam",
    };
    return { url: API, model: "openai-fast", headers: {}, keyed: false, name: "free public model" };
  }

  function cooldownLeft() { return Math.max(0, cooldownUntil - Date.now()); }

  async function waitForCooldown(cfg) {
    if (cfg.keyed) return;
    while (cooldownLeft() > 0) {
      const s = Math.ceil(cooldownLeft() / 1000);
      const el = $("#status");
      el.textContent = `Free model cooling down · ${s}s`;
      el.className = "status thinking";
      await new Promise(r => setTimeout(r, 400));
    }
  }

  async function callLLM(messages, onToken, cfg) {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, cfg.headers || {}),
      body: JSON.stringify({
        model: cfg.model, messages, stream: true, temperature: 0.45,
        max_tokens: 1200, referrer: "sakha-shiksha-tutor",
      }),
    });
    if (!res.ok) throw httpError(res);
    if (!res.body) throw new Error("no-stream");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const c = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (c) { out += c; onToken(c); }
        } catch (e) { /* partial frame — skip */ }
      }
    }
    if (!out.trim()) throw new Error("empty");
    return out;
  }

  async function httpError(res) {
    const err = new Error("HTTP " + res.status);
    if (res.status === 402 || res.status === 429) {
      let wait = 45;
      try {
        const raw = await res.text();
        const m = raw.match(/[Rr]etry after (\d+)/);
        if (m) wait = parseInt(m[1], 10);
      } catch (e) { /* keep default */ }
      err.retryAfter = wait + 2;
    }
    return err;
  }

  async function callLLMOnce(messages, cfg) {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, cfg.headers || {}),
      body: JSON.stringify({
        model: cfg.model, messages, temperature: 0.45, max_tokens: 1200,
        referrer: "sakha-shiksha-tutor",
      }),
    });
    if (!res.ok) throw httpError(res);
    const j = await res.json();
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!c || !c.trim()) throw new Error("empty");
    return c;
  }

  /* ---------------- speech output ---------------- */
  let ttsQueue = [], ttsSpeaking = false, ttsToken = 0, voices = [];

  function pickVoice() {
    if (!voices.length) return null;
    if (state.voiceName) {
      const v = voices.find(v => v.name === state.voiceName);
      if (v) return v;
    }
    const prefs = [
      v => /en-IN/i.test(v.lang) && /female|google|aditi|heera|kalpana|swara|neerja/i.test(v.name),
      v => /en-IN/i.test(v.lang),
      v => /hi-IN/i.test(v.lang) && state.lang === "hi-IN",
      v => /en-GB|en-US|en-AU/i.test(v.lang),
      v => /^en/i.test(v.lang),
    ];
    for (const p of prefs) { const v = voices.find(p); if (v) return v; }
    return voices[0];
  }

  function loadVoices() {
    voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const sel = $("#voiceSelect");
    if (!sel) return;
    sel.innerHTML = "";
    const list = voices.filter(v => /^(en|hi|ta|te|bn|mr|gu|kn|ml|pa|or)/i.test(v.lang));
    (list.length ? list : voices).forEach(v => {
      const o = document.createElement("option");
      o.value = v.name; o.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(o);
    });
    const chosen = pickVoice();
    if (chosen) { sel.value = chosen.name; state.voiceName = chosen.name; }
  }

  function cleanForSpeech(t) {
    return t
      .replace(/```[\s\S]*?```/g, " code block. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/\|/g, " ")
      .replace(/_{2,}/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function chunkSpeech(text) {
    const parts = [];
    const sentences = text.split(/(?<=[.!?])\s+|\n+/);
    let cur = "";
    for (const s of sentences) {
      if (!s.trim()) continue;
      if ((cur + " " + s).length > 180) {
        if (cur) parts.push(cur.trim());
        if (s.length > 180) {
          s.split(/,\s+|;\s+/).forEach(p => { if (p.trim()) parts.push(p.trim()); });
          cur = "";
        } else cur = s;
      } else cur = cur ? cur + " " + s : s;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }

  function speak(text, { onDone } = {}) {
    if (state.muted || !window.speechSynthesis) { if (onDone) onDone(); return; }
    const clean = cleanForSpeech(text);
    if (!clean) { if (onDone) onDone(); return; }
    chunkSpeech(clean).forEach(c => ttsQueue.push(c));
    if (onDone) ttsDoneCallback = onDone;
    pumpSpeech();
  }

  let ttsDoneCallback = null;

  function pumpSpeech() {
    if (ttsSpeaking) return;
    if (!ttsQueue.length) {
      state.speaking = false;
      updateStatus();
      const cb = ttsDoneCallback; ttsDoneCallback = null;
      if (cb) cb();
      return;
    }
    const myToken = ttsToken;
    const piece = ttsQueue.shift();
    const u = new SpeechSynthesisUtterance(piece);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = state.lang;
    u.rate = state.rate;
    u.pitch = 1.0;
    u.onstart = () => { state.speaking = true; updateStatus(); };
    u.onend = () => {
      if (myToken !== ttsToken) return;
      ttsSpeaking = false;
      pumpSpeech();
    };
    u.onerror = () => { if (myToken !== ttsToken) return; ttsSpeaking = false; pumpSpeech(); };
    ttsSpeaking = true;
    // watchdog: some engines never fire onend for long chunks
    const words = piece.split(/\s+/).length;
    const guard = setTimeout(() => {
      if (myToken !== ttsToken || !ttsSpeaking) return;
      ttsSpeaking = false;
      try { speechSynthesis.cancel(); } catch (e) {}
      pumpSpeech();
    }, Math.min(45000, 1500 + words * 420));
    u.onend = ((prev) => () => { clearTimeout(guard); prev(); })(u.onend);
    try { speechSynthesis.speak(u); } catch (e) { clearTimeout(guard); ttsSpeaking = false; }
  }

  function stopSpeaking() {
    ttsToken++;
    ttsQueue = [];
    ttsDoneCallback = null;
    ttsSpeaking = false;
    state.speaking = false;
    if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
    updateStatus();
  }

  /* ---------------- speech input ---------------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recFinal = "", recSilenceTimer = null, recWanted = false, lastHeard = "", emptyRestarts = 0;

  function initRecognition() {
    if (!SR) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      state.listening = true;
      stopSpeaking();
      updateStatus();
      setMic(true);
    };

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) recFinal += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      const live = (recFinal + " " + interim).trim();
      $("#liveTranscript").textContent = live;
      $("#liveTranscript").classList.toggle("show", !!live);
      clearTimeout(recSilenceTimer);
      recSilenceTimer = setTimeout(() => { if (recFinal.trim().length > 1) stopListening(); }, 2400);
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        toast("Microphone blocked. Allow mic access in your browser, or type your question.");
        recWanted = false;
      } else if (ev.error === "no-speech") {
        /* stay quiet, user simply paused */
      } else if (ev.error === "network") {
        toast("Speech recognition needs an internet connection.");
      }
    };

    rec.onend = () => {
      state.listening = false;
      setMic(false);
      updateStatus();
      const text = recFinal.trim();
      recFinal = "";
      $("#liveTranscript").classList.remove("show");
      $("#liveTranscript").textContent = "";
      if (text.length > 1 && text !== lastHeard) {
        lastHeard = text;
        emptyRestarts = 0;
        send(text, true);
      } else if (recWanted && state.handsFree && !state.busy && emptyRestarts < 1) {
        emptyRestarts++;
        setTimeout(() => { if (recWanted) startListening(); }, 400);
      } else if (!text.length) {
        recWanted = false;
      }
    };
  }

  function startListening() {
    if (!rec) { toast("This browser can't do speech recognition. Use Chrome or Edge, or type instead."); return; }
    if (state.busy) { toast("Still answering — give me a second."); return; }
    stopSpeaking();
    recWanted = true;
    recFinal = "";
    lastHeard = "";
    emptyRestarts = 0;
    rec.lang = state.lang;
    try { rec.start(); } catch (e) { /* already started */ }
  }

  function stopListening() {
    clearTimeout(recSilenceTimer);
    if (rec) { try { rec.stop(); } catch (e) {} }
  }

  function toggleMic() {
    if (state.listening) { recWanted = false; stopListening(); }
    else startListening();
  }

  /* ---------------- rendering ---------------- */
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function mdToHtml(src) {
    const blocks = [];
    let s = escapeHtml(src).replace(/```([\s\S]*?)```/g, (m, code) => {
      blocks.push(code.replace(/^[a-zA-Z0-9+#_-]{1,12}\n/, "").replace(/^\n+|\n+$/g, ""));
      return `\u0000B${blocks.length - 1}\u0000`;
    });

    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^\s*#{1,6}\s*(.+)$/gm, '<strong class="h">$1</strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/^\s*[-*+]\s+(.+)$/gm, "<li>$1</li>");
    s = s.replace(/^\s*(\d+)[.)]\s+(.+)$/gm, "<li>$2</li>");
    s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, m => "<ul>" + m + "</ul>");
    s = s.replace(/<ul>\s*<ul>/g, "<ul>").replace(/<\/ul>\s*<\/ul>/g, "</ul>");
    s = s.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
    s = s.replace(/<\/li>\s*<br>\s*/g, "</li>").replace(/<\/ul>\s*<br>\s*/g, "</ul>").replace(/<br>\s*<li>/g, "<li>");
    s = s.replace(/<p>\s*<li>/g, "<li>").replace(/<\/li>\s*<\/p>/g, "</li>").replace(/<\/li>\s*<p>\s*<li>/g, "</li><li>");
    s = "<p>" + s + "</p>";
    s = s.replace(/<p>\s*<\/p>/g, "");
    s = s.replace(/\u0000B(\d+)\u0000/g, (m, i) => `<pre><code>${blocks[+i]}</code></pre>`);
    s = s.replace(/<p>\s*<\/p>/g, "").replace(/<br>\s*<p>/g, "</p><p>");
    return s;
  }

  function addBubble(role, text, { streaming = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const who = document.createElement("div");
    who.className = "who";
    who.textContent = role === "user" ? "You" : "Sakha";
    const body = document.createElement("div");
    body.className = "bubble";
    body.innerHTML = mdToHtml(text || "");
    wrap.append(who, body);
    if (role === "assistant") {
      const acts = document.createElement("div");
      acts.className = "acts";
      const b1 = document.createElement("button");
      b1.textContent = "Replay";
      b1.onclick = () => { stopSpeaking(); speak(body.innerText); };
      const b2 = document.createElement("button");
      b2.textContent = "Copy";
      b2.onclick = () => copyText(body.innerText, b2);
      acts.append(b1, b2);
      wrap.appendChild(acts);
    }
    $("#chat").appendChild(wrap);
    scrollDown();
    return body;
  }

  function scrollDown() {
    const c = $("#chat");
    c.scrollTop = c.scrollHeight;
  }

  function copyText(t, btn) {
    navigator.clipboard.writeText(t).then(() => {
      const old = btn.textContent; btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = old; }, 1200);
    }).catch(() => {});
  }

  function renderAll() {
    $("#chat").innerHTML = "";
    if (!state.messages.length) { showWelcome(); return; }
    state.messages.forEach(m => addBubble(m.role, m.content));
  }

  function showWelcome() {
    const box = document.createElement("div");
    box.className = "welcome";
    box.innerHTML = `
      <h2>Namaste, I'm your voice tutor</h2>
      <p>Tap the mic and ask anything from Theory of Computation, Computer Networks,
      AI, Data Science — or any BTech AI &amp; DS subject. I answer out loud, and you can
      talk back.</p>
      <p class="tiny">Free forever · no login · no API key · unlimited questions</p>`;
    $("#chat").appendChild(box);
    renderSuggestions();
  }

  function renderSuggestions() {
    const bar = $("#suggestions");
    bar.innerHTML = "";
    const list = SUGGESTIONS[state.subject] || SUGGESTIONS.General;
    list.forEach(q => {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = q;
      b.onclick = () => send(q, false);
      bar.appendChild(b);
    });
  }

  function updateStatus() {
    const el = $("#status");
    let txt = "Ready", cls = "";
    if (state.listening) { txt = "Listening… speak now"; cls = "listening"; }
    else if (state.busy) { txt = "Thinking…"; cls = "thinking"; }
    else if (state.speaking) { txt = "Speaking… tap the mic to interrupt"; cls = "speaking"; }
    el.textContent = txt;
    el.className = "status " + cls;
    document.body.dataset.state = cls || "idle";
  }

  function setMic(on) {
    const b = $("#micBtn");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    $("#micLabel").textContent = on ? "Stop listening" : "Ask by voice";
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
  }

  /* ---------------- main turn ---------------- */
  async function send(text, fromVoice) {
    text = (text || "").trim();
    if (!text || state.busy) return;

    recWanted = false;
    stopListening();
    stopSpeaking();

    const welcome = $(".welcome");
    if (welcome) welcome.remove();
    $("#suggestions").innerHTML = "";

    state.messages.push({ role: "user", content: text });
    addBubble("user", text);
    save();

    state.busy = true;
    updateStatus();

    const body = addBubble("assistant", "");
    body.classList.add("typing");
    body.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';

    const history = state.messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
    const messages = [{ role: "system", content: systemPrompt(text) }, ...history];

    let acc = "";
    let speechBuf = "";
    let started = false;

    const flushSpeech = (force) => {
      const m = speechBuf.match(/[\s\S]*[.!?](\s|$)/);
      if (m && (m[0].length > 60 || force)) {
        const say = m[0];
        speechBuf = speechBuf.slice(say.length);
        if (say.trim()) speak(say.trim());
      }
    };

    const onToken = (chunk) => {
      acc += chunk;
      if (!started) { started = true; body.classList.remove("typing"); }
      body.innerHTML = mdToHtml(acc);
      speechBuf += chunk;
      if (!state.muted) flushSpeech(false);
      scrollDown();
    };

    const cfg = providerConfig();

    const attempt = async () => {
      acc = ""; speechBuf = ""; started = false;
      body.classList.add("typing");
      body.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      await callLLM(messages, onToken, cfg);
    };

    try {
      await waitForCooldown(cfg);
      const askStart = Date.now();
      try {
        await attempt();
      } catch (e1) {
        if (e1.retryAfter) {
          // throttled: wait exactly as long as the service asks, then retry once
          if (cfg.keyed) throw e1;
          cooldownUntil = Date.now() + e1.retryAfter * 1000;
          await waitForCooldown(cfg);
          await attempt();
        } else {
          // flaky stream: fall back to a single non-streaming request
          await new Promise(r => setTimeout(r, 900));
          acc = ""; speechBuf = "";
          const txt = await callLLMOnce(messages, cfg);
          acc = txt;
          body.classList.remove("typing");
          body.innerHTML = mdToHtml(acc);
        }
      }
      if (!cfg.keyed) cooldownUntil = askStart + FREE_GAP;
      body.classList.remove("typing");
      body.innerHTML = mdToHtml(acc);
      state.messages.push({ role: "assistant", content: acc });
      save();

      if (!state.muted) {
        const rest = speechBuf.trim();
        speechBuf = "";
        if (rest) speak(rest);
      }
    } catch (err) {
      body.classList.remove("typing");
      const msg = cfg.keyed
        ? `I couldn't reach ${cfg.name} with the API key saved in this browser. Check that the key is valid and that the provider allows browser (CORS) requests, or switch back to the free public model in “Why is this free?”.`
        : "The free public model is busy right now — it allows roughly one reply every 45 seconds, and shared networks can be slower. Wait half a minute and ask again; your question is saved.";
      body.innerHTML = mdToHtml(msg);
      if (!state.messages.length || state.messages[state.messages.length - 1].role !== "assistant") {
        state.messages.push({ role: "assistant", content: msg });
      }
      save();
      toast("Free service busy — please retry in a few seconds.");
    } finally {
      state.busy = false;
      updateStatus();
      // hands-free loop: listen again after the tutor finishes speaking
      if (fromVoice && state.handsFree) {
        const waitForSpeech = () => {
          if (state.speaking || ttsQueue.length) setTimeout(waitForSpeech, 500);
          else { recWanted = true; setTimeout(() => { if (state.handsFree) startListening(); }, 450); }
        };
        setTimeout(waitForSpeech, 300);
      }
    }
  }

  /* ---------------- UI wiring ---------------- */
  function buildSubjectChips() {
    const box = $("#subjectChips");
    box.innerHTML = "";
    SUBJECTS.forEach(s => {
      const b = document.createElement("button");
      b.className = "subj" + (s === state.subject ? " active" : "");
      b.textContent = s;
      b.onclick = () => {
        state.subject = s;
        save();
        $$(".subj").forEach(x => x.classList.toggle("active", x.textContent === s));
        $("#currentSubject").textContent = s;
        renderSuggestions();
        toast("Subject set to " + s);
      };
      box.appendChild(b);
    });
  }

  function buildModes() {
    const sel = $("#modeSelect");
    sel.innerHTML = "";
    Object.entries(MODES).forEach(([k, v]) => {
      const o = document.createElement("option");
      o.value = k; o.textContent = v.label;
      sel.appendChild(o);
    });
    sel.value = state.mode;
  }

  function wire() {
    $("#micBtn").onclick = toggleMic;
    $("#stopBtn").onclick = () => { recWanted = false; stopListening(); stopSpeaking(); state.handsFree = false; $("#handsFree").checked = false; updateStatus(); };
    $("#muteBtn").onclick = () => {
      state.muted = !state.muted;
      if (state.muted) stopSpeaking();
      $("#muteBtn").textContent = state.muted ? "Unmute" : "Mute";
      $("#muteBtn").classList.toggle("active", state.muted);
    };

    $("#composer").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("#textInput").value;
      if (!v.trim()) { startListening(); return; }
      $("#textInput").value = "";
      send(v, false);
    });

    $("#modeSelect").onchange = (e) => { state.mode = e.target.value; save(); };
    $("#langSelect").onchange = (e) => { state.lang = e.target.value; save(); if (state.listening) { stopListening(); } };
    $("#voiceSelect").onchange = (e) => { state.voiceName = e.target.value; save(); stopSpeaking(); speak("Hello, I am your voice tutor."); };
    $("#rate").oninput = (e) => { state.rate = parseFloat(e.target.value); $("#rateVal").textContent = state.rate.toFixed(1) + "x"; save(); };
    $("#handsFree").onchange = (e) => { state.handsFree = e.target.checked; save(); };

    $("#newBtn").onclick = () => {
      if (state.messages.length && !confirm("Start a fresh session? This clears the current chat.")) return;
      state.messages = []; save(); stopSpeaking(); recWanted = false; stopListening();
      renderAll();
    };

    $("#exportBtn").onclick = () => {
      if (!state.messages.length) { toast("Nothing to save yet."); return; }
      const md = `# Sakha Shiksha session — ${state.subject}\n_${new Date().toLocaleString("en-IN")}_\n\n` +
        state.messages.map(m => `## ${m.role === "user" ? "Me" : "Sakha"}\n${m.content}`).join("\n\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = "sakha-shiksha-notes.md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };

    $("#aboutBtn").onclick = () => {
      $("#keyProvider").value = state.provider || "pollinations";
      $("#keyInput").value = state.key || "";
      $("#aboutModal").classList.add("show");
    };
    $("#saveKey").onclick = () => {
      const p = $("#keyProvider").value;
      const k = $("#keyInput").value.trim();
      state.provider = p;
      state.key = (p === "pollinations") ? "" : k;
      cooldownUntil = 0;
      save();
      toast(state.key ? "Using your own " + p + " key from now on." : "Using the free public model.");
    };
    $("#clearKey").onclick = () => {
      state.key = ""; state.provider = "pollinations";
      $("#keyInput").value = ""; $("#keyProvider").value = "pollinations";
      cooldownUntil = 0; save();
      toast("Switched back to the free public model.");
    };
    $("#closeAbout").onclick = () => $("#aboutModal").classList.remove("show");
    $("#aboutModal").addEventListener("click", (e) => {
      if (e.target.id === "aboutModal") $("#aboutModal").classList.remove("show");
    });

    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && !e.target.closest("select")) {
        e.preventDefault(); toggleMic();
      }
      if (e.key === "Escape") { recWanted = false; stopListening(); stopSpeaking(); }
    });

    window.addEventListener("beforeunload", () => { try { speechSynthesis.cancel(); } catch (e) {} });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    load();
    buildModes();
    buildSubjectChips();
    wire();
    initRecognition();

    $("#currentSubject").textContent = state.subject;
    $("#langSelect").value = state.lang;
    $("#rate").value = state.rate;
    $("#rateVal").textContent = state.rate.toFixed(1) + "x";
    $("#handsFree").checked = state.handsFree;

    if (window.speechSynthesis) {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    if (!SR) {
      toast("Voice input needs Chrome or Edge. Typing works everywhere.");
      $("#micBtn").classList.add("disabled");
    }

    renderAll();
    updateStatus();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
