// background.js — background worker (Chrome MV3 service worker / Firefox event
// page). Hosts the on-device AI arbiter that answers YES/NO for queries the
// static tiers found suspicious but couldn't call (the "gray zone" — see
// matchGray in detect.js).
//
// Two backends, picked at runtime:
//   - Chrome:  the built-in model (Gemini Nano) via the Prompt API
//     (LanguageModel global, Chrome 138+). Generative session, few-shot,
//     YES/NO parsing.
//   - Firefox: the AI Runtime via browser.trial.ml (Firefox ~134+,
//     experimental, "trialML" permission, needs extensions.ml.enabled in
//     about:config). Zero-shot classification — no prompt parsing at all.
//
// Everything is on-device for both. This file makes no network requests
// itself (each browser downloads and caches its own model); if no backend is
// usable, classify() reports "unavailable" and the content script falls back
// to the static verdict per shape.

// ---------------------------------------------------------------- Chrome ----

const SYSTEM_PROMPT =
  'You classify web search queries. Reply YES if the query is about human ' +
  'health: symptoms, illness, injury, medication, or self-diagnosis. ' +
  'Reply NO otherwise. Reply with exactly one word: YES or NO.';

// Small on-device models follow examples better than instructions. These pairs
// mirror the three gray-zone shapes: ambiguous body part + framing, sensation
// without a body part, and ambiguous medical-leaning keywords.
const FEW_SHOT = [
  { role: 'user', content: 'why does my back keep clicking' },
  { role: 'assistant', content: 'YES' },
  { role: 'user', content: 'why does my back button not work' },
  { role: 'assistant', content: 'NO' },
  { role: 'user', content: 'itchy all over' },
  { role: 'assistant', content: 'YES' },
  { role: 'user', content: 'bleeding edge tech' },
  { role: 'assistant', content: 'NO' },
  { role: 'user', content: 'birth control side effects' },
  { role: 'assistant', content: 'YES' },
  { role: 'user', content: 'side effects of old fuel on engine' },
  { role: 'assistant', content: 'NO' },
];

function chromePromptApi() {
  // Stable global since Chrome 138. Absent = not Chrome, or too old.
  return typeof LanguageModel !== 'undefined' ? LanguageModel : null;
}

// One shared base session, created lazily. Kept as a promise so concurrent
// classify() calls don't race to create two sessions; reset on failure so a
// transient error doesn't wedge the arbiter forever.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = createChromeSession().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function createChromeSession() {
  const api = chromePromptApi();
  if (!api) throw new Error('Prompt API not supported');
  if ((await api.availability()) !== 'available') {
    throw new Error('model not available');
  }
  const opts = {
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }].concat(FEW_SHOT),
  };
  try {
    // Deterministic decoding: same query, same verdict.
    return await api.create(Object.assign({ temperature: 0, topK: 1 }, opts));
  } catch (e) {
    // Some builds reject out-of-range sampling params; defaults still work.
    return api.create(opts);
  }
}

async function classifyChrome(key) {
  const base = await getSession();
  // Prompt against a clone so the shared session's context never accumulates
  // past queries (a session remembers its whole conversation). Clone failure
  // isn't fatal — fall back to prompting the base session directly.
  let session = base;
  if (base.clone) {
    try { session = await base.clone(); } catch (e) { session = base; }
  }
  try {
    const out = await session.prompt(key);
    return /^\s*yes/i.test(out) ? 'yes' : 'no';
  } finally {
    if (session !== base && session.destroy) session.destroy();
  }
}

// --------------------------------------------------------------- Firefox ----
//
// SCAFFOLD — untested against a live Firefox AI Runtime. The message contract,
// caching, and fallback behavior are identical to the Chrome path; only the
// model call differs. Validate label/threshold quality against the gray-zone
// twins in test/detect.test.html before trusting it.

// Zero-shot NLI classification: the model scores the query against candidate
// hypotheses — no generative prompt, no output parsing. First label is the
// "medical" hypothesis; verdict is YES when it wins with enough margin.
const ZERO_SHOT_LABELS = [
  'a question about human health, symptoms, illness, or medication',
  'not about human health',
];
const ZERO_SHOT_THRESHOLD = 0.5; // top-score floor for a YES; tune on real data

const FIREFOX_ENGINE = {
  taskName: 'zero-shot-classification',
  modelHub: 'huggingface',
  modelId: 'Xenova/nli-deberta-v3-xsmall', // ~70MB int8; small and NLI-tuned
};

