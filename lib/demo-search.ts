/**
 * Demo/specimen page URL lookup for fonts.
 *
 * Constructs Google Fonts specimen URLs directly (no API key needed)
 * and caches results in chrome.storage.local with a 7-day TTL.
 */

export interface DemoSearchResult {
  url: string;
  source: 'google-fonts' | 'web-search' | 'unknown';
  cachedAt: number;
}

type DemoUrlCache = Record<string, DemoSearchResult>;

const CACHE_KEY = 'demoUrlCache';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readCache(): Promise<DemoUrlCache> {
  const result = await chrome.storage.local.get(CACHE_KEY);
  return (result[CACHE_KEY] as DemoUrlCache) ?? {};
}

async function writeCache(family: string, entry: DemoSearchResult): Promise<void> {
  const cache = await readCache();
  cache[family] = entry;
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

function getValidCacheEntry(
  cache: DemoUrlCache,
  family: string,
): DemoSearchResult | null {
  const entry = cache[family];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
  return entry;
}

function buildSpecimenUrl(family: string): string {
  return `https://fonts.google.com/specimen/${family.replace(/ /g, '+')}`;
}

/** Returns the Google Fonts specimen URL for `family`, or `null` if blank. Caches in chrome.storage.local (7-day TTL). */
export async function searchGoogleFonts(family: string): Promise<string | null> {
  const trimmed = family.trim();
  if (!trimmed) return null;

  const cache = await readCache();
  const cached = getValidCacheEntry(cache, trimmed);
  if (cached) return cached.url;

  const url = buildSpecimenUrl(trimmed);

  const entry: DemoSearchResult = {
    url,
    source: 'google-fonts',
    cachedAt: Date.now(),
  };
  await writeCache(trimmed, entry);

  return url;
}
