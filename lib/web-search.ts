import { searchGoogleFonts } from './demo-search';

function slugify(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, '-');
}

function encodeFamily(family: string): string {
  return encodeURIComponent(family.trim());
}

interface FoundryEntry {
  match: (family: string) => boolean;
  url: (family: string) => string;
}

const KNOWN_FOUNDRIES: FoundryEntry[] = [
  // Adobe Fonts
  {
    match: (f) => {
      const lower = f.toLowerCase();
      return [
        'source sans',
        'source serif',
        'source code',
        'myriad',
        'minion',
        'acumin',
        'adobe',
        'trajan',
        'chaparral',
        'garamond premier',
      ].some((name) => lower.includes(name));
    },
    url: (f) => `https://fonts.adobe.com/fonts/${slugify(f)}`,
  },

  // DaFont
  {
    match: () => false,
    url: (f) => `https://www.dafont.com/search.php?q=${encodeFamily(f)}`,
  },

  // Font Squirrel
  {
    match: () => false,
    url: (f) => `https://www.fontsquirrel.com/fonts/${slugify(f)}`,
  },

  // MyFonts
  {
    match: (f) => {
      const lower = f.toLowerCase();
      return ['helvetica', 'frutiger', 'univers', 'avenir', 'din next'].some(
        (name) => lower.includes(name),
      );
    },
    url: (f) => `https://www.myfonts.com/search/${encodeFamily(f)}`,
  },

  // Fontspring
  {
    match: () => false,
    url: (f) => `https://www.fontspring.com/search?query=${encodeFamily(f)}`,
  },
];

/** Always returns a valid URL (never null). */
export function buildWebSearchUrl(family: string): string {
  const query = encodeURIComponent(`${family.trim()} font download`);
  return `https://www.google.com/search?q=${query}`;
}

/** Returns a known foundry URL if family matches a pattern, null otherwise. */
export function getKnownFoundryUrl(family: string): string | null {
  const trimmed = family.trim();
  if (!trimmed) return null;

  for (const foundry of KNOWN_FOUNDRIES) {
    if (foundry.match(trimmed)) {
      return foundry.url(trimmed);
    }
  }

  return null;
}

/** Fallback chain: Google Fonts → known foundry → web search URL. */
export async function findDemoUrl(family: string): Promise<string | null> {
  const trimmed = family.trim();
  if (!trimmed) return null;

  const googleFontsUrl = await searchGoogleFonts(trimmed);
  if (googleFontsUrl) return googleFontsUrl;

  const foundryUrl = getKnownFoundryUrl(trimmed);
  if (foundryUrl) return foundryUrl;

  return buildWebSearchUrl(trimmed);
}
