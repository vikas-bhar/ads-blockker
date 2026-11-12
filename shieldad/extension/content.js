(() => {
  const api = globalThis.chrome || globalThis.browser;
  const root = document.documentElement;
  if (!root || (document.contentType && !document.contentType.includes('html'))) return;

  const style = document.createElement('style');
  style.dataset.shieldad = 'cosmetic';
  (document.head || root).appendChild(style);

  const originalDisplay = new WeakMap();
  const originalStyles = new WeakMap();
  let selectors = [];
  let selectorBatches = [];
  let styleRules = [];
  let proceduralRules = [];
  let queued = new Set();
  let frame = 0;
  let procTimer = 0;
  let active = false;
  let observerConnected = false;
  let lastUrl = location?.href || '';

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

  function ensureStyleAttached(force = false) {
    if (!active) return;
    if (!force && !style.textContent) return;
    const hostParent = document.head || root;
    if (!style.isConnected || (document.head && style.parentElement !== document.head)) {
      hostParent.appendChild(style);
    }
  }

  function buildStyleText(batches, customStyles) {
    const parts = batches.map((batch) => `${batch}{display:none !important;}`);
    for (const item of customStyles) {
      if (item && item.s && item.c) parts.push(`${item.s}{${item.c}}`);
    }
    return parts.join('\n');
  }

  function installCss(rawSelectors, rawStyles = []) {
    const deduped = [...new Set(rawSelectors)];
    const validStyles = [];
    for (const entry of rawStyles) {
      if (!entry || typeof entry.s !== 'string' || typeof entry.c !== 'string') continue;
      try {
        root.matches(entry.s);
        validStyles.push(entry);
      } catch {}
    }

    if (!deduped.length && !validStyles.length) {
      selectors = [];
      selectorBatches = [];
      styleRules = [];
      style.textContent = '';
      return;
    }

    ensureStyleAttached(true);
    const batchGroups = buildBatches(deduped);
    let batches = batchGroups.map((group) => group.join(','));
    style.textContent = buildStyleText(batches, validStyles);

    const expectedRules = batches.length + validStyles.length;
    if (style.sheet && style.sheet.cssRules.length !== expectedRules) {
      batches = batchGroups.flatMap((group) => repairBatch(group));
      style.textContent = buildStyleText(batches, validStyles);
    }

    selectors = deduped;
    selectorBatches = batches;
    styleRules = validStyles;
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

  function applyInlineStyle(element, cssText) {
    if (!originalStyles.has(element)) {
      const saved = [];
      for (const decl of cssText.split(';')) {
        const idx = decl.indexOf(':');
        if (idx <= 0) continue;
        const prop = decl.slice(0, idx).trim();
        saved.push({
          prop,
          value: element.style.getPropertyValue(prop),
          priority: element.style.getPropertyPriority(prop)
        });
      }
      originalStyles.set(element, saved);
    }
    element.dataset.shieldadStyled = '1';
    for (const decl of cssText.split(';')) {
      const idx = decl.indexOf(':');
      if (idx <= 0) continue;
      const prop = decl.slice(0, idx).trim();
      let val = decl.slice(idx + 1).trim();
      let prio = '';
      if (/!important$/i.test(val)) {
        val = val.replace(/\s*!important$/i, '').trim();
        prio = 'important';
      }
      element.style.setProperty(prop, val, prio);
    }
  }

  function unhideAll() {
    for (const element of root.querySelectorAll('[data-shieldad-hidden]')) {
      const prev = originalDisplay.get(element);
      delete element.dataset.shieldadHidden;
      if (prev && prev.value) element.style.setProperty('display', prev.value, prev.priority || '');
      else element.style.removeProperty('display');
    }
    for (const element of root.querySelectorAll('[data-shieldad-styled]')) {
      const saved = originalStyles.get(element);
      delete element.dataset.shieldadStyled;
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item.value) element.style.setProperty(item.prop, item.value, item.priority || '');
          else element.style.removeProperty(item.prop);
        }
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

  function matchOpValue(op, text) {
    if (op.literal !== undefined) return String(text || '').includes(op.literal);
    if (op.pattern !== undefined) {
      try {
        const re = new RegExp(op.pattern, op.flags || '');
        return re.test(String(text || ''));
      } catch {
        return false;
      }
    }
    return false;
  }

  function evaluateProcedural() {
    if (!active || !proceduralRules.length) return;
    const currentPath = `${location?.pathname || '/'}${location?.search || ''}`;

    for (const rule of proceduralRules) {
      try {
        const ops = Array.isArray(rule.o) ? rule.o : [];
        let skipRule = false;
        const remainingOps = [];
        for (const op of ops) {
          if (op.op === 'matches-path') {
            if (!matchOpValue(op, currentPath)) { skipRule = true; break; }
          } else {
            remainingOps.push(op);
          }
        }
        if (skipRule) continue;

        let elements;
        if (rule.b === '*' && remainingOps[0]?.op === 'xpath' && typeof document.evaluate === 'function') {
          const snap = document.evaluate(remainingOps.shift().expr, root, null, 7, null);
          elements = [];
          for (let i = 0; i < snap.snapshotLength; i += 1) {
            const node = snap.snapshotItem(i);
            if (node && node.nodeType === Node.ELEMENT_NODE) elements.push(node);
          }
        } else {
          elements = [...root.querySelectorAll(rule.b)];
        }

        for (const op of remainingOps) {
          if (!elements.length) break;
          if (op.op === 'has-text') {
            elements = elements.filter((el) => matchOpValue(op, el.textContent));
          } else if (op.op === 'min-text-length') {
            elements = elements.filter((el) => (el.textContent || '').trim().length >= op.min);
          } else if (op.op === 'matches-attr') {
            elements = elements.filter((el) => el.hasAttribute(op.attr) && matchOpValue(op, el.getAttribute(op.attr)));
          } else if (op.op === 'matches-css' || op.op === 'matches-css-before' || op.op === 'matches-css-after') {
            if (typeof getComputedStyle !== 'function') { elements = []; break; }
            const pseudo = op.op === 'matches-css-before' ? '::before' : op.op === 'matches-css-after' ? '::after' : null;
            elements = elements.filter((el) => matchOpValue(op, getComputedStyle(el, pseudo).getPropertyValue(op.prop)));
          } else if (op.op === 'has') {
            elements = elements.filter((el) => Boolean(el.querySelector(op.selector)));
          } else if (op.op === 'upward') {
            const up = new Set();
            for (const el of elements) {
              if (op.steps) {
                let target = el;
                for (let step = 0; step < op.steps && target; step += 1) target = target.parentElement;
                if (target && target !== root) up.add(target);
              } else if (op.selector) {
                const target = el.parentElement?.closest?.(op.selector);
                if (target && target !== root) up.add(target);
              }
            }
            elements = [...up];
          } else if (op.op === 'xpath' && typeof document.evaluate === 'function') {
            const next = new Set();
            for (const el of elements) {
              const snap = document.evaluate(op.expr, el, null, 7, null);
              for (let i = 0; i < snap.snapshotLength; i += 1) {
                const node = snap.snapshotItem(i);
                if (node && node.nodeType === Node.ELEMENT_NODE) next.add(node);
              }
            }
            elements = [...next];
          } else if (op.op === 'query') {
            const next = new Set();
            const sel = op.combinatorSelector.trim();
            for (const el of elements) {
              if (sel.startsWith('+')) {
                const target = el.nextElementSibling;
                const sub = sel.slice(1).trim();
                if (target && (!sub || target.matches(sub))) next.add(target);
              } else if (sel.startsWith('~')) {
                const sub = sel.slice(1).trim();
                let sib = el.nextElementSibling;
                while (sib) {
                  if (!sub || sib.matches(sub)) next.add(sib);
                  sib = sib.nextElementSibling;
                }
              } else {
                const sub = sel.replace(/^>\s*/, '');
                for (const found of el.querySelectorAll(sub)) next.add(found);
              }
            }
            elements = [...next];
          }
        }

        const act = rule.a || { type: 'hide' };
        for (const el of elements) {
          if (act.type === 'remove') {
            if (el !== root && el !== document.head && el !== document.body) el.remove();
          } else if (act.type === 'style' && act.css) {
            applyInlineStyle(el, act.css);
          } else {
            hideElement(el);
          }
        }
      } catch {}
    }
  }

  function scheduleProcedural() {
    if (!active || !proceduralRules.length || procTimer || typeof setTimeout !== 'function') return;
    procTimer = setTimeout(() => {
      procTimer = 0;
      evaluateProcedural();
    }, 80);
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
      let ancestor = addedRoot.parentElement;
      let covered = false;
      while (ancestor) {
        if (rootSet.has(ancestor)) { covered = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (!covered) hideWithin(addedRoot);
    }
    if (proceduralRules.length) scheduleProcedural();
  }

  const observer = new MutationObserver((mutations) => {
    if (!active) return;
    let removedStyle = false;
    let mutatedAttr = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        mutatedAttr = true;
        continue;
      }
      for (const node of mutation.removedNodes) {
        if (node === style) removedStyle = true;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node !== style) queued.add(node);
      }
    }
    if (removedStyle) ensureStyleAttached();
    if (queued.size && !frame) frame = requestAnimationFrame(flush);
    else if (mutatedAttr && proceduralRules.length) scheduleProcedural();
  });

  function setObserver(shouldObserve) {
    if (shouldObserve && !observerConnected) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: proceduralRules.length > 0
      });
      observerConnected = true;
    } else if (!shouldObserve && observerConnected) {
      observer.disconnect();
      observerConnected = false;
      queued.clear();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (procTimer && typeof clearTimeout === 'function') {
        clearTimeout(procTimer);
        procTimer = 0;
      }
    }
  }

  function applyCosmetic() {
    api.runtime.sendMessage({ type: 'GET_COSMETIC', hostname: location.hostname }).then((response) => {
      const list = Array.isArray(response?.selectors) ? response.selectors.filter((item) => typeof item === 'string') : [];
      const styles = Array.isArray(response?.styles) ? response.styles : [];
      const procedural = Array.isArray(response?.procedural) ? response.procedural : [];
      const shouldBeActive = response?.active !== false && (list.length > 0 || styles.length > 0 || procedural.length > 0);
      active = shouldBeActive;
      proceduralRules = procedural;
      if (!active) {
        installCss([], []);
        unhideAll();
        setObserver(false);
        return;
      }
      installCss(list, styles);
      hideWithin(root);
      evaluateProcedural();
      if (observerConnected) {
        setObserver(false);
      }
      setObserver(true);
    }).catch(() => {
      active = false;
      setObserver(false);
      style.remove();
    });
  }

  function onRouteChange() {
    if (!active) return;
    const href = location?.href || '';
    if (href !== lastUrl) {
      lastUrl = href;
      hideWithin(root);
      evaluateProcedural();
    }
  }

  applyCosmetic();

  if (typeof globalThis.addEventListener === 'function') {
    for (const evt of ['popstate', 'hashchange', 'yt-navigate-finish', 'yt-page-data-updated']) {
      globalThis.addEventListener(evt, onRouteChange);
    }
  }

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
