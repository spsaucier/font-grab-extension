const PREVIEW_FONT_FAMILY = 'font-grab-preview';
const STORAGE_KEY_FONT_SIZE = 'previewFontSize';
const DEFAULT_FONT_SIZE = 36;

const MIME_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

let currentObjectUrl: string | null = null;
let currentStyleElement: HTMLStyleElement | null = null;

/**
 * Load font data into the popup document for preview rendering.
 * Creates a CSS @font-face rule via an injected <style> tag.
 * Cleans up any previously loaded preview font first.
 */
export async function loadFontForPreview(
  family: string,
  fontData: Uint8Array,
  format: string,
): Promise<void> {
  clearPreviewFont();

  const mimeType = MIME_TYPES[format] ?? 'font/woff2';
  const blob = new Blob([fontData], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const style = document.createElement('style');
  style.textContent = `@font-face { font-family: '${PREVIEW_FONT_FAMILY}'; src: url('${url}') format('${format}'); }`;
  document.head.appendChild(style);

  currentObjectUrl = url;
  currentStyleElement = style;
}

/**
 * Apply the loaded preview font to the #preview-text element.
 * Should be called after loadFontForPreview.
 */
export function applyFontToPreview(_family: string): void {
  const previewEl = document.getElementById('preview-text');
  if (previewEl) {
    previewEl.style.fontFamily = `'${PREVIEW_FONT_FAMILY}'`;
  }
}

/**
 * Remove the injected style tag and revoke the object URL.
 * Safe to call even if no preview font is loaded.
 */
export function clearPreviewFont(): void {
  if (currentStyleElement) {
    currentStyleElement.remove();
    currentStyleElement = null;
  }

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const previewEl = document.getElementById('preview-text');
  if (previewEl) {
    previewEl.style.fontFamily = '';
  }
}

/**
 * Persist the preview font size to chrome.storage.local.
 */
export async function saveFontSize(size: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_FONT_SIZE]: size });
}

/**
 * Load the persisted preview font size.
 * Returns the default (36) if no value has been saved.
 */
export async function loadFontSize(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEY_FONT_SIZE);
  const stored = result[STORAGE_KEY_FONT_SIZE];
  return typeof stored === 'number' ? stored : DEFAULT_FONT_SIZE;
}
