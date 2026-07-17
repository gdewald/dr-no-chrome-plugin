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

// If any keyword appears in the query, return the matched keyword; else null.
function matchMedicalKeyword(query, keywords) {
  if (!query) return null;
  const q = ' ' + query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.includes(' ')) {
      // multi-word phrase: substring match on the normalized query
      if (q.includes(' ' + k + ' ') || q.includes(k)) return kw;
    } else {
      // single word: whole-word match to avoid "std" matching "understand"
      if (q.includes(' ' + k + ' ')) return kw;
    }
  }
  return null;
}

// Expose for pages / tests.
if (typeof window !== 'undefined') {
  window.DR_NO_DETECT = { isBlockedSite, getSearchQuery, matchMedicalKeyword };
}
