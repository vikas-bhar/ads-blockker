const api = globalThis.chrome || globalThis.browser;
const customRules = document.getElementById('customRules');
const allowlist = document.getElementById('allowlist');
const saved = document.getElementById('saved');

async function load() {
  const value = await api.storage.sync.get({ customRules: '', allowlist: [] });
  customRules.value = value.customRules || '';
  allowlist.value = Array.isArray(value.allowlist) ? value.allowlist.join('\n') : value.allowlist || '';
}
document.getElementById('save').addEventListener('click', async () => {
  const lines = allowlist.value.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  await api.storage.sync.set({ customRules: customRules.value, allowlist: [...new Set(lines)] });
  saved.textContent = 'Saved. Reload open tabs to apply cosmetic changes.';
  setTimeout(() => { saved.textContent = ''; }, 4000);
});
load().catch((error) => { saved.textContent = error.message; });
