export interface DataUriFont {
  family: string;
  format: string;
  data: Uint8Array;
  sourceUrl: string;
}

const DATA_URI_PATTERN = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[^,)]*)?;base64,([a-z0-9+/=\s_-]+)/gi;
const URL_DATA_URI_PATTERN = /url\(\s*(['"]?)(data:[^\s)]+)\1\s*\)/gi;

export function extractDataUriFonts(): DataUriFont[] {
  const fonts: DataUriFont[] = [];
  const sheets = collectAllStyleSheets();

  for (const sheet of sheets) {
    let cssRules: CSSRuleList;

    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }

    const fontFaceRules = collectFontFaceRules(cssRules);
    for (const rule of fontFaceRules) {
      const srcValue = rule.style.getPropertyValue('src');
      if (!srcValue) {
        continue;
      }

      const family = normalizeFontFamily(rule.style.getPropertyValue('font-family'));
      const entries = extractDataUriEntries(srcValue);

      for (const entry of entries) {
        try {
          const data = decodeBase64(entry.base64);
          const format = detectFormat(entry.mimeType, entry.rawUri, entry.formatHint);

          fonts.push({
            family,
            format,
            data,
            sourceUrl: truncateDataUri(entry.rawUri),
          });
        } catch {
        }
      }
    }
  }

  return fonts;
}

function collectAllStyleSheets(): CSSStyleSheet[] {
  const seen = new Set<CSSStyleSheet>();
  const sheets: CSSStyleSheet[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    if (isCssStyleSheet(sheet) && !seen.has(sheet)) {
      seen.add(sheet);
      sheets.push(sheet);
    }
  }

  for (const root of collectShadowRoots()) {
    const rootAny = root as ShadowRoot & {
      styleSheets?: StyleSheetList;
      adoptedStyleSheets?: CSSStyleSheet[];
    };

    if (rootAny.styleSheets) {
      for (const sheet of Array.from(rootAny.styleSheets)) {
        if (isCssStyleSheet(sheet) && !seen.has(sheet)) {
          seen.add(sheet);
          sheets.push(sheet);
        }
      }
    }

    if (Array.isArray(rootAny.adoptedStyleSheets)) {
      for (const sheet of rootAny.adoptedStyleSheets) {
        if (isCssStyleSheet(sheet) && !seen.has(sheet)) {
          seen.add(sheet);
          sheets.push(sheet);
        }
      }
    }

    for (const styleEl of Array.from(root.querySelectorAll('style'))) {
      const styleSheet = styleEl.sheet;
      if (isCssStyleSheet(styleSheet) && !seen.has(styleSheet)) {
        seen.add(styleSheet);
        sheets.push(styleSheet);
      }
    }
  }

  return sheets;
}

function collectShadowRoots(): ShadowRoot[] {
  const roots: ShadowRoot[] = [];

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const maybeRoot = el.shadowRoot;
    if (maybeRoot) {
      roots.push(maybeRoot);
    }
  }

  return roots;
}

function collectFontFaceRules(ruleList: CSSRuleList): CSSFontFaceRule[] {
  const rules: CSSFontFaceRule[] = [];

  for (const rule of Array.from(ruleList)) {
    if (rule.type === CSSRule.FONT_FACE_RULE) {
      rules.push(rule as CSSFontFaceRule);
      continue;
    }

    if ('cssRules' in rule) {
      try {
        const nested = collectFontFaceRules((rule as CSSGroupingRule).cssRules);
        rules.push(...nested);
      } catch {
      }
    }
  }

  return rules;
}

function extractDataUriEntries(srcValue: string): Array<{
  rawUri: string;
  mimeType: string;
  base64: string;
  formatHint: string;
}> {
  const entries: Array<{ rawUri: string; mimeType: string; base64: string; formatHint: string }> = [];

  URL_DATA_URI_PATTERN.lastIndex = 0;
  let urlMatch: RegExpExecArray | null;
  urlMatch = URL_DATA_URI_PATTERN.exec(srcValue);
  while (urlMatch !== null) {
    const rawUri = urlMatch[2];
    const formatHint = readFormatHint(srcValue, urlMatch.index + urlMatch[0].length);

    const parsed = parseDataUri(rawUri);
    if (!parsed) {
      continue;
    }

    entries.push({
      rawUri,
      mimeType: parsed.mimeType,
      base64: parsed.base64,
      formatHint,
    });

    urlMatch = URL_DATA_URI_PATTERN.exec(srcValue);
  }

  if (entries.length > 0) {
    return entries;
  }

  DATA_URI_PATTERN.lastIndex = 0;
  let dataMatch: RegExpExecArray | null;
  dataMatch = DATA_URI_PATTERN.exec(srcValue);
  while (dataMatch !== null) {
    const mimeType = dataMatch[1];
    const base64 = dataMatch[2];
    const rawUri = dataMatch[0];
    const formatHint = readFormatHint(srcValue, dataMatch.index + dataMatch[0].length);

    entries.push({ rawUri, mimeType, base64, formatHint });

    dataMatch = DATA_URI_PATTERN.exec(srcValue);
  }

  return entries;
}

function parseDataUri(uri: string): { mimeType: string; base64: string } | null {
  DATA_URI_PATTERN.lastIndex = 0;
  const match = DATA_URI_PATTERN.exec(uri);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function detectFormat(mimeType: string, rawUri: string, formatHint: string): string {
  const normalized = mimeType.toLowerCase();

  if (normalized === 'font/woff2') {
    return 'woff2';
  }

  if (normalized === 'font/woff' || normalized === 'application/font-woff') {
    return 'woff';
  }

  if (normalized === 'font/ttf' || normalized === 'application/x-font-ttf') {
    return 'ttf';
  }

  if (normalized === 'font/otf' || normalized === 'application/x-font-opentype') {
    return 'otf';
  }

  if (normalized === 'font/sfnt') {
    return 'sfnt';
  }

  if (formatHint) {
    return formatHint;
  }

  const fallback = /font[-/]([a-z0-9+.-]+)/i.exec(rawUri);
  return fallback?.[1]?.toLowerCase() ?? 'unknown';
}

function readFormatHint(text: string, fromIndex: number): string {
  const tail = text.slice(fromIndex, fromIndex + 60);
  const match = /format\(\s*['"]?([a-z0-9+.-]+)['"]?\s*\)/i.exec(tail);
  return match?.[1]?.toLowerCase() ?? '';
}

function normalizeFontFamily(rawFamily: string): string {
  const trimmed = rawFamily.trim();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function truncateDataUri(uri: string, max = 160): string {
  if (uri.length <= max) {
    return uri;
  }

  return `${uri.slice(0, max)}...`;
}

function isCssStyleSheet(sheet: StyleSheet | null | undefined): sheet is CSSStyleSheet {
  return Boolean(sheet && 'cssRules' in sheet);
}
