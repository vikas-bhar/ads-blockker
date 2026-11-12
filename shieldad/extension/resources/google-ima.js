(() => {
  const noop = () => {};
  const g = (globalThis.google = globalThis.google || {});
  if (g.ima && g.ima.AdsLoader) return;

  class EventTargetShim {
    constructor() { this._l = new Map(); }
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!this._l.has(type)) this._l.set(type, new Set());
      this._l.get(type).add(fn);
    }
    removeEventListener(type, fn) { this._l.get(type)?.delete(fn); }
    _emit(type, evt) {
      const set = this._l.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(evt); } catch {}
      }
    }
  }

  class AdError {
    constructor(msg = '') { this._msg = msg; }
    getErrorCode() { return 0; }
    getInnerError() { return null; }
    getMessage() { return this._msg; }
    getType() { return 'adLoadError'; }
    getVastErrorCode() { return 0; }
  }

  class AdErrorEvent {
    constructor(err) { this.type = 'adError'; this._err = err || new AdError(); }
    getError() { return this._err; }
    getUserRequestContext() { return {}; }
  }

  class Ad {
    getAdId() { return ''; }
    getAdPodInfo() { return { getAdPosition: () => 1, getIsBumper: () => false, getMaxDuration: () => -1, getPodIndex: () => 0, getTimeOffset: () => 0, getTotalAds: () => 1 }; }
    getAdSystem() { return ''; }
    getAdvertiserName() { return ''; }
    getApiFramework() { return null; }
    getCompanionAds() { return []; }
    getContentType() { return ''; }
    getCreativeAdId() { return ''; }
    getCreativeId() { return ''; }
    getDealId() { return ''; }
    getDescription() { return ''; }
    getDuration() { return -1; }
    getHeight() { return 0; }
    getMediaUrl() { return null; }
    getMinSuggestedDuration() { return -2; }
    getSkipTimeOffset() { return -1; }
    getSurveyUrl() { return null; }
    getTitle() { return ''; }
    getTraffickingParameters() { return {}; }
    getTraffickingParametersString() { return ''; }
    getUiElements() { return []; }
    getUniversalAdIdRegistry() { return 'unknown'; }
    getUniversalAdIds() { return []; }
    getUniversalAdIdValue() { return 'unknown'; }
    getVastMediaBitrate() { return 0; }
    getVastMediaHeight() { return 0; }
    getVastMediaWidth() { return 0; }
    getWidth() { return 0; }
    getWrapperAdIds() { return []; }
    getWrapperAdSystems() { return []; }
    getWrapperCreativeIds() { return []; }
    isLinear() { return true; }
    isSkippable() { return true; }
  }

  class AdEvent {
    constructor(type) { this.type = type; this._ad = new Ad(); }
    getAd() { return this._ad; }
    getAdData() { return {}; }
  }

  class AdsManager extends EventTargetShim {
    collapse() {}
    configureAdsManager() {}
    destroy() {}
    discardAdBreak() {}
    expand() {}
    focus() {}
    getAdSkippableState() { return false; }
    getCuePoints() { return []; }
    getRemainingTime() { return 0; }
    getVolume() { return 1; }
    init() {}
    isCustomClickTrackingUsed() { return false; }
    isCustomPlaybackUsed() { return false; }
    pause() {}
    resize() {}
    resume() {}
    setVolume() {}
    skip() {}
    start() {
      queueMicrotask(() => {
        this._emit('contentResumeRequested', new AdEvent('contentResumeRequested'));
        this._emit('allAdsCompleted', new AdEvent('allAdsCompleted'));
      });
    }
    stop() {}
    updateAdsRenderingSettings() {}
  }

  class AdsManagerLoadedEvent {
    constructor(mgr, ctx) { this.type = 'adsManagerLoaded'; this._mgr = mgr; this._ctx = ctx; }
    getAdsManager() { return this._mgr; }
    getUserRequestContext() { return this._ctx; }
  }

  class AdsLoader extends EventTargetShim {
    constructor() { super(); this._settings = { setVpaidMode: noop, setLocale: noop, setAutoPlayAdBreaks: noop, setDisableCustomPlaybackForIOS10Plus: noop, setNumRedirects: noop, setPlayerType: noop, setPlayerVersion: noop, setCookiesEnabled: noop, setSessionId: noop, setFeatureFlags: noop }; }
    contentComplete() {}
    destroy() {}
    getSettings() { return this._settings; }
    requestAds(req) {
      const mgr = new AdsManager();
      const ctx = req?.userRequestContext || {};
      queueMicrotask(() => {
        this._emit('adsManagerLoaded', new AdsManagerLoadedEvent(mgr, ctx));
      });
    }
  }

  class AdDisplayContainer { initialize() {} destroy() {} }
  class AdsRequest { setAdWillAutoPlay() {} setAdWillPlayMuted() {} setContinuousPlayback() {} }
  class AdsRenderingSettings {}
  class ImaSdkSettings { static get VpaidMode() { return { DISABLED: 0, ENABLED: 1, INSECURE: 2 }; } }

  g.ima = {
    VERSION: '3.0.0',
    AdDisplayContainer,
    AdError,
    AdErrorEvent: Object.assign(AdErrorEvent, { Type: { AD_ERROR: 'adError' } }),
    AdEvent: Object.assign(AdEvent, {
      Type: {
        AD_BREAK_READY: 'adBreakReady',
        AD_BUFFERING: 'adBuffering',
        AD_CAN_PLAY: 'adCanPlay',
        AD_METADATA: 'adMetadata',
        AD_PROGRESS: 'adProgress',
        ALL_ADS_COMPLETED: 'allAdsCompleted',
        CLICK: 'click',
        COMPLETE: 'complete',
        CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
        CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
        DURATION_CHANGE: 'durationChange',
        EXPANDED_CHANGED: 'expandedChanged',
        FIRST_QUARTILE: 'firstQuartile',
        IMPRESSION: 'impression',
        INTERACTION: 'interaction',
        LINEAR_CHANGED: 'linearChanged',
        LOADED: 'loaded',
        LOG: 'log',
        MIDPOINT: 'midpoint',
        PAUSED: 'paused',
        RESUMED: 'resumed',
        SKIPPABLE_STATE_CHANGED: 'skippableStateChanged',
        SKIPPED: 'skipped',
        STARTED: 'started',
        THIRD_QUARTILE: 'thirdQuartile',
        USER_CLOSE: 'userClose',
        VOLUME_CHANGED: 'volumeChanged',
        VOLUME_MUTED: 'volumeMuted'
      }
    }),
    AdsLoader,
    AdsManager,
    AdsManagerLoadedEvent: Object.assign(AdsManagerLoadedEvent, { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } }),
    AdsRenderingSettings,
    AdsRequest,
    ImaSdkSettings,
    OmidAccessMode: { DOMAIN: 'domain', FULL: 'full', LIMITED: 'limited' },
    UiElements: { AD_ATTRIBUTION: 'adAttribution', COUNTDOWN: 'countdown' },
    ViewMode: { FULLSCREEN: 'fullscreen', NORMAL: 'normal' },
    settings: new AdsLoader().getSettings()
  };
})();
