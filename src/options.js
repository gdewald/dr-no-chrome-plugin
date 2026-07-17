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
    aiTestQuery: document.getElementById('aiTestQuery'),
    aiTest: document.getElementById('aiTest'),
    aiTestResult: document.getElementById('aiTestResult'),
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
    if (state === 'available') {
      // Wake the background worker so it loads the model into memory now,
      // not on the first real search (a cold first prompt can be slow enough
      // to blow the content script's 3.5s budget and silently fall back).
      try {
        chrome.runtime.sendMessage({ type: 'DR_NO_AI_STATUS' }, () => chrome.runtime.lastError);
      } catch (e) { /* worker missing — the test button will say so */ }
    }
  }

  // "Test the arbiter": send the query down the real classification path
  // (message -> background worker -> model) and report verdict, latency, and
  // any error. Deliberately no timeout — unlike a real search, the point here
  // is to see how long the answer actually takes.
  els.aiTest.addEventListener('click', () => {
    const q = els.aiTestQuery.value.trim();
    if (!q) return;
    els.aiTest.disabled = true;
    els.aiTestResult.textContent = 'Asking… (a cold model can take several seconds)';
    const started = Date.now();
    chrome.runtime.sendMessage({ type: 'DR_NO_CLASSIFY', query: q }, (res) => {
      els.aiTest.disabled = false;
      const ms = Date.now() - started;
      if (chrome.runtime.lastError || !res) {
        els.aiTestResult.textContent =
          '✗ No answer from the background worker' +
          (chrome.runtime.lastError ? ' (' + chrome.runtime.lastError.message + ')' : '') +
          '. Try reloading the extension on chrome://extensions.';
        return;
      }
      if (res.verdict === 'unavailable') {
        els.aiTestResult.textContent =
          '✗ Arbiter unavailable after ' + ms + 'ms' + (res.error ? ' — ' + res.error : '') +
          '. Gray searches fall back to keyword-only behavior.';
        return;
      }
      els.aiTestResult.textContent =
        (res.verdict === 'yes' ? '🚫 YES — this search would be blocked' : '✓ NO — this search would be allowed') +
        ' (' + res.ms + 'ms, ' + (res.source === 'cache' ? 'cached verdict' : 'model') + ')' +
        (res.source === 'model' && res.ms > 3500
          ? '. Slower than the 3.5s search budget — a real search would have fallen back this time; now that the model is warm, try again.'
          : '.');
    });
  });

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
