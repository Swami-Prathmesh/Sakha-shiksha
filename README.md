# Sakha Shiksha — Free AI Voice Tutor for BTech (AI & Data Science)

*Sakha* (सखा) means friend. This is the study friend you can talk to at 2 a.m.,
for free, as many times as you like.

Talk to your tutor. It answers out loud, and you can talk back.

**Live app:** https://swami-prathmesh.github.io/Sakha-shiksha/

No login. No API key. No payment. No question limit.

---

## What it does

A single-page voice tutor for BTech students in **Artificial Intelligence & Data
Science**. Tap the mic, ask a question, and the tutor answers in speech while the
text appears on screen. Turn on hands-free mode and it becomes a real conversation:
it listens, answers, then listens again.

Subjects covered in depth:

| Area | Topics |
|---|---|
| Theory of Computation | DFA/NFA, subset construction, pumping lemma, Myhill–Nerode, CFG/PDA, CFL closure, Turing machines, decidability, halting problem, Rice's theorem, P/NP, NP-completeness, Chomsky hierarchy |
| Data Communication & Networks | OSI & TCP/IP, encapsulation, TCP vs UDP, handshake, congestion control, IPv4/subnetting/CIDR/VLSM, IPv6, CRC/Hamming/checksum, ARQ efficiency formulas, ALOHA/CSMA-CD/CA, Ethernet framing, routing (RIP/OSPF/BGP), DNS/HTTP/DHCP/email |
| AI Techniques | BFS/DFS/UCS/A*, admissibility & consistency, alpha–beta pruning, CSP, propositional & first-order logic, resolution, Bayes nets, HMM/Viterbi, agents & PEAS, expert systems, NLP pipeline |
| Data Science & Analytics | descriptive stats, CLT, hypothesis testing, linear & logistic regression, KNN/SVM/trees/ensembles, K-means/DBSCAN, PCA, bias–variance, cross-validation, imbalanced data, big data & Hadoop/Spark, analytics types |
| Machine Learning & Deep Learning | perceptron, backpropagation, activations, optimisers, dropout/batchnorm, CNN, RNN/LSTM/GRU, transformers & self-attention, GANs, autoencoders, transfer learning |
| Core BTech support | DSA, Operating Systems, DBMS, Mathematics for AI (linear algebra, calculus, probability) |
| Study skills | exam answer structure, revision plans, viva prep |

Six answer modes: **Explain simply**, **Exam answer**, **Solve numerical**,
**Quiz me**, **Viva/interview**, **Quick revision**. Choose a subject and the
tutor grounds its answer in the matching course notes bundled in
`assets/knowledge.js`.

## Two engines: cloud and on-device

The sidebar has a **Voice engine** switch. Both are free; they trade speed for privacy.

| | Cloud engine (default) | On-device engine |
|---|---|---|
| Speech → text | Browser Web Speech API | **Whisper** (`whisper-tiny` on CPU, `whisper-base` on GPU) |
| Text → speech | Browser speech synthesis | **Kokoro 82M** (optional) or the browser voice |
| Reasoning | Shared keyless model | Cloud model, or **Qwen2.5 0.5B** offline |
| Internet needed | Yes | No, once the models are cached |
| Your audio leaves the device | To the browser's speech service | Never |
| Speed | Instant | Seconds — it runs on your CPU/GPU |

Everything on-device is open-weight, downloaded from Hugging Face on first use and
cached by the browser. No key, no quota, no server:

| Model | Purpose | Size | Licence |
|---|---|---|---|
| `onnx-community/whisper-tiny` | speech to text (CPU) | ~41 MB | MIT |
| `onnx-community/whisper-base` | speech to text (WebGPU) | ~77 MB | MIT |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | text to speech, 24 kHz | ~86 MB | Apache-2.0 |
| `onnx-community/Qwen2.5-0.5B-Instruct` | offline reasoning | ~480 MB | Apache-2.0 |

Run through `@huggingface/transformers` (transformers.js) and `kokoro-js` from jsDelivr,
entirely in the browser via WebAssembly or WebGPU.

### What the on-device mode actually feels like

Measured in a throttled headless Chrome with no GPU, so treat these as worst-case:

- Whisper-tiny: ~15 s to transcribe 3 s of audio. A normal laptop is several times
  faster; a WebGPU machine much faster still.
- Kokoro, q8 on CPU: ~48 s to synthesise a 5 s sentence. This is why Kokoro is
  **off by default on CPU-only machines** — you still get on-device *listening*,
  with the browser's own voice for speaking, and the download stays at 41 MB.
- The offline brain is a 0.5B model. It is fine for definitions, formulas and
  short explanations, and weak at multi-step reasoning. The cloud model is better;
  use the offline brain when there is no internet.

GitHub Pages cannot send COOP/COEP headers, so `SharedArrayBuffer` is unavailable
and ONNX Runtime Web runs single-threaded. That is the main reason on-device is
slower than a native app, and it is a hosting limitation, not a bug.

## How it stays free and unlimited

| Part | Technology | Cost |
|---|---|---|
| Speech → text | Browser **Web Speech API** (`SpeechRecognition`) | Free, no key, runs in the browser |
| Text → speech | Browser **SpeechSynthesis** | Free, no key, runs in the browser |
| Reasoning | **Pollinations** open text API (`text.pollinations.ai/openai`) | Free, keyless, CORS-open |
| Hosting | **GitHub Pages** | Free for public repos |

Nothing here has a per-minute meter, a credit balance or a signup wall, so a
student can use it for a whole semester.

### An honest note on limits

- **Sarvam AI** makes excellent Indian-language voice models (Saarika ASR, Bulbul
  TTS), but their API requires a key with billing attached. That is not "100% free
  and unlimited" for a public app, so this project uses the browser's own voice
  stack instead. If you later get Sarvam credits, swapping in `saarika`/`bulbul`
  is a contained change inside `assets/app.js`.
- The keyless model endpoint is a **shared public service**. Under heavy load it
  can rate-limit a request for a few seconds. The app retries once automatically;
  after that, wait ten seconds and ask again. That is the honest trade-off for
  having no key and no bill.
- Speech recognition works in **Chrome, Edge and Safari**. Firefox does not
  implement it — typing still works there. On iPhone, Safari speaks answers but
  voice input support varies by iOS version.

## Run it yourself

```bash
git clone https://github.com/Swami-Prathmesh/Sakha-shiksha.git
cd Sakha-shiksha
python3 -m http.server 8080
# open http://localhost:8080
```

Speech APIs need `https://` or `localhost`. GitHub Pages gives you HTTPS free.

## Deploying

The site is static and lives at the repository root, so GitHub Pages serves it
directly:

```bash
git push origin main
# Settings → Pages → Source: Deploy from a branch → main / (root)
```

Live URL: `https://swami-prathmesh.github.io/Sakha-shiksha/`

## Add your own notes

Open `assets/knowledge.js` and append an object:

```js
{
  id: "my-topic",
  subject: "Theory of Computation",
  title: "Topic name",
  keywords: ["keyword", "another keyword"],
  text: "The explanation you want the tutor to rely on."
}
```

Retrieval is keyword-scored, so include the words a student would actually say.
Notes are injected into the prompt as grounding context, not read out verbatim.

## Project layout

```
index.html               UI shell
assets/style.css         design system
assets/app.js            speech I/O, streaming LLM call, retrieval, UI logic
assets/local.js          on-device engine: Whisper, Kokoro, Qwen, VAD, duplex loop
assets/knowledge.js      curriculum knowledge base (30+ topic notes)
sw.js                    offline shell cache
manifest.webmanifest     installable PWA
```

## Privacy

The chat transcript and settings live in `localStorage` on the student's own
device. Nothing is stored on a server. The only data that leaves the browser is
the question text sent to the model to generate an answer.

## Roadmap ideas

- Add solved previous-year papers per university (AKTU, VTU, Anna University, SPPU)
- A spaced-repetition queue that re-asks topics you got wrong in quiz mode
- Optional Sarvam `saarika` ASR / `bulbul` TTS for Indic-language voices
- Streaming Kokoro synthesis so the first sentence plays while the rest generates

## License

MIT — free to fork for your own college or study group.
