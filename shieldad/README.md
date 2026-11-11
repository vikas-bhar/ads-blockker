# ShieldAd

ShieldAd is an open-source ad and tracker blocker with two clients fed by one filter-list compiler:

- **Browser extension:** Manifest V3 for Chrome, Edge, and Firefox, using `declarativeNetRequest`, cosmetic CSS, per-site pause controls, custom rules, and action-count badges.
- **Android app:** Kotlin and Jetpack Compose, using a **local DNS-only VPN**. It does not proxy application traffic. Standard DNS queries are matched locally; allowed queries go directly to the selected upstream resolver through sockets excluded from the VPN with `protect()`.

ShieldAd has no analytics or account system. Filter updates use HTTPS to the public upstream list repositories. When the Android VPN is running, ShieldAd itself makes no per-query connection other than the upstream UDP DNS lookup.

## Repository layout

```text
shieldad/
  tools/                 Node.js list downloader, parser, compiler, and tests
  extension/             Shared extension source and browser-specific manifests
  android/               Gradle Android project (minSdk 26, targetSdk 34)
  dist/                  Generated unpacked extensions and packaged ZIP files
```

## Prerequisites

- Node.js 18 or newer and npm
- `curl` (used only as a fallback when Node cannot use the system CA trust store)
- `zip` on macOS/Linux for extension packaging
- For Android: JDK 17, Android SDK Platform 34, and Android build tools. Android Studio Hedgehog or newer is the easiest way to install these.

## Build and test everything

```bash
cd shieldad
npm install
npm test
npm run build

cd android
./gradlew testDebugUnitTest assembleDebug assembleRelease
```

`npm run build` first downloads and compiles the lists, then emits both extension variants and their ZIP archives. You can also run the stages independently:

```bash
npm run build-lists
npm run build:extension
```

### Shared list pipeline

The downloader reads the official raw GitHub sources for EasyList's general, ad-server, third-party, site-specific, and allowlist components; EasyPrivacy's general, specific, third-party, tracking-server, and allowlist components; and StevenBlack's unified hosts file. If a raw GitHub host is unavailable, it retries through the GitHub Contents API. Failed downloads are fatal; ShieldAd never silently substitutes stale or sample data.

Generated files:

| File | Contents |
| --- | --- |
| `extension/rulesets/ads.json` | Up to 29,000 high-priority DNR rules (all `@@` exceptions, conditional rules, URL patterns, and top root ad/tracking domains) within Chrome's 30,000 guaranteed static budget |
| `extension/rulesets/domains.json`, `domains_2.json`, `domains_3.json` | Additional folded domain rules across up to 29,000-rule static rulesets covering remaining EasyList/EasyPrivacy and StevenBlack hosts entries |
| `extension/cosmetic.json` | Global selectors, per-domain and `brand.*` selectors, `#@#` exceptions, and `$generichide`/`$elemhide` exclusions |
| `android/app/src/main/assets/blocklist.txt` | Sorted, deduplicated domains from hosts entries and `||domain^` filters |

Supported network syntax includes `||domain^`, URL wildcards and separators, `@@` exceptions, `$third-party`/`$~third-party`, `$important`, `$domain=`, `$script`, `$image`, `$xmlhttprequest`, and the other basic DNR resource types. Unsupported semantic modifiers (for example redirects) are skipped instead of being compiled with different behavior.

For deterministic development only, `SHIELDAD_OFFLINE_FIXTURES=1 npm run build-lists` reads `tools/fixtures/*.txt`. Normal builds always use the live upstream lists.

Run parser and runtime tests:

```bash
npm test
# or: npm test --workspace=@shieldad/tools
```

Run the real-Chrome integration test with a full Chrome for Testing/Chromium executable (not the headless-shell-only build):

```bash
npm run build:extension
CHROME_BIN=/path/to/chrome npm run test:browser
```

The test loads the actual unpacked extension, maps listed ad domains to a local server, and asserts that blocked requests never reach that server. It also checks initial and late-added cosmetic ads, child-combinator and `brand.*` cosmetic rules, `$generichide` protection, global off/on recovery, `allowAllRequests` nested-iframe pause, Popup and Options UI state, custom rules, safe same-site content, all enabled static rulesets, and DNR matched-rule reporting. CI runs it in headful Chrome under Xvfb and uploads the complete log as `shieldad-browser-evidence`.
## Browser extension

### Chrome and Edge

