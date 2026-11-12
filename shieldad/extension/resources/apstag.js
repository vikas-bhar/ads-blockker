(() => {
  const noop = () => {};
  globalThis.apstag = {
    init: noop,
    fetchBids(_cfg, cb) { if (typeof cb === 'function') { try { cb([]); } catch {} } },
    setDisplayBids: noop,
    targetingKeys: () => [],
    renderImp: noop,
    debug: noop,
    _Q: []
  };
})();
