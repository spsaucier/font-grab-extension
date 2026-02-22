# Font Grab

A Chrome extension that detects fonts downloaded by websites, lets you preview them in the popup, and exports clean OTF files with sanitized metadata.

## Features

- Detects fonts (WOFF, WOFF2, TTF, OTF) via PerformanceObserver and CSS `@font-face` scanning
- Shows font family, style, glyph count, file size, designer, and license
- Live preview with resizable sample text rendered in the actual typeface
- Exports as OTF with a clean name table — strips foundry obfuscation (e.g. "Not Licensed for Desktop Use" stuffed into the subfamily field)
- Spoofs the `Referer` header on font downloads to bypass hotlink protection
- Sanitizes bogus copyright strings that foundries embed in family/subfamily name fields
- WOFF2 decompression via fontkit (pure JS, no WASM — works in MV3 service workers)
- Deduplicates fonts by content hash across page visits
- Dark and light theme support

## Install (development)

```sh
pnpm install
pnpm build
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3/` directory

## Usage

1. Visit any website
2. Open the Font Grab popup from the toolbar
3. Detected fonts appear in the list — each name is rendered in its own typeface
4. Click a font to see metadata and a live preview
5. Drag the size slider to resize the preview text
6. Click **Download OTF** to export the font as a clean OTF file

## Build commands

| Command | Description |
|---|---|
| `pnpm dev` | Start WXT dev server with hot reload |
| `pnpm build` | Production build → `.output/chrome-mv3/` |
| `pnpm compile` | TypeScript type-check only (no emit) |

## Tech stack

- **[WXT](https://wxt.dev)** — Chrome extension framework (Manifest V3)
- **Vanilla TypeScript** — no UI framework
- **[fontkit](https://github.com/foliojs/fontkit)** — font parsing and WOFF2 decompression
- **[opentype.js](https://opentype.js.org)** — OTF serialization for export
- **IndexedDB** — stores font binaries (up to 25 MB per font)
- **chrome.storage** — stores metadata and settings

## Architecture

```
content script
  └─ PerformanceObserver + CSS @font-face scan
  └─ sends FONT_DETECTED / FONT_CSS_FAMILY_UPDATE → background

background service worker
  └─ downloads font (with Referer spoofing)
  └─ detects format, decompresses WOFF2 via fontkit
  └─ SHA-256 content hash → deduplication
  └─ parses name table metadata, sanitizes bogus values
  └─ saves to IndexedDB, notifies popup

popup
  └─ fetches font list from background (GET_FONTS_FOR_TAB)
  └─ fetches binaries directly from IndexedDB (not through message pipe)
  └─ renders preview via @font-face + object URL
  └─ exports via opentype.js with patched name table
```

**Note:** MV3 `webRequest` cannot intercept response bodies, so font detection is entirely client-side using the Performance API and CSS object model.
