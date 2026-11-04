(() => {
  const api = globalThis.chrome || globalThis.browser;
  const root = document.documentElement;
  if (!root) return;
  const style = document.createElement('style');
  style.dataset.shieldad = 'cosmetic';
  (document.head || root).appendChild(style);
  let selectors = [];
  let selectorBatches = [];
  let queued = new Set();
  let frame = 0;

  function installCss() {
    selectors = selectors.filter((selector) => {
      try { root.matches(selector); return true; } catch { return false; }
    });
    selectorBatches = [];
    for (let index = 0; index < selectors.length; index += 150) selectorBatches.push(selectors.slice(index, index + 150).join(','));
    // One selector per rule prevents an unsupported selector from invalidating other rules.
    style.textContent = selectors.map((selector) => `${selector}{display:none !important;}`).join('\n');
  }

  function hideWithin(addedRoot) {
    if (addedRoot.nodeType !== Node.ELEMENT_NODE) return;
    for (const batch of selectorBatches) {
      if (addedRoot.matches(batch)) addedRoot.style.setProperty('display', 'none', 'important');
      for (const element of addedRoot.querySelectorAll(batch)) element.style.setProperty('display', 'none', 'important');
    }
  }

  function flush() {
    frame = 0;
    const roots = [...queued];
    queued = new Set();
    for (const addedRoot of roots) hideWithin(addedRoot);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) queued.add(node);
    }
    if (queued.size && !frame) frame = requestAnimationFrame(flush);
  });

  api.runtime.sendMessage({ type: 'GET_COSMETIC', hostname: location.hostname }).then((response) => {
    selectors = Array.isArray(response?.selectors) ? response.selectors.filter((item) => typeof item === 'string') : [];
    installCss();
    hideWithin(root);
    observer.observe(root, { childList: true, subtree: true });
  }).catch(() => style.remove());
})();
