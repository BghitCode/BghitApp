# Implementation Plan: Splash Screen & Offline Screen Features

## Overview

Add two features to Pake:

1. **Splash Screen** — A frameless window showing a logo while the main app URL loads
2. **Offline Screen** — A local fallback page when the user has no internet connection

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      APP STARTUP                        │
│                                                         │
│  1. Rust creates splash window (visible, frameless)     │
│     └─ loads splash.html with logo                      │
│                                                         │
│  2. Rust creates main window (hidden)                   │
│     └─ loads target URL                                 │
│     └─ injects offline.js (network monitor)             │
│                                                         │
│  3. Main window fires DOMContentLoaded                  │
│     └─ offline.js checks navigator.onLine               │
│     └─ if online: calls close_splashscreen command      │
│     └─ if offline: redirects to offline.html            │
│                                                         │
│  4. close_splashscreen command:                         │
│     └─ destroys splash window                           │
│     └─ shows main window                                │
│                                                         │
│  5. If offline detected later:                          │
│     └─ offline.js redirects to offline.html             │
│     └─ offline.html retry button checks connectivity    │
│     └─ on recovery: navigates back to target URL        │
└─────────────────────────────────────────────────────────┘
```

---

## Files to Modify/Create

### TypeScript (CLI & Build)

| File                         | Change                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `bin/types.ts`               | Add `splash`, `autoSplash`, `offline` to `PakeCliOptions` and `WindowConfig` |
| `bin/defaults.ts`            | Add defaults for new options                                                 |
| `bin/helpers/cli-program.ts` | Add `--splash`, `--auto-splash`, `--offline` CLI flags                       |
| `bin/helpers/merge.ts`       | Handle splash/offline asset copying, HTML generation                         |
| `bin/utils/splash.ts`        | **NEW** — Splash/offline HTML generation, og:image fetching                  |

### Rust (Backend)

| File                              | Change                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| `src-tauri/src/app/config.rs`     | Add `splash`, `auto_splash`, `offline` fields to `WindowConfig`     |
| `src-tauri/src/app/invoke.rs`     | Add `close_splashscreen` command                                    |
| `src-tauri/src/app/window.rs`     | Add `build_splash_window()`, modify `build_window()` to skip splash |
| `src-tauri/src/lib.rs`            | Register new command, orchestrates splash→main transition           |
| `src-tauri/src/inject/offline.js` | **NEW** — Network monitoring + offline redirect                     |

### Assets (Generated at Build Time)

| File                              | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `dist/splash.html`                | Splash screen page (generated from template)    |
| `dist/offline.html`               | Offline fallback page (generated from template) |
| `dist/splash-asset.{png,jpg,...}` | User-provided or auto-fetched splash image      |

---

## Step-by-Step Implementation

### Step 1: TypeScript Types (`bin/types.ts`)

Add to `PakeCliOptions`:

```typescript
// Path or URL to splash screen image
splash?: string;

// Auto-fetch og:image from target URL for splash
autoSplash?: boolean;

// Path to offline page (or use built-in default)
offline?: boolean | string;
```

Add to `WindowConfig`:

```typescript
splash: string; // splash asset filename (empty = no splash)
auto_splash: boolean; // auto-fetch og:image
offline: boolean; // enable offline page
```

### Step 2: CLI Defaults (`bin/defaults.ts`)

```typescript
splash: '',
autoSplash: false,
offline: false,
```

### Step 3: CLI Flags (`bin/helpers/cli-program.ts`)

```typescript
.option('--splash <path_or_url>', 'Splash screen image (path or URL)', DEFAULT.splash)
.option('--auto-splash', 'Auto-fetch og:image from target URL for splash', DEFAULT.autoSplash)
.option('--offline', 'Enable offline fallback page', DEFAULT.offline)
```

### Step 4: Splash/Offline Utilities (`bin/utils/splash.ts`)

New file with:

1. **`generateSplashHtml(assetPath: string): string`** — Returns clean HTML that centers the image
2. **`generateOfflineHtml(): string`** — Returns styled "No Internet" page with retry button
3. **`fetchOgImage(url: string): Promise<string|null>`** — Fetches URL, parses `<meta property="og:image">`, downloads image
4. **`processSplashAsset(splash: string, autoSplash: boolean, targetUrl: string): Promise<string>`** — Resolves the splash image path

### Step 5: Config Merge (`bin/helpers/merge.ts`)

In `mergeConfig()`, after existing logic:

```typescript
// Process splash screen
if (options.splash || options.autoSplash) {
  const assetPath = await processSplashAsset(
    options.splash,
    options.autoSplash,
    url,
  );
  // Copy asset to dist/
  // Generate splash.html in dist/
  // Set pake.windows[0].splash = assetFilename
}

