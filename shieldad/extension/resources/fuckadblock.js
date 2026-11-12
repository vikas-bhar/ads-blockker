(() => {
  class AdBlockShim {
    constructor() { this._notDetected = []; }
    check() {
      for (const fn of this._notDetected) { try { fn(); } catch {} }
      return false;
    }
    emitEvent() { return this; }
    on(detected, fn) {
      if (!detected && typeof fn === 'function') {
        this._notDetected.push(fn);
        queueMicrotask(() => { try { fn(); } catch {} });
      }
      return this;
    }
    onDetected() { return this; }
    onNotDetected(fn) { return this.on(false, fn); }
    setOption() { return this; }
  }
  const inst = new AdBlockShim();
  globalThis.FuckAdBlock = AdBlockShim;
  globalThis.BlockAdBlock = AdBlockShim;
  globalThis.fuckAdBlock = inst;
  globalThis.blockAdBlock = inst;
  globalThis.sniffAdBlock = inst;
})();
