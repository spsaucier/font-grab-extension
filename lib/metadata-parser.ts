import * as fontkit from 'fontkit';
import { logger } from './logger';

export interface UnicodeRange {
  start: number;
  end: number;
}

export interface FontMetadata {
  family: string;
  subfamily: string;
  version: string;
  designer: string;
  manufacturer: string;
  license: string;
  licenseUrl: string;
  description: string;
  glyphCount: number;
  unicodeRanges: UnicodeRange[];
}

const EMPTY_METADATA: FontMetadata = {
  family: '',
  subfamily: '',
  version: '',
  designer: '',
  manufacturer: '',
  license: '',
  licenseUrl: '',
  description: '',
  glyphCount: 0,
  unicodeRanges: [],
};

type NameRecordEntry = string | Record<string, string>;

function getNameRecord(records: Record<string, NameRecordEntry> | undefined, key: string): string {
  const entry = records?.[key];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return entry.en
    || entry['en-US']
    || entry['en-GB']
    || entry['0-0']
    || entry['3-0']
    || entry['3-1033']
    || Object.values(entry).find((v): v is string => typeof v === 'string' && v.trim().length > 0)
    || '';
}

// Heuristic: some foundries (e.g. Klim) store copyright/license text in the
// familyName field as an obfuscation technique. Detect and reject these.
export const BOGUS_FAMILY_RE = /copyright|\u00a9|all rights reserved|foundry|typeface|font software|licensed|unauthorized/i;

function sanitizeFamilyName(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (BOGUS_FAMILY_RE.test(trimmed)) return '';
  return trimmed;
}

const BOGUS_SUBFAMILY_RE = /^(style|roman|regular|normal|plain|book|text|display|web|desktop|print|screen)$/i;
function sanitizeSubfamily(name: string | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (BOGUS_SUBFAMILY_RE.test(trimmed)) return '';
  if (BOGUS_FAMILY_RE.test(trimmed)) return '';
  return trimmed;
}

function extractUnicodeRanges(font: { characterSet?: number[] }): UnicodeRange[] {
  try {
    const charset: number[] = font.characterSet ?? [];
    if (charset.length === 0) return [];

    const sorted = [...charset].sort((a, b) => a - b);
    const ranges: UnicodeRange[] = [];
    let rangeStart = sorted[0];
    let previous = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === previous + 1) {
        previous = sorted[i];
        continue;
      }
      ranges.push({ start: rangeStart, end: previous });
      rangeStart = sorted[i];
      previous = sorted[i];
    }

    ranges.push({ start: rangeStart, end: previous });
    return ranges;
  } catch {
    return [];
  }
}

export async function parseFontMetadata(data: Uint8Array, cssFamily?: string): Promise<FontMetadata> {
  try {
    // fontkit.create() accepts Uint8Array directly — no Buffer needed
    const font = (fontkit as any).create(data) as {
      familyName?: string;
      subfamilyName?: string;
      version?: string;
      numGlyphs?: number;
      characterSet?: number[];
      name?: {
        records?: Record<string, NameRecordEntry>;
      };
    };
    const records = font.name?.records;

    if (!font.familyName) {
      logger.warn('fontkit familyName empty, records:', JSON.stringify(font.name?.records).slice(0, 200));
    }

    return {
      family: sanitizeFamilyName(font.familyName) || sanitizeFamilyName(getNameRecord(records, 'preferredFamily')) || sanitizeFamilyName(getNameRecord(records, 'fontFamily')) || cssFamily || '',
      subfamily: sanitizeSubfamily(font.subfamilyName) || sanitizeSubfamily(getNameRecord(records, 'preferredSubfamily')) || sanitizeSubfamily(getNameRecord(records, 'fontSubfamily')) || '',
      version: font.version || getNameRecord(records, 'version') || '',
      designer: getNameRecord(records, 'designer'),
      manufacturer: getNameRecord(records, 'manufacturer'),
      license: getNameRecord(records, 'license'),
      licenseUrl: getNameRecord(records, 'licenseURL'),
      description: getNameRecord(records, 'description'),
      glyphCount: font.numGlyphs ?? 0,
      unicodeRanges: extractUnicodeRanges(font),
    };
  } catch {
    return { ...EMPTY_METADATA };
  }
}