// Process offline page
if (options.offline) {
  // Generate offline.html in dist/
  // Set pake.windows[0].offline = true
}
```

### Step 6: Rust Config (`src-tauri/src/app/config.rs`)

Add to `WindowConfig`:

```rust
#[serde(default)]
pub splash: String,
#[serde(default)]
pub auto_splash: bool,
#[serde(default)]
pub offline: bool,
```

### Step 7: Splash Window Builder (`src-tauri/src/app/window.rs`)

New function `build_splash_window()`:

- Creates a frameless, transparent window
- Points to `splash.html` via `WebviewUrl::App("splash.html")`
- No initialization scripts (clean, minimal)
- Sets `visible: true`

Modify `build_window()`:

- Skip splash injection if `splash` is empty

### Step 8: Close Splash Command (`src-tauri/src/app/invoke.rs`)

```rust
#[command]
pub fn close_splashscreen(app: AppHandle) -> Result<(), String> {
    // 1. Destroy splash window
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.destroy();
    }
    // 2. Show main window
    if let Some(main) = app.get_webview_window("pake") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}
```

### Step 9: App Bootstrap (`src-tauri/src/lib.rs`)

In `setup`:

```rust
// If splash is enabled, create splash window FIRST
if !window_config.splash.is_empty() {
    let splash_window = build_splash_window(app.app_handle(), &window_config)?;
    let _ = splash_window.show();
}

// Then create main window (hidden)
let window = set_window(app.app_handle(), &pake_config, &tauri_config)?;
// Don't show main window yet if splash is enabled
```

Register `close_splashscreen` in `invoke_handler`.

### Step 10: Offline Detection Script (`src-tauri/src/inject/offline.js`)

```javascript
(function () {
  const OFFLINE_URL = "offline.html";
  const TARGET_URL = window.pakeConfig?.url || window.location.href;

  function isOffline() {
    return !navigator.onLine;
  }

  function goToOffline() {
    if (!window.location.href.includes(OFFLINE_URL)) {
      window.__pake_original_url = window.location.href;
      window.location.href = OFFLINE_URL;
    }
  }

  function goOnline() {
    if (window.location.href.includes(OFFLINE_URL)) {
      const original = window.__pake_original_url || TARGET_URL;
      window.location.href = original;
    }
  }

  if (isOffline()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", goToOffline);
    } else {
      goToOffline();
    }
  }

  window.addEventListener("offline", goToOffline);
  window.addEventListener("online", goOnline);
})();
```

### Step 11: Splash-to-Main Transition Script

Injected into the main window (after offline.js):

```javascript
(function () {
  function onReady() {
    if (window.__TAURI__ && window.pakeConfig?.splash) {
      window.__TAURI__.core.invoke("close_splashscreen");
    }
  }

  if (document.readyState === "complete") {
    onReady();
  } else {
    window.addEventListener("load", onReady);
  }
})();
```

---

## CLI Usage Examples

```bash
# Basic splash with local image
pake https://example.com --name MyApp --splash ./logo.png

# Auto-splash from og:image
pake https://example.com --name MyApp --auto-splash

# Both splash and offline
pake https://example.com --name MyApp --splash ./logo.png --offline

