// options.js — load & save settings from chrome.storage.sync.
//
// Wrapped in an IIFE: data.js is a classic script that declares `CHARACTERS` at
// top level, and classic scripts share one global lexical scope. Declaring the
// same name here at top level would be a redeclaration SyntaxError and kill this
// whole file at parse time.
(function () {
  const { CHARACTERS } = window.DR_NO_DATA;

  const DEFAULTS = {
    enabled: true,
    aiEnabled: true,
    extraKeywords: [],
    extraSites: [],
    character: 'cat',
  };

  const els = {
    enabled: document.getElementById('enabled'),
    aiEnabled: document.getElementById('aiEnabled'),
    aiStatus: document.getElementById('aiStatus'),
    aiProgress: document.getElementById('aiProgress'),
    aiBar: document.getElementById('aiBar'),
    aiFill: document.getElementById('aiFill'),
    aiDownload: document.getElementById('aiDownload'),
    extraKeywords: document.getElementById('extraKeywords'),
    extraSites: document.getElementById('extraSites'),
    chars: document.getElementById('chars'),
    save: document.getElementById('save'),
    status: document.getElementById('status'),
  };

  // Build the character picker.
  function renderCharacters(selected) {
    els.chars.innerHTML = '';
    Object.keys(CHARACTERS).forEach((id) => {
      const label = document.createElement('label');
      label.className = 'char';

      const row = document.createElement('div');
      row.className = 'row';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'character';
      radio.value = id;
      radio.checked = id === selected;

      row.appendChild(radio);
      row.appendChild(document.createTextNode(' ' + CHARACTERS[id].name));

      const pre = document.createElement('pre');
      pre.textContent = CHARACTERS[id].art;

      label.appendChild(row);
      label.appendChild(pre);
      els.chars.appendChild(label);
    });
  }

  function linesToList(text) {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  // The Prompt API is exposed to extension pages directly, so the options page
  // can report model state itself — and the download button lives here because
  // starting a model download needs a user gesture.
  //
  // Download UX is driven by two signals at once:
  //  - downloadprogress events on the create() monitor. These only reach the
  //    create() call this page made, can be sparse, and die with the page, so
  //    they're a bonus: they upgrade the bar from indeterminate to a percentage.
  //  - a 2s availability() poll — the reliable signal. It catches downloads
  //    started on a previous visit, downloads finishing while the page is open,
  //    and progress events that never arrive.
  const AI_POLL_MS = 2000;
  // Last availability state painted. Ticks that observe the same state skip
  // repainting so they don't clobber a percentage or an error message.
  let paintedState = null;

  async function aiAvailability() {
    if (typeof LanguageModel === 'undefined') return 'unsupported';
    try {
      return await LanguageModel.availability();
    } catch (e) {
      return 'unavailable';
    }
  }

  function showProgressBar(pct) {
    els.aiProgress.style.display = 'block';
    if (pct == null) {
      els.aiBar.classList.add('indeterminate');
      els.aiFill.style.width = '30%';
    } else {
      els.aiBar.classList.remove('indeterminate');
      els.aiFill.style.width = pct + '%';
    }
  }

  function paintAiStatus(state) {
    els.aiDownload.style.display = state === 'downloadable' ? 'inline-block' : 'none';
    if (state === 'downloading') showProgressBar(null);
    else els.aiProgress.style.display = 'none';
    els.aiStatus.textContent =
      state === 'available' ? 'Model ready — borderline searches are checked on-device.'
      : state === 'downloading' ? 'Downloading model… It’s a few GB, so this can take several minutes. ' +
        'Chrome keeps downloading even if you close this page.'
      : state === 'downloadable' ? 'Model not downloaded yet. Until then only the keyword rules apply.'
      : state === 'unsupported' ? 'Not supported by this Chrome (needs Chrome 138+ with built-in AI). Keyword rules still work.'
      : 'Model unavailable on this device (hardware requirements not met). Keyword rules still work.';
  }

  async function aiTick() {
    const state = await aiAvailability();
    if (state === paintedState) return;
    paintedState = state;
    paintAiStatus(state);
  }

  els.aiDownload.addEventListener('click', async () => {
    // Paint before anything async: availability() can keep reporting
    // 'downloadable' for a while after the download has really started, and
    // the first progress event may be a long way off.
    paintedState = 'downloading';
    paintAiStatus('downloading');
    try {
      const session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            // Spec says loaded is a 0..1 fraction; some builds report bytes.
            const frac = e.total > 1 ? e.loaded / e.total : e.loaded;
            const pct = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
            showProgressBar(pct);
            els.aiStatus.textContent = 'Downloading model… ' + pct + '%';
          });
        },
      });
      session.destroy(); // only needed to trigger the download
      paintedState = null; // force the next tick to repaint (normally 'available')
      aiTick();
    } catch (e) {
      // Repaint from real state (restores the retry button), then overlay the
      // error; matching paintedState keeps ticks from wiping it.
      paintedState = await aiAvailability();
      paintAiStatus(paintedState);
      els.aiStatus.textContent = 'Model download failed: ' + e.message;
    }
  });

  setInterval(aiTick, AI_POLL_MS);

  function load() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      els.enabled.checked = s.enabled;
      els.aiEnabled.checked = s.aiEnabled;
      els.extraKeywords.value = (s.extraKeywords || []).join('\n');
      els.extraSites.value = (s.extraSites || []).join('\n');
      renderCharacters(s.character || 'cat');
    });
    aiTick();
  }

  function save() {
    const picked = document.querySelector('input[name="character"]:checked');
    const settings = {
      enabled: els.enabled.checked,
      aiEnabled: els.aiEnabled.checked,
      extraKeywords: linesToList(els.extraKeywords.value),
      extraSites: linesToList(els.extraSites.value).map((d) =>
        d.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      ),
      character: picked ? picked.value : 'cat',
    };
    chrome.storage.sync.set(settings, () => {
      els.status.classList.add('show');
      setTimeout(() => els.status.classList.remove('show'), 1500);
    });
  }

  els.save.addEventListener('click', save);
  load();
})();
