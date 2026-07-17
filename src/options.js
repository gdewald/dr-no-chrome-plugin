// options.js — load & save settings from chrome.storage.sync.

const { CHARACTERS } = window.DR_NO_DATA;

const DEFAULTS = { enabled: true, extraKeywords: [], extraSites: [], character: 'cat' };

const els = {
  enabled: document.getElementById('enabled'),
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
    label.innerHTML =
      '<div class="row"><input type="radio" name="character" value="' + id + '"' +
      (id === selected ? ' checked' : '') + '/> ' + CHARACTERS[id].name + '</div>' +
      '<pre></pre>';
    label.querySelector('pre').textContent = CHARACTERS[id].art;
    els.chars.appendChild(label);
  });
}

function linesToList(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    els.enabled.checked = s.enabled;
    els.extraKeywords.value = (s.extraKeywords || []).join('\n');
    els.extraSites.value = (s.extraSites || []).join('\n');
    renderCharacters(s.character || 'cat');
  });
}

function save() {
  const picked = document.querySelector('input[name="character"]:checked');
  const settings = {
    enabled: els.enabled.checked,
    extraKeywords: linesToList(els.extraKeywords.value),
    extraSites: linesToList(els.extraSites.value).map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
    character: picked ? picked.value : 'cat',
  };
  chrome.storage.sync.set(settings, () => {
    els.status.classList.add('show');
    setTimeout(() => els.status.classList.remove('show'), 1500);
  });
}

els.save.addEventListener('click', save);
load();
