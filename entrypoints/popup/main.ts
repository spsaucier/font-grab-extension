import './style.css';
import { exportAsOtf } from '../../lib/exporter';
import {
  applyFontToPreview,
  clearPreviewFont,
  loadFontForPreview,
  loadFontSize,
  saveFontSize,
} from '../../lib/preview';
import { getFont, type StoredFont } from '../../lib/storage';

type RuntimeFontMessage =
  | { type: 'FONT_SAVED'; font: StoredFont }
  | { type: 'FONT_UPDATED'; font: StoredFont };

const fontListPanel = document.getElementById('font-list-panel');
const fontDetailPanel = document.getElementById('font-detail-panel');
const loadingState = document.getElementById('state-loading');
const emptyState = document.getElementById('state-empty');
const fontListEl = document.getElementById('font-list') as HTMLUListElement | null;
const fontCountEl = document.getElementById('font-count');
const slider = document.getElementById('font-size-slider') as HTMLInputElement | null;
const sizeDisplay = document.getElementById('size-display');
const previewText = document.getElementById('preview-text');
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement | null;
const exportStatusEl = document.getElementById('export-status');
const subsetWarningEl = document.getElementById('subset-warning');
const demoLinkEl = document.getElementById('demo-link') as HTMLAnchorElement | null;
const detailFamilyEl = document.getElementById('detail-family');
const detailFormatBadgeEl = document.getElementById('detail-format-badge');
const detailSubfamilyEl = document.getElementById('detail-subfamily');
const detailFilesizeEl = document.getElementById('detail-filesize');
const detailGlyphsEl = document.getElementById('detail-glyphs');
const detailDesignerEl = document.getElementById('detail-designer');
const detailLicenseEl = document.getElementById('detail-license');

let currentTabUrl = '';
let currentTabOrigin = '';
let currentFont: StoredFont | null = null;
let fontsForTab: StoredFont[] = [];
let exportStatusTimer: number | undefined;

let listFontStyleEl: HTMLStyleElement | null = null;
const listFontObjectUrls: string[] = [];

function showLoading(isLoading: boolean): void {
  if (isLoading) {
    loadingState?.removeAttribute('hidden');
    emptyState?.setAttribute('hidden', '');
    fontListEl?.setAttribute('hidden', '');
    return;
  }

  loadingState?.setAttribute('hidden', '');
}

function getOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function fontMatchesCurrentTab(font: StoredFont): boolean {
  if (!currentTabOrigin) {
    return false;
  }

  return font.pageUrl.startsWith(currentTabOrigin);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function setExportStatus(text: string, kind: 'success' | 'error' | 'pending'): void {
  if (!exportStatusEl) {
    return;
  }

  if (exportStatusTimer !== undefined) {
    window.clearTimeout(exportStatusTimer);
    exportStatusTimer = undefined;
  }

  exportStatusEl.textContent = text;
  exportStatusEl.classList.remove('success', 'error');
  if (kind === 'success') {
    exportStatusEl.classList.add('success');
  }
  if (kind === 'error') {
    exportStatusEl.classList.add('error');
  }
  exportStatusEl.removeAttribute('hidden');

  exportStatusTimer = window.setTimeout(() => {
    exportStatusEl.setAttribute('hidden', '');
    exportStatusEl.classList.remove('success', 'error');
    exportStatusTimer = undefined;
  }, 3000);
}

function clearListFonts(): void {
  if (listFontStyleEl) {
    listFontStyleEl.remove();
    listFontStyleEl = null;
  }
  for (const url of listFontObjectUrls) {
    URL.revokeObjectURL(url);
  }
  listFontObjectUrls.length = 0;
}

async function injectListFonts(fonts: StoredFont[]): Promise<void> {
  clearListFonts();

  const MIME_TYPES: Record<string, string> = {
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  };

  const rules: string[] = [];

  for (const font of fonts) {
    const fullFont = await getFont(font.contentHash);
    if (!fullFont?.fontData) continue;

    const mimeType = MIME_TYPES[font.format] ?? 'font/woff2';
    const blob = new Blob([fullFont.fontData], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    listFontObjectUrls.push(objectUrl);

    const familyName = `font-grab-list-${font.contentHash.slice(0, 8)}`;
    rules.push(`@font-face { font-family: '${familyName}'; src: url('${objectUrl}') format('${font.format}'); font-display: block; }`);

    const nameEl = document.querySelector<HTMLElement>(`[data-font-hash="${font.contentHash}"] .font-item-name`);
    if (nameEl) {
      nameEl.style.fontFamily = `'${familyName}', -apple-system, sans-serif`;
    }
  }

  if (rules.length === 0) return;

  listFontStyleEl = document.createElement('style');
  listFontStyleEl.textContent = rules.join('\n');
  document.head.appendChild(listFontStyleEl);
}

function renderFontList(fonts: StoredFont[]): void {
  clearListFonts();
  if (!fontListEl) {
    return;
  }

  if (fontCountEl) {
    fontCountEl.textContent = String(fonts.length);
  }
  fontListEl.innerHTML = '';

  if (fonts.length === 0) {
    emptyState?.removeAttribute('hidden');
    fontListEl.setAttribute('hidden', '');
    return;
  }

  emptyState?.setAttribute('hidden', '');
  fontListEl.removeAttribute('hidden');

  for (const font of fonts) {
    const item = document.createElement('li');
    item.className = 'font-list-item';
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '0');
    item.dataset.fontHash = font.contentHash;

    const info = document.createElement('div');
    info.className = 'font-item-info';

    const name = document.createElement('div');
    name.className = 'font-item-name';
    const family = font.family || 'Unknown';
    const subfamily = font.subfamily ? ` ${font.subfamily}` : '';
    name.textContent = `${family}${subfamily}`;

    const meta = document.createElement('div');
    meta.className = 'font-item-meta';

    const formatBadge = document.createElement('span');
    formatBadge.className = `format-badge badge badge-${font.format}`;
    formatBadge.dataset.format = font.format;
    formatBadge.textContent = font.format.toUpperCase();

    const size = document.createElement('span');
    size.className = 'font-item-size';
    size.textContent = formatFileSize(font.fileSize);

    meta.appendChild(formatBadge);
    meta.appendChild(size);

    if (font.isSubset) {
      const subsetBadge = document.createElement('span');
      subsetBadge.className = 'subset-badge';
      subsetBadge.textContent = 'Subset';
      meta.appendChild(subsetBadge);
    }

    info.appendChild(name);
    info.appendChild(meta);

    const chevron = document.createElement('span');
    chevron.className = 'font-item-chevron';
    chevron.textContent = '›';

    item.appendChild(info);
    item.appendChild(chevron);

    const select = () => {
      void selectFont(font);
    };
    item.addEventListener('click', select);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    fontListEl.appendChild(item);
  }

  void injectListFonts(fonts);
}

async function selectFont(font: StoredFont): Promise<void> {
  currentFont = font;

  fontDetailPanel?.removeAttribute('hidden');
  fontListPanel?.setAttribute('hidden', '');

  if (detailFamilyEl) {
    detailFamilyEl.textContent = font.family || 'Unknown';
  }

  if (detailFormatBadgeEl) {
    detailFormatBadgeEl.textContent = font.format.toUpperCase();
    detailFormatBadgeEl.setAttribute('data-format', font.format);
  }

  if (detailSubfamilyEl) {
    detailSubfamilyEl.textContent = font.subfamily || '—';
  }
  if (detailFilesizeEl) {
    detailFilesizeEl.textContent = formatFileSize(font.fileSize);
  }
  if (detailGlyphsEl) {
    detailGlyphsEl.textContent = String(font.glyphCount || '—');
  }
  if (detailDesignerEl) {
    detailDesignerEl.textContent = font.designer || '—';
  }
  if (detailLicenseEl) {
    const lic = font.license || '';
    if (lic.length > 80) {
      detailLicenseEl.textContent = lic.slice(0, 77) + '…';
      detailLicenseEl.title = lic;
    } else {
      detailLicenseEl.textContent = lic || '—';
    }
  }

  if (font.isSubset) {
    subsetWarningEl?.removeAttribute('hidden');
  } else {
    subsetWarningEl?.setAttribute('hidden', '');
  }

  if (demoLinkEl && font.demoUrl) {
    demoLinkEl.href = font.demoUrl;
    demoLinkEl.textContent = `View ${font.family || 'font'} demo →`;
    demoLinkEl.removeAttribute('hidden');
  } else {
    demoLinkEl?.setAttribute('hidden', '');
  }

  const fullFont = await getFont(font.contentHash);
  if (fullFont?.fontData) {
    await loadFontForPreview(font.family, fullFont.fontData, font.format);
    applyFontToPreview(font.family);
  }
}

function requestFontsForTab(tabUrl: string): Promise<StoredFont[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_FONTS_FOR_TAB', tabUrl }, (response: StoredFont[] | undefined) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(Array.isArray(response) ? response : []);
    });
  });
}

