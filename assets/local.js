/* ============================================================
   Sakha Local — on-device voice engine.
   Everything here runs inside the student's browser:
     speech -> text : Whisper (onnx-community/whisper-base) via transformers.js
     text -> speech : Kokoro 82M (onnx-community/Kokoro-82M-v1.0-ONNX) via kokoro-js
     reasoning      : Qwen2.5 0.5B Instruct (onnx-community) via transformers.js
   Open weights, downloaded once from Hugging Face, then cached by the browser.
   No API key, no quota, no server, works offline.
   ============================================================ */
window.SakhaLocal = (function () {
  "use strict";

  const TF_VER = "3.8.1";
  const TF_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TF_VER}`;
  const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
  // whisper-base when a GPU is available, whisper-tiny on CPU where it is ~4x faster
  const ASR_MODEL_GPU = "onnx-community/whisper-base";
  const ASR_MODEL_CPU = "onnx-community/whisper-tiny";
  const TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const LLM_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";

  const st = {
    lib: null, device: null,
    asr: null, tts: null, ttsKind: null, llm: null,
    loading: {}, errors: {},
  };

  let ctx = null;               // AudioContext
  let mic = null;               // MediaStream
  let proc = null, srcNode = null, muteNode = null;
  let listening = false, cb = null;
  let chunks = [], preRoll = [], capturing = false;
  let noiseFloor = 0.006, silenceMs = 0, speechMs = 0, utterMs = 0;
  let bargeMs = 0;
  let paused = false;        // true while the model is thinking
  let transcribing = false;  // true while Whisper is decoding
  let speechQueue = [];
  let playing = null, speakToken = 0, speaking = false;

  /* ---------------- helpers ---------------- */
  function hasWebGPU() { return typeof navigator !== "undefined" && !!navigator.gpu; }

  async function pickDevice() {
    if (st.device) return st.device;
    st.device = "wasm";
    try {
      if (hasWebGPU()) {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) st.device = "webgpu";
      }
    } catch (e) { /* fall back to wasm */ }
    return st.device;
  }

  async function loadLib() {
    if (!st.lib) {
      st.lib = await import(TF_CDN);
      try {
        st.lib.env.allowLocalModels = false;
        // the Cache API only exists in secure contexts; degrade quietly otherwise
        st.lib.env.useBrowserCache = (typeof caches !== "undefined" && !!caches.open);
      } catch (e) { /* older builds */ }
    }
    return st.lib;
  }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function resample(input, from, to) {
    if (from === to) return input;
    const ratio = to / from;
    const len = Math.max(1, Math.round(input.length * ratio));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const pos = i / ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const f = pos - i0;
      out[i] = input[i0] * (1 - f) + input[i1] * f;
    }
    return out;
  }

  function concat(list) {
    let n = 0;
    for (const c of list) n += c.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const c of list) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ---------------- progress ---------------- */
  function progressReporter(label, onProgress) {
    const files = new Map();
    return (p) => {
      if (!onProgress) return;
      if (p && p.status === "progress" && p.file) {
        files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        onProgress({ label, pct, file: p.file, loaded, total });
      } else if (p && p.status === "done" && onProgress) {
        onProgress({ label, pct: 100, file: p.file });
      }
    };
  }

  /* ---------------- speech to text ---------------- */
  async function loadASR({ onProgress } = {}) {
    if (st.asr) return st.asr;
    if (st.loading.asr) return st.loading.asr;
    st.loading.asr = (async () => {
      const lib = await loadLib();
      const device = await pickDevice();
      const dtype = device === "webgpu"
        ? { encoder_model: "fp16", decoder_model_merged: "q4" }
        : { encoder_model: "q8", decoder_model_merged: "q8" };
      const repo = device === "webgpu" ? ASR_MODEL_GPU : ASR_MODEL_CPU;
      st.asrRepo = repo;
      st.asr = await lib.pipeline("automatic-speech-recognition", repo, {
        dtype, device, progress_callback: progressReporter("Speech recognition", onProgress),
      });
      return st.asr;
    })().catch((e) => {
      st.errors.asr = e;
      st.loading.asr = null;
      throw e;
    });
    return st.loading.asr;
  }

  async function transcribe(float32, lang) {
    if (!st.asr) throw new Error("asr-not-loaded");
    const audio16 = resample(float32, ctx ? ctx.sampleRate : 48000, 16000);
    const opts = { task: "transcribe", chunk_length_s: 30 };
    if (lang) opts.language = String(lang).split("-")[0];
    const out = await st.asr(audio16, opts);
    return (out && out.text ? out.text : "").trim();
  }

  /* ---------------- text to speech ---------------- */
  const VOICES = {
    "en-IN": "af_heart", "en-US": "af_heart", "en-GB": "bf_emma",
    "hi-IN": "hf_alpha", "mr-IN": "hf_alpha", "bn-IN": "hf_alpha",
    "gu-IN": "hf_alpha", "kn-IN": "hf_alpha", "ml-IN": "hf_alpha",
    "ta-IN": "hf_alpha", "te-IN": "hf_alpha", "pa-IN": "hf_alpha",
    "fr-FR": "ff_siwis", "ja-JP": "jf_alpha", "zh-CN": "zf_xiaobei",
  };

  async function loadTTS({ onProgress, lang = "en-IN" } = {}) {
    if (st.tts) return st.tts;
    if (st.loading.tts) return st.loading.tts;
    st.loading.tts = (async () => {
      try {
        const mod = await import(KOKORO_CDN);
        const Kokoro = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS) || mod.default;
        if (!Kokoro || !Kokoro.from_pretrained) throw new Error("kokoro-missing");
        st.tts = await Kokoro.from_pretrained(TTS_MODEL, {
          dtype: "q8",
          device: "wasm",
          progress_callback: progressReporter("Voice (Kokoro)", onProgress),
        });
        st.ttsKind = "kokoro";
      } catch (e) {
        // fallback: MMS-TTS through transformers.js (lower quality, very reliable)
        const lib = await loadLib();
        const repo = String(lang).startsWith("hi") ? "Xenova/mms-tts-hin" : "Xenova/mms-tts-eng";
        st.tts = await lib.pipeline("text-to-speech", repo, {
          progress_callback: progressReporter("Voice (MMS)", onProgress),
        });
        st.ttsKind = "mms";
      }
      return st.tts;
    })().catch((e) => {
      st.errors.tts = e;
      st.loading.tts = null;
      throw e;
    });
    return st.loading.tts;
  }

  function cleanForSpeech(t) {
    return String(t)
      .replace(/```[\s\S]*?```/g, " code block ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/[|]/g, " ")
      .replace(/_{2,}/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function sentences(text) {
    const out = [];
    const parts = cleanForSpeech(text).split(/(?<=[.!?])\s+|\n+/);
    let cur = "";
    for (const s of parts) {
      if (!s.trim()) continue;
      if ((cur + " " + s).length > 240) {
        if (cur) out.push(cur.trim());
        cur = s.length > 240 ? s.slice(0, 240) : s;
      } else cur = cur ? cur + " " + s : s;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  async function synth(text, lang) {
    const voice = VOICES[lang] || "af_heart";
    if (st.ttsKind === "kokoro") {
      const out = await st.tts.generate(text, { voice });
      return { data: out.audio, rate: out.sampling_rate || 24000 };
    }
    const out = await st.tts(text);
    return { data: out.audio, rate: out.sampling_rate || 16000 };
  }

  function playRaw(data, rate) {
    return new Promise((resolve) => {
      const a = audio();
      const buf = a.createBuffer(1, data.length, rate);
      buf.copyToChannel(data, 0);
      const node = a.createBufferSource();
      node.buffer = buf;
      node.connect(a.destination);
      const done = () => { if (playing === node) playing = null; resolve(); };
      node.onended = done;
      playing = node;
      try { node.start(); } catch (e) { done(); }
    });
  }

  /** Queue speech; resolves when this utterance has finished. */
  async function say(text, { lang = "en-IN" } = {}) {
    if (!st.tts) throw new Error("tts-not-loaded");
    const my = ++speakToken;
    const parts = sentences(text);
    speaking = true;
    for (const p of parts) {
      if (my !== speakToken) return;
      let audioData;
      try {
        audioData = await synth(p, lang);
      } catch (e) {
        continue; // skip a bad sentence rather than stopping the whole answer
      }
      if (my !== speakToken) return;
      await playRaw(audioData.data, audioData.rate);
    }
    if (my === speakToken) speaking = false;
  }

  function stopSay() {
    speakToken++;
    speaking = false;
    speechQueue.length = 0;
    if (playing) {
      try { playing.stop(); } catch (e) { /* already stopped */ }
      playing = null;
    }
  }

  /* ---------------- the offline brain ---------------- */
  async function loadLLM({ onProgress } = {}) {
    if (st.llm) return st.llm;
    if (st.loading.llm) return st.loading.llm;
    st.loading.llm = (async () => {
      const lib = await loadLib();
      const device = await pickDevice();
      const attempts = device === "webgpu" ? ["q4f16", "q4"] : ["q4", "q8"];
      let lastErr = null;
      for (const dtype of attempts) {
        try {
          st.llm = await lib.pipeline("text-generation", LLM_MODEL, {
            dtype, device, progress_callback: progressReporter("Offline brain", onProgress),
          });
          return st.llm;
        } catch (e) {
          lastErr = e;   // some runtimes lack int4 kernels: try the next precision
        }
      }
      throw lastErr || new Error("llm-load-failed");
    })().catch((e) => {
      st.errors.llm = e;
      st.loading.llm = null;
      throw e;
    });
    return st.loading.llm;
  }

  async function generate(messages, onToken) {
    if (!st.llm) throw new Error("llm-not-loaded");
    const lib = await loadLib();
    const streamer = new lib.TextStreamer(st.llm.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t) => { if (t) onToken(t); },
    });
    const out = await st.llm(messages, {
      max_new_tokens: 420,
      do_sample: false,
      temperature: 0.4,
      streamer,
    });
    let text = "";
    if (out && out[0] && out[0].generated_text) {
      const g = out[0].generated_text;
      if (Array.isArray(g)) text = (g[g.length - 1] || {}).content || "";
      else text = String(g);
    }
    return text;
  }

  /* ---------------- microphone + voice activity detection ---------------- */
  async function startListening(callbacks = {}) {
    cb = callbacks;
    if (listening) return;
    const a = audio();
    mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    srcNode = a.createMediaStreamSource(mic);
    proc = a.createScriptProcessor(2048, 1, 1);
    muteNode = a.createGain();
    muteNode.gain.value = 0;                 // keep the graph alive without feedback
    srcNode.connect(proc);
    proc.connect(muteNode);
    muteNode.connect(a.destination);

    chunks = []; preRoll = []; capturing = false;
    silenceMs = 0; speechMs = 0; utterMs = 0; bargeMs = 0;

    proc.onaudioprocess = (ev) => {
      const buf = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const ms = (buf.length / a.sampleRate) * 1000;

      if (cb.onLevel) cb.onLevel(rms);

      // While the tutor is speaking we only listen for an interruption, so it
      // never transcribes its own voice. While it is thinking we listen to
      // nothing at all, so a question can't be queued over the top of another.
      if (speaking) {
        preRoll.push(new Float32Array(buf));
        if (preRoll.length > 8) preRoll.shift();
        if (rms > Math.max(0.018, noiseFloor * 2.5)) {
          bargeMs += ms;
          if (bargeMs > 260) {
            stopSay();
            speechMs = 0; silenceMs = 0; utterMs = 0;
            if (cb.onBargeIn) cb.onBargeIn();
            bargeMs = 0;
          }
        } else {
          bargeMs = 0;
        }
        return;
      }
      if (paused || transcribing) return;

      const threshold = Math.max(0.011, noiseFloor * 2.2);
      const isSpeech = rms > threshold;

      if (!capturing) {
        // keep a short pre-roll so the first syllable is never clipped
        preRoll.push(new Float32Array(buf));
        if (preRoll.length > 8) preRoll.shift();
        if (isSpeech) {
          speechMs += ms;
          if (speechMs > 90) {
            capturing = true;
            chunks = preRoll.slice();
            preRoll = [];
            utterMs = 0;
            silenceMs = 0;
            if (cb.onSpeechStart) cb.onSpeechStart();
          }
        } else {
          speechMs = 0;
          noiseFloor = noiseFloor * 0.97 + rms * 0.03;
        }
        return;
      }

      chunks.push(new Float32Array(buf));
      utterMs += ms;
      if (isSpeech) { silenceMs = 0; } else { silenceMs += ms; }

      if ((silenceMs > 750 && utterMs > 500) || utterMs > 20000) finish();
    };

    listening = true;
  }

  async function finish() {
    capturing = false;
    const data = concat(chunks);
    chunks = [];
    speechMs = 0; silenceMs = 0;
    if (data.length < 4000) return;
    transcribing = true;
    if (cb.onThinking) cb.onThinking();
    try {
      const text = await transcribe(data, cb.lang || "en-IN");
      if (text && text.replace(/[^a-zA-Z\u0900-\u097F]/g, "").length > 1) {
        if (cb.onFinal) cb.onFinal(text);
      } else if (cb.onEmpty) cb.onEmpty();
    } catch (e) {
      if (cb.onError) cb.onError(e);
    } finally {
      transcribing = false;
    }
  }

  function stopListening() {
    listening = false;
    capturing = false;
    chunks = [];
    if (proc) { try { proc.disconnect(); } catch (e) {} proc.onaudioprocess = null; proc = null; }
    if (srcNode) { try { srcNode.disconnect(); } catch (e) {} srcNode = null; }
    if (muteNode) { try { muteNode.disconnect(); } catch (e) {} muteNode = null; }
    if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
  }

  /* ---------------- status ---------------- */
  return {
    asrReady: () => !!st.asr,
    ttsReady: () => !!st.tts,
    llmReady: () => !!st.llm,
    device: () => st.device,
    asrRepo: () => st.asrRepo,
    ttsKind: () => st.ttsKind,
    isSpeaking: () => speaking,
    hasWebGPU,
    loadASR, loadTTS, loadLLM, generate,
    say, stopSay,
    startListening, stopListening,
    setLang: (l) => { if (cb) cb.lang = l; },
    setPaused: (v) => { paused = !!v; },
    errors: () => st.errors,
  };
})();
