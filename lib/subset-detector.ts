import type { UnicodeRange } from "./metadata-parser";

const BASIC_LATIN_START = 0x0020;
const BASIC_LATIN_END = 0x007e;
const BASIC_LATIN_COUNT = BASIC_LATIN_END - BASIC_LATIN_START + 1;

const LATIN_COMBINED_START = 0x0020;
const LATIN_COMBINED_END = 0x00ff;
const LATIN_COMBINED_COUNT = LATIN_COMBINED_END - LATIN_COMBINED_START + 1;

const MIN_GLYPH_COUNT = 200;
const MIN_LATIN_COVERAGE = 0.2;

export interface SubsetResult {
  isSubset: boolean;
  coverage: number;
  totalGlyphs: number;
  reason: string;
}

function normalizeRanges(unicodeRanges: UnicodeRange[]): UnicodeRange[] {
  if (unicodeRanges.length === 0) {
    return [];
  }

  const sortedRanges = unicodeRanges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .map((range) => {
      const start = Math.max(0, Math.min(range.start, range.end));
      const end = Math.max(0, Math.max(range.start, range.end));
      return { start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (sortedRanges.length === 0) {
    return [];
  }

  const merged: UnicodeRange[] = [];

  for (const currentRange of sortedRanges) {
    const previousRange = merged[merged.length - 1];
    if (!previousRange || currentRange.start > previousRange.end + 1) {
      merged.push({ ...currentRange });
      continue;
    }

    previousRange.end = Math.max(previousRange.end, currentRange.end);
  }

  return merged;
}

function countUniqueCodepoints(ranges: UnicodeRange[]): number {
  let total = 0;

  for (const range of ranges) {
    total += range.end - range.start + 1;
  }

  return total;
}

function countCoverageInWindow(
  ranges: UnicodeRange[],
  windowStart: number,
  windowEnd: number,
): number {
  let covered = 0;

  for (const range of ranges) {
    if (range.end < windowStart || range.start > windowEnd) {
      continue;
    }

    const intersectionStart = Math.max(range.start, windowStart);
    const intersectionEnd = Math.min(range.end, windowEnd);
    covered += intersectionEnd - intersectionStart + 1;
  }

  return covered;
}

export function detectSubset(unicodeRanges: UnicodeRange[]): SubsetResult {
  // If we have no unicode range data, we cannot determine subset status
  // (fontkit may not have extracted characterSet for this font format)
  if (unicodeRanges.length === 0) {
    return {
      isSubset: false,
      coverage: 0,
      totalGlyphs: 0,
      reason: 'Unicode range data unavailable',
    };
  }

  const normalizedRanges = normalizeRanges(unicodeRanges);

  const totalGlyphs = countUniqueCodepoints(normalizedRanges);
  const basicLatinCovered = countCoverageInWindow(
    normalizedRanges,
    BASIC_LATIN_START,
    BASIC_LATIN_END,
  );
  const combinedLatinCovered = countCoverageInWindow(
    normalizedRanges,
    LATIN_COMBINED_START,
    LATIN_COMBINED_END,
  );

  const coverage = basicLatinCovered / BASIC_LATIN_COUNT;
  const combinedLatinCoverage = combinedLatinCovered / LATIN_COMBINED_COUNT;

  if (basicLatinCovered === 0) {
    return {
      isSubset: true,
      coverage,
      totalGlyphs,
      reason: "No Basic Latin coverage detected",
    };
  }

  if (combinedLatinCoverage < MIN_LATIN_COVERAGE) {
    return {
      isSubset: true,
      coverage,
      totalGlyphs,
      reason: `Limited Latin coverage (${Math.round(combinedLatinCoverage * 100)}%)`,
    };
  }

  if (totalGlyphs < MIN_GLYPH_COUNT) {
    return {
      isSubset: true,
      coverage,
      totalGlyphs,
      reason: `Only ${totalGlyphs} glyphs detected`,
    };
  }

  return {
    isSubset: false,
    coverage,
    totalGlyphs,
    reason: "Coverage appears sufficient",
  };
}
