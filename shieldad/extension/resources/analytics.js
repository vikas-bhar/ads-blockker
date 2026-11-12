(() => {
  const gaName = globalThis.GoogleAnalyticsObject || 'ga';
  const prev = globalThis[gaName];
  const invokeHitCallback = (args) => {
    for (const arg of args) {
      if (arg && typeof arg === 'object' && typeof arg.hitCallback === 'function') {
        try { setTimeout(() => { try { arg.hitCallback(); } catch {} }, 1); } catch {}
      }
    }
  };
  function gaShim(...args) {
    invokeHitCallback(args);
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      try { last(gaShim.getAll()[0]); } catch {}
    }
  }
  const tracker = { get: () => '', set: () => {}, send: () => {} };
  gaShim.create = () => tracker;
  gaShim.getByName = () => tracker;
  gaShim.getAll = () => [tracker];
  gaShim.remove = () => {};
  gaShim.loaded = true;
  gaShim.l = Date.now();
  globalThis[gaName] = gaShim;
  if (prev && Array.isArray(prev.q)) {
    for (const q of prev.q) gaShim(...q);
  }
})();
