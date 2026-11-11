const api = globalThis.chrome || globalThis.browser;
const $ = (id) => document.getElementById(id);

let currentPaused = [];
let clearSavedTimer;

function setFeedback(text, isError = false) {
  const el = $('saved');
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(clearSavedTimer);
  if (text && !isError) {
    clearSavedTimer = setTimeout(() => { el.textContent = ''; }, 5000);
  }
}

function formatUpdated(ts) {
  if (!ts) return 'Bundled';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return 'Updated';
  }
}

function renderStatus(status) {
  if (!status) return;
  $('statNetwork').textContent = status.totalActiveRules.toLocaleString();
  $('statCosmetic').textContent = status.cosmeticGlobalCount.toLocaleString();
  $('statUpdated').textContent = formatUpdated(status.lastUpdate);

  const statsEl = $('customStats');
  if (status.customRulesError) {
    statsEl.textContent = `Browser rejected a custom rule: ${status.customRulesError}`;
    statsEl.className = 'hint status-hint error';
  } else if (status.customInvalidCount > 0) {
    statsEl.textContent = `Compiled ${status.customNetworkCount} network and ${status.customCosmeticCount} cosmetic rules (${status.customInvalidCount} unsupported or invalid lines skipped).`;
    statsEl.className = 'hint status-hint warn';
  } else if (status.customNetworkCount || status.customCosmeticCount) {
    statsEl.textContent = `Active custom rules: ${status.customNetworkCount} network, ${status.customCosmeticCount} cosmetic.`;
    statsEl.className = 'hint status-hint';
  } else {
    statsEl.textContent = '';
    statsEl.className = 'hint status-hint';
  }
}

function renderPaused(list) {
  currentPaused = [...list];
  const container = $('pausedList');
  container.replaceChildren();
  $('clearPaused').hidden = currentPaused.length === 0;
  if (!currentPaused.length) {
    const empty = document.createElement('span');
    empty.className = 'paused-empty';
    empty.textContent = 'No paused sites.';
    container.appendChild(empty);
    return;
  }
  for (const domain of currentPaused) {
    const chip = document.createElement('span');
    chip.className = 'paused-chip';
    const label = document.createElement('span');
    label.textContent = domain;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Resume ShieldAd on ${domain}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => removePaused(domain));
    chip.append(label, remove);
    container.appendChild(chip);
  }
}

async function removePaused(domain) {
  const next = currentPaused.filter((item) => item !== domain);
  const res = await api.runtime.sendMessage({ type: 'APPLY_SETTINGS', patch: { pausedSites: next } });
  if (!res?.ok) {
    setFeedback(res?.error || 'Could not update paused sites.', true);
    return;
  }
  renderPaused(res.settings.pausedSites || []);
  renderStatus(res.status);
  setFeedback(`Resumed protection on ${domain}.`);
}

async function load() {
  const [settingsRes, statusRes] = await Promise.all([
    api.runtime.sendMessage({ type: 'GET_SETTINGS' }),
    api.runtime.sendMessage({ type: 'GET_STATUS' })
  ]);
  if (!settingsRes?.ok) throw new Error(settingsRes?.error || 'Failed to load settings');
  const value = settingsRes.settings;
  $('customRules').value = value.customRules || '';
  $('allowlist').value = Array.isArray(value.allowlist) ? value.allowlist.join('\n') : '';
  renderPaused(value.pausedSites || []);
  if (statusRes?.ok) renderStatus(statusRes.status);
}

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const rawAllowLines = $('allowlist').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const res = await api.runtime.sendMessage({
      type: 'APPLY_SETTINGS',
      patch: {
        customRules: $('customRules').value,
        allowlist: rawAllowLines
      }
    });
    if (!res?.ok) throw new Error(res?.error || 'Could not save settings');
    const normalizedAllow = res.settings.allowlist || [];
    $('allowlist').value = normalizedAllow.join('\n');
    renderStatus(res.status);
    const skippedAllow = Math.max(0, rawAllowLines.length - normalizedAllow.length);
    if (!res.appliedCustom) {
      setFeedback('Saved allowlist, but the browser rejected a custom rule.', true);
    } else if (skippedAllow > 0 && normalizedAllow.length < rawAllowLines.length) {
      setFeedback('Saved. Some duplicate or invalid allowlist entries were normalized.');
    } else {
      setFeedback('Saved and applied.');
    }
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    $('save').disabled = false;
  }
});

$('clearPaused').addEventListener('click', async () => {
  const res = await api.runtime.sendMessage({ type: 'APPLY_SETTINGS', patch: { pausedSites: [] } });
  if (!res?.ok) {
    setFeedback(res?.error || 'Could not clear paused sites.', true);
    return;
  }
  renderPaused([]);
  renderStatus(res.status);
  setFeedback('Resumed protection on all paused sites.');
});

$('updateLists').addEventListener('click', async () => {
  $('updateLists').disabled = true;
  setFeedback('Downloading latest filter lists…');
  try {
    const result = await api.runtime.sendMessage({ type: 'UPDATE_FILTERS' });
    if (!result?.ok) throw new Error(result?.error || 'Update failed');
    const statusRes = await api.runtime.sendMessage({ type: 'GET_STATUS' });
    if (statusRes?.ok) renderStatus(statusRes.status);
    setFeedback(
      result.count > 0
        ? `Updated: ${result.count.toLocaleString()} new delta rules installed.`
        : 'Filter lists are already up to date.'
    );
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    $('updateLists').disabled = false;
  }
});

load().catch((error) => setFeedback(error.message, true));
