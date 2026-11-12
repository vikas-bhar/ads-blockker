(() => {
  const noop = () => {};
  const slot = {
    addService() { return slot; },
    clearCategoryExclusions() { return slot; },
    clearTargeting() { return slot; },
    defineSizeMapping() { return slot; },
    get() { return null; },
    getAdUnitPath() { return ''; },
    getAttributeKeys() { return []; },
    getCategoryExclusions() { return []; },
    getDomId() { return ''; },
    getResponseInformation() { return null; },
    getSlotElementId() { return ''; },
    getTargeting() { return []; },
    getTargetingKeys() { return []; },
    set() { return slot; },
    setCategoryExclusion() { return slot; },
    setClickUrl() { return slot; },
    setCollapseEmptyDiv() { return slot; },
    setForceSafeFrame() { return slot; },
    setSafeFrameConfig() { return slot; },
    setTargeting() { return slot; }
  };
  const service = {
    addEventListener() { return service; },
    clear() {},
    clearCategoryExclusions() { return service; },
    clearTargeting() { return service; },
    collapseEmptyDivs() {},
    disableInitialLoad() {},
    display() {},
    enableAsyncRendering() {},
    enableLazyLoad() {},
    enableSingleRequest() {},
    enableSyncRendering() {},
    enableVideoAds() {},
    get() { return null; },
    getAttributeKeys() { return []; },
    getSlots() { return []; },
    getTargeting() { return []; },
    getTargetingKeys() { return []; },
    refresh() {},
    set() { return service; },
    setCategoryExclusion() { return service; },
    setCentering() {},
    setCookieOptions() { return service; },
    setForceSafeFrame() { return service; },
    setLocation() { return service; },
    setPrivacySettings() { return service; },
    setPublisherProvidedId() { return service; },
    setRequestNonPersonalizedAds() { return service; },
    setSafeFrameConfig() { return service; },
    setTagForChildDirectedTreatment() { return service; },
    setTagForUnderAgeOfConsent() { return service; },
    setTargeting() { return service; },
    setVideoContent() {},
    updateCorrelator() {}
  };
  const sizeMapping = { addSize() { return sizeMapping; }, build() { return []; } };
  const gt = (globalThis.googletag = globalThis.googletag || {});
  const pending = Array.isArray(gt.cmd) ? gt.cmd : [];
  Object.assign(gt, {
    apiReady: true,
    pubadsReady: true,
    companionAds: () => service,
    content: () => service,
    defineOutOfPageSlot: () => slot,
    defineSlot: () => slot,
    destroySlots: noop,
    disablePublisherConsole: noop,
    display: noop,
    enableServices: noop,
    getVersion: () => '20260101',
    pubads: () => service,
    setAdIframeTitle: noop,
    sizeMapping: () => sizeMapping,
    cmd: {
      push(fn) {
        if (typeof fn === 'function') { try { fn(); } catch {} }
        return 0;
      }
    }
  });
  for (const fn of pending) gt.cmd.push(fn);
})();