function firefoxMlApi() {
  try {
    return typeof browser !== 'undefined' && browser.trial && browser.trial.ml
      ? browser.trial.ml
      : null;
  } catch (e) {
    return null;
  }
}

// Same lazy-promise pattern as the Chrome session. createEngine also triggers
// the model download on first use, so this is only ever called from a
// classification (or the options page's test box) — never eagerly at startup,
// to avoid downloading ~70MB without the user doing anything.
let enginePromise = null;

function getEngine() {
  if (!enginePromise) {
    enginePromise = createFirefoxEngine().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

async function createFirefoxEngine() {
  const api = firefoxMlApi();
  if (!api) throw new Error('trial.ml not supported');
  await api.createEngine(FIREFOX_ENGINE);
  return api;
}

async function classifyFirefox(key) {
  const api = await getEngine();
  const out = await api.runEngine({ args: [key, ZERO_SHOT_LABELS] });
  // transformers.js zero-shot shape: { labels: [...desc by score], scores: [...] }
  const medical =
    out && out.labels && out.labels[0] === ZERO_SHOT_LABELS[0] &&
    out.scores && out.scores[0] >= ZERO_SHOT_THRESHOLD;
  return medical ? 'yes' : 'no';
}

// ---------------------------------------------------------------- shared ----

const CACHE_KEY = 'aiVerdicts';
const CACHE_MAX = 500;

// Verdict cache in storage.session: survives worker teardown (Chrome kills the
// SW after ~30s idle) but not a browser restart. Keyed by normalized query,
// so a repeated search never waits on the model twice.
async function cacheGet(key) {
  const store = await chrome.storage.session.get(CACHE_KEY);
  const map = store[CACHE_KEY] || {};
  return map[key] || null;
}

async function cachePut(key, verdict) {
  const store = await chrome.storage.session.get(CACHE_KEY);
  let map = store[CACHE_KEY] || {};
  if (Object.keys(map).length >= CACHE_MAX) map = {}; // cheap reset beats LRU bookkeeping here
  map[key] = verdict;
  await chrome.storage.session.set({ [CACHE_KEY]: map });
}

// Classify one query. Resolves { verdict: 'yes'|'no', ms, source }; throws if
// no backend can run (the message handler maps that to 'unavailable' plus the
// error text, for the options page's diagnostics).
async function classify(query) {
  const key = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!key) return { verdict: 'no', ms: 0, source: 'empty' };

  const started = Date.now();
  const cached = await cacheGet(key);
  if (cached) return { verdict: cached, ms: Date.now() - started, source: 'cache' };

  let verdict;
  if (chromePromptApi()) verdict = await classifyChrome(key);
  else if (firefoxMlApi()) verdict = await classifyFirefox(key);
  else throw new Error('no on-device AI backend in this browser');

  await cachePut(key, verdict);
  return { verdict, ms: Date.now() - started, source: 'model' };
}

async function aiStatus() {
  const api = chromePromptApi();
  if (api) return api.availability(); // 'unavailable' | 'downloadable' | 'downloading' | 'available'
  if (firefoxMlApi()) return 'trial-ml'; // Firefox AI Runtime present; model fetched lazily
  return 'unsupported';
}

// Load the Chrome model into memory before the first real query needs it: a
// cold first prompt (fresh browser start, or right after the model download)
// can blow the content script's answer budget and silently fall back. Fire and
// forget — failure just means the first query pays the cold-start cost.
// Firefox is deliberately not warmed: createEngine would start a model
// download without any user action.
function warmup() {
  if (chromePromptApi()) getSession().catch(() => {});
}
chrome.runtime.onStartup.addListener(warmup);
chrome.runtime.onInstalled.addListener(warmup);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'DR_NO_CLASSIFY') {
    classify(msg.query).then(
      (r) => sendResponse({ verdict: r.verdict, ms: r.ms, source: r.source }),
      (err) => sendResponse({ verdict: 'unavailable', error: String((err && err.message) || err) })
    );
    return true; // keep the channel open for the async response
  }
  if (msg.type === 'DR_NO_AI_STATUS') {
    aiStatus().then(
      (status) => {
        if (status === 'available') warmup(); // options page is polling; get ready
        sendResponse({ status });
      },
      () => sendResponse({ status: 'unsupported' })
    );
    return true;
  }
});