# Offline only (no splash)
pake https://example.com --name MyApp --offline
```

---

## Architecture Decisions (from Eng Review)

| Decision                | Choice                                       | Rationale                           |
| ----------------------- | -------------------------------------------- | ----------------------------------- |
| Splash/offline race     | Splash waits for ready signal                | Eliminates flash of loading page    |
| auto-splash failure     | Graceful fallback to app icon                | Builds never fail on network issues |
| Offline URL persistence | localStorage                                 | Standard solution, survives reloads |
| Splash timeout          | 10-second timeout with fallback              | Prevents indefinite hang            |
| --splash URL handling   | Support both path and URL                    | Consistent with flag description    |
| Transition logic DRY    | Extract shared helper (splash-transition.js) | Prevents drift between paths        |
| Error handling          | Log errors via eprintln!                     | Production debuggability            |
| offline.js injection    | Gate on offline config flag                  | Zero overhead when disabled         |
| Unit tests              | Add vitest tests for all new functions       | Cheap insurance with CC             |

## Updated Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      APP STARTUP                        │
│                                                         │
│  1. Rust creates splash window (visible, frameless)     │
│     └─ loads splash.html with logo                      │
│     └─ starts 10s timeout                               │
│                                                         │
│  2. Rust creates main window (hidden)                   │
│     └─ loads target URL                                 │
│     └─ conditionally injects offline.js (if --offline)  │
│                                                         │
│  3. Main window fires DOMContentLoaded                  │
│     └─ if offline: redirect to offline.html             │
│     └─ offline.html stores URL in localStorage          │
│     └─ offline.html signals ready via splash-transition │
│     └─ if online: splash-transition.js signals ready    │
│                                                         │
│  4. Ready signal OR 10s timeout:                        │
│     └─ close_splashscreen command fires                 │
│     └─ destroys splash window                           │
│     └─ shows main window                                │
│     └─ logs errors if any step fails                    │
│                                                         │
│  5. If offline detected later:                          │
│     └─ offline.js redirects to offline.html             │
│     └─ retry reads localStorage for original URL        │
│     └─ on recovery: navigates back to target URL        │
└─────────────────────────────────────────────────────────┘
```

## Edge Cases & Considerations

1. **Splash window + hide-on-close**: If user closes splash before main loads, app should still launch main window. Handle in splash window's close event.

2. **Local file URLs**: Splash/offline don't apply when `--use-local-file` is used. Skip generation.

3. **Multi-window**: Splash only shows on first window. Additional windows don't get splash.

4. **Splash timeout**: 10-second timeout. If main window hasn't signaled ready, close splash and show main window anyway (even if partially loaded).

5. **Asset size**: Auto-fetched og:image capped at 500KB. Larger images fall back to app icon.

6. **Platform differences**: Frameless + transparent works differently on macOS vs Windows vs Linux. Test all three.

7. **Error handling**: close_splashscreen logs errors via eprintln! instead of silently discarding.

8. **Conditional injection**: offline.js only injected when `--offline` is enabled. Zero overhead when disabled.

## Visual Design Specs (from Design Review)

### Splash Screen (`splash.html`)

| Property       | Value                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| Background     | White `#FFFFFF`, with `@media (prefers-color-scheme: dark)` fallback to `#1a1a1a`          |
| Image max size | 300x300px, `object-fit: contain`, centered                                                 |
| Centering      | Flexbox, `justify-content: center`, `align-items: center`, `height: 100vh`                 |
| Font           | System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`) |
| Window frame   | Frameless, transparent background                                                          |
| Fallback       | If image fails to load, show app icon (from pake config)                                   |

```html
<!-- Splash screen template -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #ffffff;
        font-family:
          -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #1a1a1a;
        }
      }
      img {
        max-width: 300px;
        max-height: 300px;
        object-fit: contain;
      }
    </style>
  </head>
  <body>
    <img
      src="SPLASH_ASSET_PATH"
      alt="Loading..."
      onerror="this.src='ICON_PATH'"
    />
  </body>
