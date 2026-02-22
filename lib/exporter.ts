import opentype from 'opentype.js';
import { BOGUS_FAMILY_RE } from './metadata-parser';

export interface ExportResult {
  success: boolean;
  filename: string;
  error?: string;
}

const INVALID_FILENAME_CHARS_REGEX = /[\\/:*?"<>|]/g;
const WHITESPACE_REGEX = /\s+/g;
const DUPLICATE_HYPHEN_REGEX = /-+/g;


export function sanitizeFilename(name: string): string {
  const withoutInvalidChars = name.replace(INVALID_FILENAME_CHARS_REGEX, '');
  const withHyphens = withoutInvalidChars.replace(WHITESPACE_REGEX, '-');
  const normalized = withHyphens.replace(DUPLICATE_HYPHEN_REGEX, '-').replace(/^[-.]+|[-.]+$/g, '');
  return normalized || 'font';
}

export async function exportAsOtf(
  fontData: Uint8Array,
  family: string,
  subfamily: string,
): Promise<ExportResult> {
  const cleanFamily = BOGUS_FAMILY_RE.test(family) ? 'font' : family;
  const cleanSubfamily = BOGUS_FAMILY_RE.test(subfamily) ? '' : subfamily;
  const nameParts = [cleanFamily, cleanSubfamily].filter(Boolean);
  const baseName = sanitizeFilename(nameParts.join('-'));
  const filename = `${baseName}.otf`;

  try {
    const parsedFont = opentype.parse(fontData.buffer);
    patchNameTable(parsedFont, cleanFamily, cleanSubfamily);
    const otfBuffer = parsedFont.toArrayBuffer() as ArrayBuffer;
    const blob = new Blob([otfBuffer], { type: 'font/otf' });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);

    return { success: true, filename };
  } catch (error) {
    return {
      success: false,
      filename,
      error: error instanceof Error ? error.message : 'Failed to export OTF font',
    };
}
}

function patchNameTable(
  font: any,
  family: string,
  subfamily: string,
): void {
  if (!font.names) return;

  const safeSubfamily = subfamily || 'Regular';
  const safeFamily = family || 'Unknown';

  // Helper: set a name record to a plain English string, clearing all locales
  const setName = (key: string, value: string) => {
    font.names[key] = { en: value };
  };

  // Always write clean family + subfamily
  setName('fontFamily', safeFamily);
  setName('fontSubfamily', safeSubfamily);
  setName('preferredFamily', safeFamily);
  setName('preferredSubfamily', safeSubfamily);

  // Patch fullName
  const fullName = subfamily ? `${safeFamily} ${safeSubfamily}` : safeFamily;
  setName('fullName', fullName);

  // Scrub copyright/license fields that contain anti-reuse obfuscation text
  const BOGUS_RE = /not licensed|desktop use|all rights reserved|unauthorized|font software/i;
  for (const key of ['copyright', 'license', 'description', 'trademark'] as const) {
    const rec = font.names[key];
    if (!rec) continue;
    for (const lang of Object.keys(rec)) {
      if (typeof rec[lang] === 'string' && BOGUS_RE.test(rec[lang])) {
        rec[lang] = '';
      }
    }
  }
}