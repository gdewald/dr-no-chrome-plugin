// background.js — MV3 service worker. Hosts the on-device AI arbiter: Chrome's
// built-in model (Gemini Nano, via the Prompt API) answers YES/NO for queries
// the static tiers found suspicious but couldn't call (the "gray zone" — see
// matchGray in detect.js).
//
// Everything is on-device. This file makes no network requests; if the model
// isn't installed or the API isn't supported, classify() reports "unavailable"
// and the content script falls back to the static verdict (allow).

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

const CACHE_KEY = 'aiVerdicts';
const CACHE_MAX = 500;

function promptApi() {
  // Stable global since Chrome 138. Absent = unsupported Chrome.
  return typeof LanguageModel !== 'undefined' ? LanguageModel : null;
}

// One shared base session, created lazily. Kept as a promise so concurrent
// classify() calls don't race to create two sessions; reset on failure so a
// transient error doesn't wedge the arbiter forever.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function createSession() {
  const api = promptApi();
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

// Verdict cache in storage.session: survives service-worker teardown (the SW
// dies after ~30s idle) but not a browser restart. Keyed by normalized query,
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
// the model can't run (the message handler maps that to 'unavailable' plus the
// error text, for the options page's diagnostics).
async function classify(query) {
  const key = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!key) return { verdict: 'no', ms: 0, source: 'empty' };

  const started = Date.now();
  const cached = await cacheGet(key);
  if (cached) return { verdict: cached, ms: Date.now() - started, source: 'cache' };

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
    const verdict = /^\s*yes/i.test(out) ? 'yes' : 'no';
    await cachePut(key, verdict);
    return { verdict, ms: Date.now() - started, source: 'model' };
  } finally {
    if (session !== base && session.destroy) session.destroy();
  }
}

async function aiStatus() {
  const api = promptApi();
  if (!api) return 'unsupported';
  return api.availability(); // 'unavailable' | 'downloadable' | 'downloading' | 'available'
}

// Load the model into memory before the first real query needs it: a cold
// first prompt (fresh browser start, or right after the model download) can
// blow the content script's answer budget and silently fall back. Fire and
// forget — failure just means the first query pays the cold-start cost.
function warmup() {
  getSession().catch(() => {});
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
