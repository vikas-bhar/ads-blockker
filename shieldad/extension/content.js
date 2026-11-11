(() => {
  const api = globalThis.chrome || globalThis.browser;
  const root = document.documentElement;
  if (!root || (document.contentType && !document.contentType.includes('html'))) return;

  const style = document.createElement('style');
  style.dataset.shieldad = 'cosmetic';
  (document.head || root).appendChild(style);

  const originalDisplay = new WeakMap();
  let selectors = [];
  let selectorBatches = [];
  let queued = new Set();
  let frame = 0;
  let active = false;
  let observerConnected = false;

  function buildBatches(list) {
    const batches = [];
    for (let index = 0; index < list.length; index += 600) {
      batches.push(list.slice(index, index + 600));
    }
    return batches;
  }

  function repairBatch(batch) {
    const joined = batch.join(',');
    try {
      root.matches(joined);
      return [joined];
    } catch {
      if (batch.length <= 1) return [];
      const mid = Math.floor(batch.length / 2);
      return [...repairBatch(batch.slice(0, mid)), ...repairBatch(batch.slice(mid))];
    }
  }

  function ensureStyleAttached() {
    if (!active || !style.textContent) return;
    if (!style.isConnected) {
      (document.head || root).appendChild(style);
    }
  }

  function installCss(rawSelectors) {
    const deduped = [...new Set(rawSelectors)];
    if (!deduped.length) {
      selectors = [];
      selectorBatches = [];
      style.textContent = '';
      return;
    }
    ensureStyleAttached();
    const batchGroups = buildBatches(deduped);
    let batches = batchGroups.map((group) => group.join(','));
    style.textContent = batches.map((batch) => `${batch}{display:none !important;}`).join('\n');

    // Fast path: if Blink/Gecko parsed every batch rule natively, zero per-selector JS matching is needed.
    if (style.sheet && style.sheet.cssRules.length !== batches.length) {
      batches = batchGroups.flatMap((group) => repairBatch(group));
      style.textContent = batches.map((batch) => `${batch}{display:none !important;}`).join('\n');
    }

    selectors = deduped;
    selectorBatches = batches;
  }

  function hideElement(element) {
    if (!originalDisplay.has(element)) {
      originalDisplay.set(element, {
        value: element.style.getPropertyValue('display'),
        priority: element.style.getPropertyPriority('display')
      });
    }
    element.dataset.shieldadHidden = '1';
    element.style.setProperty('display', 'none', 'important');
  }

  function unhideAll() {
    for (const element of root.querySelectorAll('[data-shieldad-hidden]')) {
      const prev = originalDisplay.get(element);
      delete element.dataset.shieldadHidden;
      if (prev && prev.value) {
        element.style.setProperty('display', prev.value, prev.priority || '');
      } else {
        element.style.removeProperty('display');
      }
    }
    if (root.dataset.shieldadHidden) {
      const prev = originalDisplay.get(root);
      delete root.dataset.shieldadHidden;
      if (prev && prev.value) root.style.setProperty('display', prev.value, prev.priority || '');
      else root.style.removeProperty('display');
    }
  }

  function hideWithin(addedRoot) {
    if (!active || !selectorBatches.length || addedRoot.nodeType !== Node.ELEMENT_NODE) return;
    for (const batch of selectorBatches) {
      try {
        if (addedRoot.matches(batch)) hideElement(addedRoot);
        for (const element of addedRoot.querySelectorAll(batch)) hideElement(element);
      } catch {}
    }
  }

  function flush() {
    frame = 0;
    if (!active) {
      queued = new Set();
      return;
    }
    ensureStyleAttached();
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
    if (!active) return;
    let removedStyle = false;
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node === style) removedStyle = true;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node !== style) queued.add(node);
      }
    }
    if (removedStyle) ensureStyleAttached();
    if (queued.size && !frame) frame = requestAnimationFrame(flush);
  });

  function setObserver(shouldObserve) {
    if (shouldObserve && !observerConnected) {
      observer.observe(root, { childList: true, subtree: true });
      observerConnected = true;
    } else if (!shouldObserve && observerConnected) {
      observer.disconnect();
      observerConnected = false;
      queued.clear();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
  }

  function applyCosmetic() {
    api.runtime.sendMessage({ type: 'GET_COSMETIC', hostname: location.hostname }).then((response) => {
      const list = Array.isArray(response?.selectors) ? response.selectors.filter((item) => typeof item === 'string') : [];
      const shouldBeActive = response?.active !== false && list.length > 0;
      active = shouldBeActive;
      if (!active) {
        installCss([]);
        unhideAll();
        setObserver(false);
        return;
      }
      installCss(list);
      hideWithin(root);
      setObserver(true);
    }).catch(() => {
      active = false;
      setObserver(false);
      style.remove();
    });
  }

  applyCosmetic();

  if (api.storage?.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (
        (area === 'sync' && ('enabled' in changes || 'pausedSites' in changes || 'allowlist' in changes || 'customRules' in changes)) ||
        (area === 'local' && ('cosmeticOverride' in changes || 'customRulesLocal' in changes || 'customRulesOverflow' in changes))
      ) {
        applyCosmetic();
      }
    });
  }
})();
