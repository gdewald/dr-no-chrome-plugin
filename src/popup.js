// popup.js — quick on/off toggle mirroring the `enabled` setting.

const enabledEl = document.getElementById('enabled');
const stateEl = document.getElementById('state');

function paintState(on) {
  stateEl.textContent = on ? 'On — medical searches are blocked.' : 'Off — nothing is blocked.';
}

chrome.storage.sync.get({ enabled: true }, (s) => {
  enabledEl.checked = s.enabled;
  paintState(s.enabled);
});

enabledEl.addEventListener('change', () => {
  const on = enabledEl.checked;
  chrome.storage.sync.set({ enabled: on }, () => paintState(on));
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL('src/options.html'));
});