1. Run `npm run build:extension` after compiling the lists.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `dist/shieldad-chrome`.
5. Optionally archive `dist/shieldad-chrome-1.0.0.zip` for distribution through your normal signing/release process.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/shieldad-firefox/manifest.json`.
3. For permanent installation, sign `dist/shieldad-firefox-1.0.0.zip` through addons.mozilla.org or your enterprise add-on signing process.

The popup provides global protection, per-site pause (`allowAllRequests` + request/initiator allow rules so nested third-party iframes are also paused cleanly), Settings allowlist visibility, the current tab's DNR action count, and incremental filter updates. The core `ads` static ruleset fits within the 30,000-rule guaranteed minimum while extra domain rulesets (`domains`, `domains_2`, `domains_3`) are enabled automatically up to the browser's available static quota. The update button downloads the latest compiled lists, installs up to 3,500 newly added delta rules dynamically, disables removed static rules where supported, and refreshes cosmetic lists. The options page supports both custom network and custom cosmetic (`##` / `#@#`) rules, URL-normalized allowlists, paused-site management, and automatic `storage.local` overflow when custom rules exceed `chrome.storage.sync` item quotas.

Cosmetic rules are injected at `document_start` and update dynamically when protection is toggled. Selectors are grouped into 600-selector CSS rules, verified natively via the stylesheet's parsed rules (falling back to binary batch repair only if a browser rejects a selector), and guarded against stylesheet removal. A `MutationObserver` processes late-added elements in animation-frame batches, skips nested roots already covered by a parent scan, and respects `$generichide`/`$elemhide` directives. YouTube support is deliberately limited to hiding ad slots and promotional containers; ShieldAd does not alter video playback or circumvent playback restrictions.

## Android

### Build and install

```bash
cd shieldad/android
./gradlew testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Open ShieldAd, read the Private DNS warning, and press **Start**. Android displays its VPN consent dialog on first use. The notification's **Stop** action and the app's main button both tear down the tunnel.

The tunnel uses:

- interface addresses `10.111.222.1/32` and `fd00::1/128`
- virtual DNS servers `10.111.222.2` and `fd00::2`
- routes **only** for `10.111.222.2/32` and `fd00::2/128`

Consequently, only DNS packets enter the TUN descriptor. Blocked A and AAAA queries receive correctly checksummed `0.0.0.0` and `::` answers. Other blocked query types receive an empty NOERROR response. Allowed queries retain their original DNS payload when forwarded to Cloudflare, Google, Quad9, or a custom numeric resolver IP. Answers use a small TTL-bounded LRU cache. Query logs are kept in Room (the UI displays the latest 100); daily and all-time counters are stored separately so log pruning cannot reset them.

Settings, custom lists, the allowlist, excluded apps, and boot behavior use DataStore. Excluded apps are passed to `VpnService.Builder.addDisallowedApplication`. Blocklists can be updated manually and are refreshed weekly with WorkManager. Restart protection to reload edited or downloaded lists.

### Private DNS and encrypted-DNS limitations

Set Android **Private DNS** to **Off** or **Automatic**. A named Private DNS provider (DNS-over-TLS) bypasses local VPN DNS. Apps that independently use DNS-over-HTTPS, hard-coded non-DNS resolution, or their own encrypted tunnel can also bypass DNS filtering. ShieldAd intentionally handles UDP DNS only; it does not intercept TCP DNS, DoT, or DoH.

### Sign a release APK

An unsigned release APK can be assembled without extra configuration. To produce a signed release:

```bash
keytool -genkeypair -v \
  -keystore /absolute/path/to/shieldad-release.jks \
  -alias shieldad -keyalg RSA -keysize 4096 -validity 10000

cd shieldad/android
cp keystore.properties.example keystore.properties
# Edit keystore.properties with the real path and passwords.
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk`. Keep the JKS and `keystore.properties` out of version control; both are ignored by default. Never commit signing passwords.

### Unit and instrumented tests

JVM tests cover DNS name/question parsing, IPv4 and IPv6 UDP packets, A/AAAA response construction, IP/UDP checksums, cache transaction IDs and expiry, list parsing, and exact/parent-domain matching with allowlist precedence:

```bash
./gradlew testDebugUnitTest
```

For instrumented Compose/UI tests, connect an Android 8.0+ emulator or device and run:

```bash
./gradlew connectedDebugAndroidTest
```

A real-device VPN check is also required before release: accept VPN consent, verify standard A/AAAA lookups are blocked or forwarded as shown in **Activity**, stop from the persistent notification, revoke VPN access in system settings, enable an excluded app, and test boot restore. Repeat with Private DNS Off/Automatic and with a named provider to confirm the documented bypass behavior. VPN consent and Android's actual TUN routing cannot be validated by local JVM tests alone.

## License

ShieldAd source is available under the [MIT License](LICENSE). Downloaded filter lists remain subject to their respective upstream projects' terms and licenses.
