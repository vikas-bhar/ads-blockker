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
    selectors = [...new Set(selectors)].filter((selector) => {
      try { root.matches(selector); return true; } catch { return false; }
    });
    selectorBatches = [];
    // Validation above lets us safely group 600 selectors per CSS rule. This reduces
    // thousands of CSSOM rules and observer queries to a few efficient batches.
    for (let index = 0; index < selectors.length; index += 600) {
      selectorBatches.push(selectors.slice(index, index + 600).join(','));
    }
    style.textContent = selectorBatches.map((batch) => `${batch}{display:none !important;}`).join('\n');
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
    const roots = [...queued].filter((node) => node.isConnected);
    const rootSet = new Set(roots);
    queued = new Set();
    for (const addedRoot of roots) {
      // A parent query already includes this node; avoid rescanning nested additions.
      let ancestor = addedRoot.parentElement;
      let covered = false;
      while (ancestor) {
        if (rootSet.has(ancestor)) { covered = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (!covered) hideWithin(addedRoot);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node !== style) queued.add(node);
      }
    }
    if (queued.size && !frame) frame = requestAnimationFrame(flush);
  });

  api.runtime.sendMessage({ type: 'GET_COSMETIC', hostname: location.hostname }).then((response) => {
    selectors = Array.isArray(response?.selectors) ? response.selectors.filter((item) => typeof item === 'string') : [];
    installCss();
    hideWithin(root);
    // The stylesheet catches late elements natively; the observer adds an inline-style
    // fallback for pages that manipulate styles or shadow existing ad containers.
    observer.observe(root, { childList: true, subtree: true });
  }).catch(() => style.remove());
})();
