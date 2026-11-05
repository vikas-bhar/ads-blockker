const api = globalThis.chrome || globalThis.browser;
const $ = (id) => document.getElementById(id);
let tab;
let state;
let hostname = '';

function setSwitch(element, enabled) {
  element.classList.toggle('on', enabled);
  element.setAttribute('aria-checked', String(enabled));
}
function showMessage(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function hostOf(url) {
  try { return /^https?:$/.test(new URL(url).protocol) ? new URL(url).hostname.toLowerCase() : ''; }
  catch { return ''; }
}
function matches(list) {
  return list.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}
function render() {
  setSwitch($('power'), state.enabled);
  $('statusText').textContent = state.enabled ? 'Protection is on' : 'Protection is off';
  const paused = hostname && matches(state.pausedSites || []);
  setSwitch($('siteToggle'), paused);
  $('siteToggle').disabled = !hostname;
  $('hostname').textContent = hostname || 'Not available on browser pages';
  $('siteText').textContent = !state.enabled ? 'ShieldAd is paused everywhere' : paused ? `Paused on ${hostname}` : hostname ? `Protected on ${hostname}` : 'Network protection is active';
}

async function initialize() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  hostname = hostOf(tab?.url || '');
  const response = await api.runtime.sendMessage({ type: 'GET_SETTINGS' });
  state = response.settings;
  $('blockedCount').textContent = tab?.id ? await api.action.getBadgeText({ tabId: tab.id }) || '0' : '0';
  render();
}

$('power').addEventListener('click', async () => {
  state.enabled = !state.enabled;
  await api.storage.sync.set({ enabled: state.enabled });
  render();
});
$('siteToggle').addEventListener('click', async () => {
  if (!hostname) return;
  const paused = matches(state.pausedSites || []);
  const matchingDomain = (state.pausedSites || []).find((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  const root = hostname;
  state.pausedSites = paused ? state.pausedSites.filter((domain) => domain !== matchingDomain) : [...(state.pausedSites || []), root];
  await api.storage.sync.set({ pausedSites: state.pausedSites });
  render();
  showMessage(paused ? `Protection resumed on ${root}` : `Paused on ${root}; reload the tab to apply fully.`);
});
$('update').addEventListener('click', async () => {
  $('update').disabled = true;
  showMessage('Downloading the latest compiled lists…');
  try {
    const result = await api.runtime.sendMessage({ type: 'UPDATE_FILTERS' });
    if (!result?.ok) throw new Error(result?.error || 'Update failed');
    showMessage(`${result.count.toLocaleString()} updated network rules installed.`);
  } catch (error) { showMessage(error.message, true); }
  finally { $('update').disabled = false; }
});
$('options').addEventListener('click', () => api.runtime.openOptionsPage());
initialize().catch((error) => showMessage(error.message, true));