</html>
```

### Offline Page (`offline.html`)

| Property        | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background      | White `#FFFFFF`, with dark mode `#1a1a1a`                                                                                                             |
| Layout          | Centered card, max-width 400px, flexbox centering                                                                                                     |
| Icon            | WiFi-off SVG (inline, 64x64, stroke-based, `#8E8E93` light / `#636366` dark)                                                                          |
| Heading         | "No Internet Connection", 24px, bold, `#000000` light / `#FFFFFF` dark                                                                                |
| Subtext         | "Check your network and try again", 16px, `#8E8E93` light / `#AEAEB2` dark                                                                            |
| Retry button    | iOS-style: `#007AFF` bg (light) / `#0A84FF` bg (dark), white text, 44px height, 8px border-radius, 16px horizontal padding, system font 16px semibold |
| Button hover    | `#0056CC` (light) / `#409CFF` (dark)                                                                                                                  |
| Button disabled | `#C7C7CC` bg, spinner SVG replaces text                                                                                                               |
| Button cooldown | 3 seconds, shows spinner, disabled state                                                                                                              |
| Centering       | Flexbox, `justify-content: center`, `align-items: center`, `height: 100vh`                                                                            |

```html
<!-- Offline page template -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #ffffff;
        font-family:
          -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        body {
          background: #1a1a1a;
        }
        .heading {
          color: #ffffff;
        }
        .subtext {
          color: #aeaeb2;
        }
        .icon {
          stroke: #636366;
        }
        .retry-btn {
          background: #0a84ff;
        }
        .retry-btn:hover {
          background: #409cff;
        }
      }
      .card {
        text-align: center;
        max-width: 400px;
        padding: 40px;
      }
      .icon {
        width: 64px;
        height: 64px;
        stroke: #8e8e93;
        margin-bottom: 24px;
      }
      .heading {
        font-size: 24px;
        font-weight: 700;
        color: #000000;
        margin-bottom: 8px;
      }
      .subtext {
        font-size: 16px;
        color: #8e8e93;
        margin-bottom: 32px;
      }
      .retry-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 120px;
        height: 44px;
        padding: 0 16px;
        background: #007aff;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .retry-btn:hover {
        background: #0056cc;
      }
      .retry-btn:disabled {
        background: #c7c7cc;
        cursor: not-allowed;
      }
      .retry-btn .spinner {
        display: none;
        width: 20px;
        height: 20px;
        border: 2px solid #fff;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      .retry-btn.loading .btn-text {
        display: none;
      }
      .retry-btn.loading .spinner {
        display: inline-block;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <svg
        class="icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <h1 class="heading">No Internet Connection</h1>
      <p class="subtext">Check your network and try again</p>
      <button class="retry-btn" onclick="retry()">
        <span class="btn-text">Retry</span>
        <span class="spinner"></span>
      </button>
    </div>
    <script>
      let cooldown = false;
      function retry() {
        if (cooldown) return;
        cooldown = true;
        const btn = document.querySelector(".retry-btn");
        btn.classList.add("loading");
        btn.disabled = true;
        setTimeout(() => {
          const original =
            localStorage.getItem("pake_original_url") || window.pakeConfig?.url;
          if (original) window.location.href = original;
          else window.location.reload();
        }, 3000);
      }
    </script>
  </body>
</html>
```

## Unit Tests (vitest)

Add `bin/utils/__tests__/splash.test.ts`:

```typescript
// generateSplashHtml tests
- returns valid HTML with centered image
- handles paths with spaces
- handles very long paths
- sanitizes HTML in path (XSS prevention)

// generateOfflineHtml tests
- returns valid HTML with retry button
- no script injection vectors

// fetchOgImage tests
- resolves absolute og:image URLs
- resolves relative og:image URLs against base URL
- returns null when no og:image tag exists
- returns null on network error
- returns null when image > 500KB
- returns null when og:image is not an image

// processSplashAsset tests
- copies local file to dist/
- downloads URL to dist/
- falls back to app icon when file not found
- falls back to app icon when auto-splash fails
```

