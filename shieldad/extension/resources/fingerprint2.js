(() => {
  const result = { visitorId: '00000000000000000000000000000000', components: {} };
  function Fingerprint2() {}
  Fingerprint2.prototype.get = (cb) => { if (typeof cb === 'function') try { cb(result.visitorId, []); } catch {} };
  Fingerprint2.get = (_opts, cb) => {
    const fn = typeof _opts === 'function' ? _opts : cb;
    if (typeof fn === 'function') try { fn([]); } catch {}
    return Promise.resolve([]);
  };
  Fingerprint2.getPromise = () => Promise.resolve([]);
  Fingerprint2.x64hash128 = () => result.visitorId;
  globalThis.Fingerprint2 = Fingerprint2;
  globalThis.FingerprintJS = { load: () => Promise.resolve({ get: () => Promise.resolve(result) }) };
})();
