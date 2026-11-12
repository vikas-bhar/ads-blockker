(() => {
  const data = globalThis.__shieldadScriptletData;
  try { delete globalThis.__shieldadScriptletData; } catch { globalThis.__shieldadScriptletData = undefined; }
  const actions = data?.a || data?.actions;
  const domainMap = data?.d || data?.domains;
  if (!domainMap || !Array.isArray(actions)) return;

  const host = String(location.hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || /^(?:.*\.)?(?:youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be|googlevideo\.com)$/i.test(host)) {
    return;
  }

  function hostMatchesWildcard(h, pattern) {
    const base = pattern.slice(0, -2);
    if (!base) return false;
    const suffixes = [];
    if (h.startsWith(`${base}.`)) suffixes.push(h.slice(base.length + 1));
    let from = 0;
    const marker = `.${base}.`;
    while (true) {
      const idx = h.indexOf(marker, from);
      if (idx < 0) break;
      suffixes.push(h.slice(idx + marker.length));
      from = idx + 1;
    }
    return suffixes.some((rest) => /^(?:[a-z]{2,24}|(?:co|com|org|net|gov|edu|ac)\.[a-z]{2})$/.test(rest));
  }

  const matchedIds = new Set();
  let current = host;
  while (current) {
    if (Object.prototype.hasOwnProperty.call(domainMap, current)) {
      for (const id of domainMap[current]) matchedIds.add(id);
    }
    const dot = current.indexOf('.');
    if (dot < 0) break;
    current = current.slice(dot + 1);
  }

  // Fast wildcard check by comparing domain labels ending in .* against host labels.
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const cand = `${labels.slice(i, j).join('.')}.*`;
      if (Object.prototype.hasOwnProperty.call(domainMap, cand) && hostMatchesWildcard(host, cand)) {
        for (const id of domainMap[cand]) matchedIds.add(id);
      }
    }
  }

  if (!matchedIds.size) return;

  function toMatcher(arg) {
    if (arg === undefined || arg === '') return null;
    const negated = arg.startsWith('!');
    const raw = negated ? arg.slice(1) : arg;
    let testFn;
    if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
      const last = raw.lastIndexOf('/');
      try {
        const re = new RegExp(raw.slice(1, last), raw.slice(last + 1).replace(/[gy]/g, ''));
        testFn = (s) => re.test(String(s || ''));
      } catch {
        return null;
      }
    } else {
      testFn = (s) => String(s || '').includes(raw);
    }
    return (s) => (negated ? !testFn(s) : testFn(s));
  }

  function resolvePropTarget(path) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return null;
    let obj = globalThis;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (!obj[key] || (typeof obj[key] !== 'object' && typeof obj[key] !== 'function')) {
        try { obj[key] = {}; } catch { return null; }
      }
      obj = obj[key];
    }
    return { owner: obj, prop: parts[parts.length - 1] };
  }

  function parseConstantValue(raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw === 'undefined') return undefined;
    if (raw === 'noopFunc') return () => {};
    if (raw === 'trueFunc') return () => true;
    if (raw === 'falseFunc') return () => false;
    if (raw === 'emptyObj') return {};
    if (raw === 'emptyArr') return [];
    if (raw === 'emptyStr' || raw === "''" || raw === '""') return '';
    if (/^-?\d+$/.test(raw)) {
      const n = Number(raw);
      if (Number.isSafeInteger(n)) return n;
    }
    return raw;
  }

  const abortErr = () => new ReferenceError('ShieldAd aborted script execution');

  function runSet(propPath, rawVal) {
    const val = parseConstantValue(rawVal);
    const target = resolvePropTarget(propPath);
    if (!target) return;
    try {
      const desc = Object.getOwnPropertyDescriptor(target.owner, target.prop);
      if (desc && !desc.configurable) return;
      Object.defineProperty(target.owner, target.prop, {
        configurable: true,
        enumerable: true,
        get: () => val,
        set: () => {}
      });
    } catch {}
  }

  function runAopr(propPath) {
    const target = resolvePropTarget(propPath);
    if (!target) return;
    try {
      const desc = Object.getOwnPropertyDescriptor(target.owner, target.prop);
      if (desc && !desc.configurable) return;
      Object.defineProperty(target.owner, target.prop, {
        configurable: true,
        get() { throw abortErr(); },
        set() {}
      });
    } catch {}
  }

  function runAopw(propPath) {
    const target = resolvePropTarget(propPath);
    if (!target) return;
    try {
      const desc = Object.getOwnPropertyDescriptor(target.owner, target.prop);
      if (desc && !desc.configurable) return;
      let val = desc ? desc.value : undefined;
      Object.defineProperty(target.owner, target.prop, {
        configurable: true,
        get: () => val,
        set() { throw abortErr(); }
      });
    } catch {}
  }

  function runAcs(propPath, needleArg) {
    const matcher = toMatcher(needleArg || '');
    const target = resolvePropTarget(propPath);
    if (!target) return;
    try {
      const desc = Object.getOwnPropertyDescriptor(target.owner, target.prop);
      if (desc && !desc.configurable) return;
      let currentVal = target.owner[target.prop];
      Object.defineProperty(target.owner, target.prop, {
        configurable: true,
        get() {
          const src = document.currentScript?.textContent || '';
          if (src && (!matcher || matcher(src))) throw abortErr();
          return currentVal;
        },
        set(v) { currentVal = v; }
      });
    } catch {}
  }

  function runNowoif(patternArg) {
    const matcher = toMatcher(patternArg || '');
    const origOpen = globalThis.open;
    if (typeof origOpen !== 'function') return;
    globalThis.open = new Proxy(origOpen, {
      apply(target, thisArg, args) {
        const url = String(args[0] || '');
        if (!matcher || matcher(url)) return null;
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runNostif(needleArg, delayArg) {
    const matcher = toMatcher(needleArg || '');
    const targetDelay = delayArg !== undefined && delayArg !== '' ? Number(delayArg) : NaN;
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = new Proxy(origSetTimeout, {
      apply(target, thisArg, args) {
        const fnText = String(args[0] || '');
        const ms = Number(args[1] || 0);
        const matchesText = !matcher || matcher(fnText);
        const matchesDelay = Number.isNaN(targetDelay) || ms === targetDelay;
        if (matchesText && matchesDelay) return 0;
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runBooster(isInterval, needleArg, delayArg, boostArg) {
    const matcher = toMatcher(needleArg || '');
    const targetDelay = delayArg !== undefined && delayArg !== '' ? Number(delayArg) : NaN;
    const boost = Math.max(0.01, Math.min(Number(boostArg) || 0.05, 1));
    const key = isInterval ? 'setInterval' : 'setTimeout';
    const orig = globalThis[key];
    globalThis[key] = new Proxy(orig, {
      apply(target, thisArg, args) {
        const fnText = String(args[0] || '');
        const ms = Number(args[1] || 0);
        if ((!matcher || matcher(fnText)) && (Number.isNaN(targetDelay) || ms >= targetDelay)) {
          args[1] = Math.max(1, Math.floor(ms * boost));
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runAeld(typeArg, needleArg) {
    const typeMatcher = toMatcher(typeArg || '');
    const fnMatcher = toMatcher(needleArg || '');
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = new Proxy(origAdd, {
      apply(target, thisArg, args) {
        const type = String(args[0] || '');
        const listener = args[1];
        const fnStr = typeof listener === 'function' ? String(listener) : '';
        if ((!typeMatcher || typeMatcher(type)) && (!fnMatcher || fnMatcher(fnStr))) {
          return undefined;
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runNoFetchIf(needleArg) {
    const matcher = toMatcher(needleArg || '');
    if (typeof globalThis.fetch !== 'function') return;
    globalThis.fetch = new Proxy(globalThis.fetch, {
      apply(target, thisArg, args) {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (!matcher || matcher(url)) {
          return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runNoXhrIf(needleArg) {
    const matcher = toMatcher(needleArg || '');
    const urls = new WeakMap();
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = new Proxy(origOpen, {
      apply(target, thisArg, args) {
        urls.set(thisArg, String(args[1] || ''));
        return Reflect.apply(target, thisArg, args);
      }
    });
    XMLHttpRequest.prototype.send = new Proxy(origSend, {
      apply(target, thisArg, args) {
        const url = urls.get(thisArg) || '';
        if (!matcher || matcher(url)) {
          try {
            Object.defineProperty(thisArg, 'readyState', { configurable: true, value: 4 });
            Object.defineProperty(thisArg, 'status', { configurable: true, value: 200 });
            Object.defineProperty(thisArg, 'responseText', { configurable: true, value: '' });
            Object.defineProperty(thisArg, 'response', { configurable: true, value: '' });
            thisArg.dispatchEvent(new Event('load'));
            thisArg.dispatchEvent(new Event('loadend'));
          } catch {}
          return undefined;
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runNoEvalIf(needleArg) {
    const matcher = toMatcher(needleArg || '');
    const origEval = globalThis.eval;
    globalThis.eval = new Proxy(origEval, {
      apply(target, thisArg, args) {
        const code = String(args[0] || '');
        if (!matcher || matcher(code)) return undefined;
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  function runRa(attrsArg, selectorArg) {
    const attrs = String(attrsArg || '').split('|').map((a) => a.trim()).filter(Boolean);
    const sel = selectorArg || `[${attrs.join('],[')}]`;
    if (!attrs.length) return;
    const strip = () => {
      try {
        for (const el of document.querySelectorAll(sel)) {
          for (const attr of attrs) el.removeAttribute(attr);
        }
      } catch {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', strip, { once: true });
    } else {
      strip();
    }
    new MutationObserver(strip).observe(document.documentElement || document, { childList: true, subtree: true });
  }

  function runNoWebRtc() {
    const noop = () => {};
    class BlockedPeerConnection {
      createDataChannel() { return {}; }
      createOffer() { return Promise.reject(new Error('Disabled')); }
      createAnswer() { return Promise.reject(new Error('Disabled')); }
      setLocalDescription() { return Promise.resolve(); }
      setRemoteDescription() { return Promise.resolve(); }
      addIceCandidate() { return Promise.resolve(); }
      close() {}
    }
    try {
      globalThis.RTCPeerConnection = BlockedPeerConnection;
      globalThis.webkitRTCPeerConnection = BlockedPeerConnection;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('Disabled'));
      void noop;
    } catch {}
  }

  for (const id of matchedIds) {
    const entry = actions[id];
    if (!Array.isArray(entry)) continue;
    const [name, a0, a1, a2] = entry;
    try {
      if (name === 'set') runSet(a0, a1);
      else if (name === 'aopr') runAopr(a0);
      else if (name === 'aopw') runAopw(a0);
      else if (name === 'acs') runAcs(a0, a1);
      else if (name === 'nowoif') runNowoif(a0);
      else if (name === 'nostif') runNostif(a0, a1);
      else if (name === 'nano-stb') runBooster(false, a0, a1, a2);
      else if (name === 'nano-sib') runBooster(true, a0, a1, a2);
      else if (name === 'aeld') runAeld(a0, a1);
      else if (name === 'no-fetch-if') runNoFetchIf(a0);
      else if (name === 'no-xhr-if') runNoXhrIf(a0);
      else if (name === 'noeval-if') runNoEvalIf(a0);
      else if (name === 'ra') runRa(a0, a1);
      else if (name === 'nowebrtc') runNoWebRtc();
    } catch {}
  }
})();
