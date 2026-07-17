// block.js — content script. Runs at document_start on every page, decides
// whether this is a medical search or a medical site, and if so paints a
// full-screen ASCII overlay (hard block, no bypass).

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
  const { isBlockedSite, getSearchQuery, matchMedical } = window.DR_NO_DETECT;

  const root = document.documentElement;

  // Returns a reason string if the current page matches the given lists, else null.
  function reasonFor(extraKeywords, extraSites) {
    const domains = MEDICAL_DOMAINS.concat(extraSites || []);
    if (isBlockedSite(location.hostname, domains)) {
      return 'This looks like a medical site.';
    }
    const query = getSearchQuery(location.href, SEARCH_ENGINES);
    // Terms the user added themselves are Tier 1: they block on their own.
    const hit = matchMedical(query, {
      strong: MEDICAL_KEYWORDS.concat(extraKeywords || []),
      context: CONTEXT_PHRASES,
      bodyParts: BODY_PARTS,
      ambiguousParts: AMBIGUOUS_PARTS,
      sensations: SENSATIONS,
    });
    if (hit) return 'That search looks medical (“' + hit + '”).';
    return null;
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
  const builtinMatch = reasonFor([], []);
  if (builtinMatch) hidePage();

  chrome.storage.sync.get(
    { enabled: true, extraKeywords: [], extraSites: [], character: 'cat' },
    function (settings) {
      if (!settings.enabled) {
        revealPage();
        return;
      }
      const reason = reasonFor(settings.extraKeywords, settings.extraSites);
      if (!reason) {
        revealPage();
        return;
      }
      // A fixed-position overlay mounted onto <html> renders fine even before
      // <body> exists, so we can block immediately at document_start.
      renderOverlay(reason, settings.character);
    }
  );
})();