## Testing Checklist

- [ ] `--splash ./logo.png` shows splash, transitions to main
- [ ] `--splash https://example.com/logo.png` downloads and shows splash
- [ ] `--auto-splash` fetches og:image and uses it
- [ ] `--auto-splash` with no og:image falls back to app icon
- [ ] `--offline` shows offline page when network is down
- [ ] Offline page retry button works
- [ ] Splash + offline combined works (no flash)
- [ ] Splash timeout fires after 10s when target is unreachable
- [ ] No splash/offline (default) still works
- [ ] Local file mode ignores splash/offline
- [ ] All platforms (macOS, Windows, Linux)
- [ ] Multi-window mode with splash
- [ ] Close splash before main loads (edge case)
- [ ] localStorage persistence across reloads

## Implementation Tasks

- [ ] **T1 (P1)** — TypeScript types + defaults + CLI flags
  - Files: bin/types.ts, bin/defaults.ts, bin/helpers/cli-program.ts
- [ ] **T2 (P1)** — Splash/offline HTML generation
  - Files: bin/utils/splash.ts (NEW)
- [ ] **T3 (P1)** — Config merge integration
  - Files: bin/helpers/merge.ts
- [ ] **T4 (P1)** — Rust config structs
  - Files: src-tauri/src/app/config.rs
- [ ] **T5 (P1)** — Splash window builder
  - Files: src-tauri/src/app/window.rs
- [ ] **T6 (P1)** — Close splash command
  - Files: src-tauri/src/app/invoke.rs
- [ ] **T7 (P1)** — App bootstrap orchestration
  - Files: src-tauri/src/lib.rs
- [ ] **T8 (P1)** — Offline detection script
  - Files: src-tauri/src/inject/offline.js (NEW)
- [ ] **T9 (P1)** — Splash transition helper
  - Files: src-tauri/src/inject/splash-transition.js (NEW)
- [ ] **T10 (P2)** — Unit tests
  - Files: bin/utils/**tests**/splash.test.ts (NEW)
- [ ] **T11 (P2)** — Splash HTML template
  - Files: dist/splash.html (generated at build time)
- [ ] **T12 (P2)** — Offline HTML template
  - Files: dist/offline.html (generated at build time)

## Splash Animation (from CEO Review)

Add fade-in/out transitions to the splash screen:

```css
/* Add to splash.html <style> */
body {
  animation: fadeIn 0.3s ease-in;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* When closing splash, fade out */
body.fade-out {
  animation: fadeOut 0.3s ease-out forwards;
}
@keyframes fadeOut {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
```

The `close_splashscreen` command should set `fade-out` class on the splash window before destroying it. This requires adding a small JS bridge call before `splash.destroy()`:

```rust
// In close_splashscreen, before destroy:
if let Some(splash) = app.get_webview_window("splash") {
    let _ = splash.eval("document.body.classList.add('fade-out')");
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    let _ = splash.destroy();
}
```

~20 lines total. Makes the splash transition feel smooth instead of abrupt.

## NOT in scope

1. **Splash window customization** (background color, opacity) — deferred to future PR
2. **Offline page customization** (user-provided HTML) — deferred, built-in default is sufficient
3. **Configurable splash timeout** — 10s hardcoded for now, configurable later if needed

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status | Findings                   |
| ------------- | --------------------- | ------------------------------- | ---- | ------ | -------------------------- |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 1    | CLEAR  | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 1    | CLEAR  | 7 decisions, 0 unresolved  |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 1    | CLEAR  | 2 decisions, 0 unresolved  |
| Adversarial   | —                     | —                               | 0    | —      | —                          |
| Outside Voice | —                     | —                               | 0    | —      | —                          |

- **UNRESOLVED:** 0
- **VERDICT:** ENG + DESIGN + CEO CLEARED — ready to implement