async function init(): Promise<void> {
  const size = await loadFontSize();
  if (slider) {
    slider.value = String(size);
  }
  if (sizeDisplay) {
    sizeDisplay.textContent = `${size}px`;
  }
  if (previewText) {
    previewText.style.fontSize = `${size}px`;
  }

  showLoading(true);

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    currentTabUrl = activeTab?.url ?? '';
    currentTabOrigin = getOrigin(currentTabUrl);

    const fonts = await requestFontsForTab(currentTabUrl);
    fontsForTab = fonts;
    renderFontList(fontsForTab);
  } finally {
    showLoading(false);
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeFontMessage) => {
  if (message.type !== 'FONT_SAVED' && message.type !== 'FONT_UPDATED') {
    return;
  }

  const { font } = message;
  if (!fontMatchesCurrentTab(font)) {
    return;
  }

  const existingIndex = fontsForTab.findIndex((item) => item.contentHash === font.contentHash);
  if (existingIndex === -1) {
    if (message.type === 'FONT_SAVED') {
      fontsForTab = [font, ...fontsForTab];
      renderFontList(fontsForTab);

    }
    return;
  }

  fontsForTab = fontsForTab.map((item, index) => (index === existingIndex ? { ...item, ...font } : item));
  renderFontList(fontsForTab);


  if (currentFont?.contentHash === font.contentHash) {
    currentFont = { ...currentFont, ...font };
    void selectFont(currentFont);
  }
});

slider?.addEventListener('input', () => {
  const size = Number.parseInt(slider.value, 10);
  if (!Number.isFinite(size)) {
    return;
  }

  if (sizeDisplay) {
    sizeDisplay.textContent = `${size}px`;
  }
  if (previewText) {
    previewText.style.fontSize = `${size}px`;
  }
  void saveFontSize(size);
});

exportBtn?.addEventListener('click', async () => {
  if (!currentFont) {
    return;
  }

  setExportStatus('Exporting…', 'pending');
  const fullFont = await getFont(currentFont.contentHash);
  if (!fullFont?.fontData) {
    setExportStatus('✗ Export failed: font data not found', 'error');
    return;
  }

  const result = await exportAsOtf(
    fullFont.fontData,
    currentFont.family || 'Unknown',
    currentFont.subfamily || 'Regular',
  );

  if (result.success) {
    setExportStatus(`✓ Exported as ${result.filename}`, 'success');
    return;
  }

  setExportStatus(`✗ Export failed: ${result.error || 'Unknown error'}`, 'error');
});

document.getElementById('back-btn')?.addEventListener('click', () => {
  fontDetailPanel?.setAttribute('hidden', '');
  fontListPanel?.removeAttribute('hidden');
  clearPreviewFont();
});

document.getElementById('settings-btn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

void init();
