import './style.css';
import { logger } from '../../lib/logger';
import { DB_NAME } from '../../lib/storage';

const debugModeToggle = document.getElementById('debug-mode-toggle') as HTMLInputElement | null;
const defaultSampleText = document.getElementById('default-sample-text') as HTMLTextAreaElement | null;
const previewFontSize = document.getElementById('preview-font-size') as HTMLInputElement | null;
const charCountEl = document.getElementById('char-count');
const clearFontsBtn = document.getElementById('clear-fonts-btn') as HTMLButtonElement | null;
const confirmationDialog = document.getElementById('confirmation-dialog');
const dialogCancel = document.getElementById('dialog-cancel') as HTMLButtonElement | null;
const dialogConfirm = document.getElementById('dialog-confirm') as HTMLButtonElement | null;

const debugModeIndicator = document.getElementById('debug-mode-indicator');
const sampleTextIndicator = document.getElementById('sample-text-indicator');
const fontSizeIndicator = document.getElementById('font-size-indicator');
const clearFontsIndicator = document.getElementById('clear-fonts-indicator');

function showSaveIndicator(indicator: HTMLElement | null): void {
  if (!indicator) return;
  indicator.removeAttribute('hidden');
  setTimeout(() => {
    indicator.setAttribute('hidden', '');
  }, 1500);
}

async function loadSettings(): Promise<void> {
  const settings = await chrome.storage.sync.get(['debugMode', 'defaultSampleText', 'previewFontSize']);

  if (debugModeToggle) {
    debugModeToggle.checked = settings.debugMode ?? false;
  }

  if (defaultSampleText) {
    defaultSampleText.value = settings.defaultSampleText ?? 'The quick brown fox jumps over the lazy dog';
    updateCharCount();
  }

  if (previewFontSize) {
    previewFontSize.value = String(settings.previewFontSize ?? 36);
  }
}

function updateCharCount(): void {
  if (!defaultSampleText || !charCountEl) return;
  charCountEl.textContent = String(defaultSampleText.value.length);
}

async function saveDebugMode(): Promise<void> {
  if (!debugModeToggle) return;
  await chrome.storage.sync.set({ debugMode: debugModeToggle.checked });
  showSaveIndicator(debugModeIndicator);
}

async function saveSampleText(): Promise<void> {
  if (!defaultSampleText) return;
  await chrome.storage.sync.set({ defaultSampleText: defaultSampleText.value });
  showSaveIndicator(sampleTextIndicator);
}

async function saveFontSize(): Promise<void> {
  if (!previewFontSize) return;
  const size = Number.parseInt(previewFontSize.value, 10);
  if (Number.isFinite(size) && size >= 12 && size <= 144) {
    await chrome.storage.sync.set({ previewFontSize: size });
    showSaveIndicator(fontSizeIndicator);
  }
}

function showConfirmationDialog(): void {
  confirmationDialog?.removeAttribute('hidden');
}

function hideConfirmationDialog(): void {
  confirmationDialog?.setAttribute('hidden', '');
}

async function clearAllFonts(): Promise<void> {
  hideConfirmationDialog();

  await chrome.storage.local.clear();

  const dbDeleteRequest = indexedDB.deleteDatabase(DB_NAME);
  dbDeleteRequest.onsuccess = () => {
    showSaveIndicator(clearFontsIndicator);
  };
  dbDeleteRequest.onerror = () => {
    logger.error('Failed to delete IndexedDB database');
  };
}

debugModeToggle?.addEventListener('change', () => {
  void saveDebugMode();
});

defaultSampleText?.addEventListener('input', () => {
  updateCharCount();
  void saveSampleText();
});

previewFontSize?.addEventListener('change', () => {
  void saveFontSize();
});

clearFontsBtn?.addEventListener('click', () => {
  showConfirmationDialog();
});

dialogCancel?.addEventListener('click', () => {
  hideConfirmationDialog();
});

dialogConfirm?.addEventListener('click', () => {
  void clearAllFonts();
});

confirmationDialog?.addEventListener('click', (event) => {
  if (event.target === confirmationDialog) {
    hideConfirmationDialog();
  }
});

void loadSettings();
