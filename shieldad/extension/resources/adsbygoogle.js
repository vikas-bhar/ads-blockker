(() => {
  const prev = Array.isArray(globalThis.adsbygoogle) ? globalThis.adsbygoogle : [];
  const shim = {
    loaded: true,
    push(obj) {
      if (obj && typeof obj.callback === 'function') {
        try { obj.callback(); } catch {}
      }
      return prev.length;
    }
  };
  globalThis.adsbygoogle = shim;
  for (const item of prev) shim.push(item);
})();
