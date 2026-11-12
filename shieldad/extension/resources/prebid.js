(() => {
  const pbjs = (globalThis.pbjs = globalThis.pbjs || {});
  const pending = Array.isArray(pbjs.que) ? pbjs.que : [];
  Object.assign(pbjs, {
    adUnits: pbjs.adUnits || [],
    que: {
      push(fn) {
        if (typeof fn === 'function') { try { fn(); } catch {} }
        return 0;
      }
    },
    cmd: {
      push(fn) {
        if (typeof fn === 'function') { try { fn(); } catch {} }
        return 0;
      }
    },
    addAdUnits() {},
    removeAdUnit() {},
    requestBids(opts) {
      if (opts && typeof opts.bidsBackHandler === 'function') {
        try { opts.bidsBackHandler({}); } catch {}
      }
    },
    setTargetingForGPTAsync() {},
    getAdserverTargeting() { return {}; },
    getBidResponses() { return {}; },
    setConfig() {},
    getConfig() { return {}; }
  });
  for (const fn of pending) pbjs.que.push(fn);
})();
