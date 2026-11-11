const api = globalThis.chrome || globalThis.browser;
const $ = (id) => document.getElementById(id);
let tab;
let state;
let statusInfo;
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
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function findMatchingDomain(list) {
  return (list || []).find((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function formatDate(ts) {
  if (!ts) return 'Built-in filter lists';
  try {
    return `Updated ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch {
    return 'Updated recently';
  }
}

function render() {
  const enabled = state.enabled !== false;
  setSwitch($('power'), enabled);
  $('statusText').textContent = enabled ? 'Protection is on' : 'Protection is off';

  const pausedMatch = hostname ? findMatchingDomain(state.pausedSites) : '';
  const allowMatch = hostname ? findMatchingDomain(state.allowlist) : '';
  const paused = Boolean(pausedMatch);
  const allowlisted = Boolean(allowMatch);

  setSwitch($('siteToggle'), paused);
  $('siteToggle').disabled = !hostname || allowlisted;
  $('hostname').textContent = allowlisted
    ? `${hostname} (allowed in Settings)`
    : hostname || 'Not available on browser pages';

  $('countCard').classList.toggle('paused', !enabled || paused || allowlisted);
  $('siteText').textContent = !enabled
    ? 'ShieldAd is paused everywhere'
    : allowlisted
      ? `Allowed in Settings (${allowMatch})`
      : paused
        ? `Paused on ${hostname}`
        : hostname
          ? `Protected on ${hostname}`
          : 'Network protection is active';

  if (statusInfo) {
    $('rulesMeta').textContent = enabled ? `${statusInfo.totalActiveRules.toLocaleString()} rules` : 'Paused';
    $('updateMeta').textContent = formatDate(statusInfo.lastUpdate);
  }
}

async function refreshTabCount() {
  if (!tab?.id) return;
  try {
    const res = await api.runtime.sendMessage({ type: 'GET_TAB_STATS', tabId: tab.id });
    if (res?.ok && Number.isFinite(res.blockedCount)) {
      $('blockedCount').textContent = String(res.blockedCount);
      return;
    }
  } catch {}
  try {
    const text = await api.action.getBadgeText({ tabId: tab.id });
    $('blockedCount').textContent = /^\d+$/.test(String(text || '').trim()) ? String(Number(text)) : '0';
  } catch {}
}

async function applyPatch(patch) {
  const response = await api.runtime.sendMessage({ type: 'APPLY_SETTINGS', patch });
  if (!response?.ok) throw new Error(response?.error || 'Could not update settings');
  state = response.settings;
  statusInfo = response.status;
  render();
}

async function initialize() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  hostname = hostOf(tab?.url || tab?.pendingUrl || '');
  const [settingsRes, statusRes] = await Promise.all([
    api.runtime.sendMessage({ type: 'GET_SETTINGS' }),
    api.runtime.sendMessage({ type: 'GET_STATUS' })
  ]);
  if (!settingsRes?.ok) throw new Error(settingsRes?.error || 'Could not load settings');
  state = settingsRes.settings;
  statusInfo = statusRes?.ok ? statusRes.status : null;
  render();
  await refreshTabCount();
  setInterval(() => { refreshTabCount().catch(() => {}); }, 1500);
}

$('power').addEventListener('click', async () => {
  $('power').disabled = true;
  try {
    await applyPatch({ enabled: !state.enabled });
    if (hostname && tab?.id) $('reloadBtn').hidden = false;
    showMessage(state.enabled ? 'Protection resumed.' : 'Protection paused everywhere.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    $('power').disabled = false;
  }
});

$('siteToggle').addEventListener('click', async () => {
  if (!hostname) return;
  $('siteToggle').disabled = true;
  try {
    const paused = Boolean(findMatchingDomain(state.pausedSites));
    const nextPaused = paused
      ? (state.pausedSites || []).filter((domain) => !(hostname === domain || hostname.endsWith(`.${domain}`)))
      : [...(state.pausedSites || []), hostname];
    await applyPatch({ pausedSites: nextPaused });
    if (tab?.id) $('reloadBtn').hidden = false;
    showMessage(paused ? `Protection resumed on ${hostname}` : `Paused on ${hostname}`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    $('siteToggle').disabled = !hostname || Boolean(findMatchingDomain(state.allowlist));
  }
});

$('reloadBtn').addEventListener('click', async () => {
  if (!tab?.id) return;
  await api.tabs.reload(tab.id);
  window.close();
});

$('update').addEventListener('click', async () => {
  $('update').disabled = true;
  showMessage('Downloading the latest compiled lists…');
  try {
    const result = await api.runtime.sendMessage({ type: 'UPDATE_FILTERS' });
    if (!result?.ok) throw new Error(result?.error || 'Update failed');
    const statusRes = await api.runtime.sendMessage({ type: 'GET_STATUS' });
    if (statusRes?.ok) statusInfo = statusRes.status;
    render();
    showMessage(
      result.count > 0
        ? `Updated: ${result.count.toLocaleString()} new delta rules installed.`
        : 'Filter lists are up to date.'
    );
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    $('update').disabled = false;
  }
});

$('options').addEventListener('click', () => api.runtime.openOptionsPage());

initialize().catch((error) => showMessage(error.message, true));
