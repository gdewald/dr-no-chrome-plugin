// detect.js — pure detection helpers. No DOM, no chrome APIs, so they're easy
// to reason about and test in isolation.

// True if `hostname` is exactly one of `domains` or a subdomain of one.
function isBlockedSite(hostname, domains) {
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => {
    const dom = d.toLowerCase();
    return host === dom || host.endsWith('.' + dom);
  });
}

// If `url` points at a recognized search engine's results page, return the
// decoded search terms; otherwise null.
function getSearchQuery(url, engines) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  for (const key in engines) {
    if (host.includes(key)) {
      const value = parsed.searchParams.get(engines[key]);
      return value && value.trim() ? value : null;
    }
  }
  return null;
}

// Reduce a query to " word word " so terms can be matched on whole-word
// boundaries: punctuation becomes spaces, runs of space collapse, and the
// padding lets a term at either end still match.
function normalizeQuery(query) {
  if (!query) return '';
  const cleaned = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? ' ' + cleaned + ' ' : '';
}

// First term of `terms` present in an already-normalized query, else null.
// Matches the bare term and its simple plural, so "headache" catches
// "headaches" and "knee" catches "knees".
function findTerm(normalized, terms) {
  if (!normalized || !terms) return null;
  for (const raw of terms) {
    const term = String(raw).toLowerCase().trim();
    if (!term) continue;
    if (normalized.includes(' ' + term + ' ')) return raw;
    if (normalized.includes(' ' + term + 's ')) return raw;
  }
  return null;
}

// Decide whether a search query is medical, in tiers:
//
//   1. a Tier 1 term, medical on its own      -> "diabetes"
//   2. a body part plus a sensation           -> "knee hurts"
//   3. a body part plus a question framing    -> "why does my knee click"
//
// Tiers 2 and 3 both require a body part. That requirement is the whole point:
// it is what keeps the vague framings from firing on "do i have to pay taxes".
// Returns a short description of the match for the block message, else null.
function matchMedical(query, lists) {
  const q = normalizeQuery(query);
  if (!q) return null;

  const strong = findTerm(q, lists.strong);
  if (strong) return strong;

  const part = findTerm(q, lists.bodyParts);
  if (!part) return null;

  // Tier 2 — any body part, disambiguated by a sensation.
  const sensation = findTerm(q, lists.sensations);
  if (sensation) return part + ' ' + sensation;

  // Tier 3 — a framing is weaker evidence than a sensation, so it only counts
  // against a body part with no everyday sense. "why does my knee click" yes;
  // "why does my back button not work" no.
  const vague = new Set((lists.ambiguousParts || []).map((p) => String(p).toLowerCase()));
  const solidPart = findTerm(
    q,
    lists.bodyParts.filter((p) => !vague.has(String(p).toLowerCase()))
  );
  if (solidPart) {
    const context = findTerm(q, lists.context);
    if (context) return context + ' ' + solidPart;
  }

  return null;
}

// Decide whether a query that matchMedical allowed is still suspicious enough
// to ask the on-device AI arbiter (the "gray zone"). Three shapes qualify:
//
//   - a medical-leaning phrase that also has
//     a non-medical life                       -> "side effects of ..."
//   - a sensation with no body part            -> "itchy all over"
//   - a body part plus a question framing
//     that tier 3 rejected as ambiguous        -> "why does my back keep clicking"
//
// These are exactly the queries the static tiers deliberately let through to
// avoid false positives ("side effects of old fuel on engine", "lump sum tax",
// "why does my back button not work") — a model can tell those apart where
// word lists cannot. Returns a short description of the suspicion for the
// block message, else null. A query that matchMedical already blocks is never
// gray.
function matchGray(query, lists) {
  if (matchMedical(query, lists)) return null;
  const q = normalizeQuery(query);
  if (!q) return null;

  const keyword = findTerm(q, lists.ambiguousKeywords || []);
  if (keyword) return keyword;

  const part = findTerm(q, lists.bodyParts);
  const sensation = findTerm(q, lists.sensations);
  if (sensation && !part) return sensation;

  if (part) {
    const context = findTerm(q, lists.context);
    if (context) return context + ' ' + part;
  }

  return null;
}

// Expose for pages / tests.
if (typeof window !== 'undefined') {
  window.DR_NO_DETECT = {
    isBlockedSite,
    getSearchQuery,
    normalizeQuery,
    findTerm,
    matchMedical,
    matchGray,
  };
}
