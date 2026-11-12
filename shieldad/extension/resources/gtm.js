(() => {
  const noop = () => {};
  const dl = globalThis.dataLayer;
  if (!Array.isArray(dl)) return;
  const invoke = (item) => {
    if (item && typeof item.eventCallback === 'function') {
      try { setTimeout(() => { try { item.eventCallback(); } catch {} }, 1); } catch {}
    }
  };
  for (const item of dl) invoke(item);
  const origPush = dl.push.bind(dl);
  dl.push = function push(...args) {
    for (const item of args) invoke(item);
    return origPush(...args);
  };
  globalThis.google_tag_manager = globalThis.google_tag_manager || {};
  globalThis.gtag = globalThis.gtag || noop;
})();
