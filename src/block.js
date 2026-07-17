// block.js — content script. Runs at document_start on every page, decides
// whether this is a medical search or a medical site, and if so paints a
// full-screen ASCII overlay (hard block, no bypass). Queries the static tiers
// can't call get escalated to the on-device AI arbiter in background.js.

(function () {
  const {
    MEDICAL_KEYWORDS,
    CONTEXT_PHRASES,
    BODY_PARTS,
    AMBIGUOUS_PARTS,
    SENSATIONS,
    MEDICAL_DOMAINS,
    SEARCH_ENGINES,
    CHARACTERS,
  } = window.DR_NO_DATA;
  const { isBlockedSite, getSearchQuery, matchMedical, matchGray } = window.DR_NO_DETECT;

  const root = document.documentElement;

  // How long a gray-zone page stays hidden waiting for the arbiter before we
  // fall back to the static verdict (allow). Warm model answers in well under
  // a second; this bound only bites on a cold service worker + first prompt.
  const AI_TIMEOUT_MS = 3500;

  // Terms the user added themselves are Tier 1: they block on their own.
  function buildLists(extraKeywords) {
    return {
      strong: MEDICAL_KEYWORDS.concat(extraKeywords || []),
      context: CONTEXT_PHRASES,
      bodyParts: BODY_PARTS,
      ambiguousParts: AMBIGUOUS_PARTS,
      sensations: SENSATIONS,
    };
  }

  // Returns a reason string if the current page matches the given lists, else null.
  function reasonFor(extraKeywords, extraSites) {
    const domains = MEDICAL_DOMAINS.concat(extraSites || []);
    if (isBlockedSite(location.hostname, domains)) {
      return 'This looks like a medical site.';
    }
    const query = getSearchQuery(location.href, SEARCH_ENGINES);
    const hit = matchMedical(query, buildLists(extraKeywords));
    if (hit) return 'That search looks medical (“' + hit + '”).';
    return null;
  }

  // Ask the background worker's on-device model about a gray-zone query.
  // Resolves 'yes' | 'no' | 'unavailable'. Never rejects and never hangs — a
  // missing model, dead worker, or slow answer must not brick browsing, so
  // anything but a clear verdict falls back to 'unavailable' (= allow).
  function askArbiter(query) {
    return new Promise(function (resolve) {
      const timer = setTimeout(function () { resolve('unavailable'); }, AI_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ type: 'DR_NO_CLASSIFY', query: query }, function (res) {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !res) resolve('unavailable');
          else resolve(res.verdict);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve('unavailable');
      }
    });
  }

  // Hide the real page immediately (used the moment a built-in match is suspected,
  // so no medical content flashes before storage resolves).
  function hidePage() {
    root.style.setProperty('visibility', 'hidden', 'important');
  }
  function revealPage() {
    root.style.removeProperty('visibility');
  }

  function renderOverlay(reason, characterId) {
    const character = CHARACTERS[characterId] || CHARACTERS.cat;

    const overlay = document.createElement('div');
    overlay.id = 'dr-no-overlay';
    // Force visible even though we may have hidden <html>.
    overlay.style.setProperty('visibility', 'visible', 'important');

    const card = document.createElement('div');
    card.className = 'dr-no-card';

    const pre = document.createElement('pre');
    pre.className = 'dr-no-art';
    pre.textContent = character.art;

    const title = document.createElement('h1');
    title.className = 'dr-no-title';
    title.textContent = "Whoa there — let's not diagnose ourselves today. 🩺";

    const sub = document.createElement('p');
    sub.className = 'dr-no-sub';
    sub.textContent = reason + ' If you\'re actually worried, call a real human doctor.';

    const btn = document.createElement('button');
    btn.className = 'dr-no-btn';
    btn.type = 'button';
    btn.textContent = '← Take me back to safety';
    btn.addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.assign('https://www.google.com');
    });

    const foot = document.createElement('p');
    foot.className = 'dr-no-foot';
    foot.textContent = 'Blocked by Dr. No';

    card.appendChild(pre);
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(btn);
    card.appendChild(foot);
    overlay.appendChild(card);

    // documentElement is guaranteed to exist at document_start; body may not be.
    (document.body || root).appendChild(overlay);
    root.style.setProperty('overflow', 'hidden', 'important');
    revealPage(); // safe now: overlay covers everything, page stays scroll-locked
  }

  // Fast, storage-free check against built-in lists to suppress the flash.
  // Gray-zone pages hide too: if the arbiter ends up blocking, no medical
  // results should have flashed while it thought.
  const pageQuery = getSearchQuery(location.href, SEARCH_ENGINES);
  const builtinMatch = reasonFor([], []);
  if (builtinMatch || (pageQuery && matchGray(pageQuery, buildLists([])))) hidePage();

  chrome.storage.sync.get(
    { enabled: true, aiEnabled: true, extraKeywords: [], extraSites: [], character: 'cat' },
    function (settings) {
      if (!settings.enabled) {
        revealPage();
        return;
      }
      const reason = reasonFor(settings.extraKeywords, settings.extraSites);
      if (reason) {
        // A fixed-position overlay mounted onto <html> renders fine even before
        // <body> exists, so we can block immediately at document_start.
        renderOverlay(reason, settings.character);
        return;
      }

      // Static tiers said allow. If the query is gray — suspicious but not
      // provable from word lists — the on-device model gets the final word.
      const gray = settings.aiEnabled && pageQuery
        ? matchGray(pageQuery, buildLists(settings.extraKeywords))
        : null;
      if (!gray) {
        revealPage();
        return;
      }

      hidePage();
      askArbiter(pageQuery).then(function (verdict) {
        if (verdict === 'yes') {
          renderOverlay('That search looks medical (“' + gray + '” — confirmed on-device).', settings.character);
        } else {
          revealPage();
        }
      });
    }
  );
})();
