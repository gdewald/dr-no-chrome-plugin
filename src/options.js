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
  // can report model state itself — and the download button runs here because
  // starting a model download needs a user gesture.
  async function refreshAiStatus() {
    const api = typeof LanguageModel !== 'undefined' ? LanguageModel : null;
    if (!api) {
      els.aiStatus.textContent =
        'Not supported by this Chrome (needs Chrome 138+ with built-in AI). Keyword rules still work.';
      return;
    }
    let availability;
    try {
      availability = await api.availability();
    } catch (e) {
      availability = 'unavailable';
    }
    els.aiDownload.style.display = availability === 'downloadable' ? 'inline-block' : 'none';
    els.aiStatus.textContent =
      availability === 'available' ? 'Model ready — borderline searches are checked on-device.'
      : availability === 'downloading' ? 'Model downloading… borderline searches allowed until it finishes.'
      : availability === 'downloadable' ? 'Model not downloaded yet. Until then only the keyword rules apply.'
      : 'Model unavailable on this device (hardware requirements not met). Keyword rules still work.';
  }

  els.aiDownload.addEventListener('click', async () => {
    els.aiDownload.disabled = true;
    try {
      const session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            els.aiStatus.textContent = 'Downloading model… ' + Math.round(e.loaded * 100) + '%';
          });
        },
      });
      session.destroy(); // only needed to trigger the download
    } catch (e) {
      els.aiStatus.textContent = 'Model download failed: ' + e.message;
    }
    els.aiDownload.disabled = false;
    refreshAiStatus();
  });

  function load() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      els.enabled.checked = s.enabled;
      els.aiEnabled.checked = s.aiEnabled;
      els.extraKeywords.value = (s.extraKeywords || []).join('\n');
      els.extraSites.value = (s.extraSites || []).join('\n');
      renderCharacters(s.character || 'cat');
    });
    refreshAiStatus();
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
