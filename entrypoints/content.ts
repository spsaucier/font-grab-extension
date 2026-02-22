const FONT_EXTENSION_RE = /\.(woff2?|ttf|otf)(?:[?#]|$)/i;
const FONT_MIME_RE = /(font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-(?:woff|ttf|otf)|octet-stream))/i;
const FONT_PATH_HINT_RE = /(?:^|\/)fonts?(?:\/|$)|webfont|typeface/i;
const FONT_FACE_BLOCK_RE = /@font-face\s*\{[\s\S]*?\}/gi;
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const FONT_FAMILY_RE = /font-family\s*:\s*['"]?([^'";,\n]+)['"]?/i;

function normalizeUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function hasFontHint(url: string, initiatorType?: string, contentType?: string): boolean {
  if (FONT_EXTENSION_RE.test(url)) {
    return true;
  }

  if (contentType && FONT_MIME_RE.test(contentType)) {
    return true;
  }

  if (initiatorType === 'font') {
    return true;
  }

  return initiatorType === 'css' && FONT_PATH_HINT_RE.test(url);
}

function extractNameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() ?? '';
    const name = filename
      .replace(/\.(woff2?|ttf|otf)$/i, '')
      .replace(/[-_](regular|bold|italic|light|medium|semibold|thin|black|condensed|expanded|v\d+|\d{3}).*$/i, '')
      .replace(/[-_]/g, ' ')
      .trim();

    return name.length > 1 ? name : undefined;
  } catch {
    return undefined;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    try {
      const reportedUrls = new Set<string>();
      const sentCssFamilyByUrl = new Map<string, string>();

      const reportFontUrl = (candidateUrl: string, initiatorType?: string, contentType?: string, cssFamily?: string) => {
        const normalizedUrl = normalizeUrl(candidateUrl);
        const normalizedCssFamily = cssFamily?.trim() || undefined;

        if (!hasFontHint(normalizedUrl, initiatorType, contentType)) {
          return;
        }

        if (reportedUrls.has(normalizedUrl)) {
          if (normalizedCssFamily && normalizedCssFamily !== sentCssFamilyByUrl.get(normalizedUrl)) {
            sentCssFamilyByUrl.set(normalizedUrl, normalizedCssFamily);

            try {
              chrome.runtime.sendMessage({
                type: 'FONT_CSS_FAMILY_UPDATE',
                url: normalizedUrl,
                cssFamily: normalizedCssFamily,
              }, () => {
                void chrome.runtime.lastError;
              });
            } catch {}
          }

          return;
        }

        reportedUrls.add(normalizedUrl);
        sentCssFamilyByUrl.set(normalizedUrl, normalizedCssFamily ?? '');

        try {
          chrome.runtime.sendMessage({
            type: 'FONT_DETECTED',
            url: normalizedUrl,
            pageUrl: window.location.href,
            timestamp: Date.now(),
            cssFamily: normalizedCssFamily,
          }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
      };

      const processResourceEntry = (entry: PerformanceEntry) => {
        const resourceEntry = entry as PerformanceResourceTiming & { contentType?: string };
        const url = resourceEntry.name;

        if (!url) {
          return;
        }

        const urlNameHint = extractNameFromUrl(url);
        reportFontUrl(url, resourceEntry.initiatorType, resourceEntry.contentType, urlNameHint);
      };

      const processResourceEntries = (entries: PerformanceEntry[]) => {
        for (const entry of entries) {
          processResourceEntry(entry);
        }
      };

      const processFontFaceCssText = (cssText: string, baseUrl: string, inheritedCssFamily?: string) => {
        const fontFaceBlocks = cssText.match(FONT_FACE_BLOCK_RE) ?? [];

        for (const block of fontFaceBlocks) {
          const cssFamilyMatch = block.match(FONT_FAMILY_RE);
          const cssFamily = cssFamilyMatch?.[1]?.replace(/['"]/g, '').trim() || inheritedCssFamily;

          URL_RE.lastIndex = 0;

          for (let match = URL_RE.exec(block); match; match = URL_RE.exec(block)) {
            let resolvedUrl = match[2];
            try {
              resolvedUrl = new URL(match[2], baseUrl).href;
            } catch {}

            reportFontUrl(resolvedUrl, 'css', undefined, cssFamily);
          }
        }
      };

      const processStyleSheet = (sheet: CSSStyleSheet, baseUrl: string) => {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const fontFaceRule = rule as CSSFontFaceRule;
              const cssFamily = fontFaceRule.style.getPropertyValue('font-family')
                ?.replace(/['"]/g, '').trim() || undefined;

              processFontFaceCssText(rule.cssText, baseUrl, cssFamily);
              continue;
            }

            if (rule.type === CSSRule.IMPORT_RULE) {
              const importRule = rule as CSSImportRule;

              if (importRule.styleSheet) {
                processStyleSheet(importRule.styleSheet, importRule.href || baseUrl);
              }
            }

            const groupedRule = rule as CSSGroupingRule;
            if (groupedRule.cssRules?.length) {
              for (const nestedRule of Array.from(groupedRule.cssRules)) {
                if (nestedRule.type === CSSRule.FONT_FACE_RULE) {
                  const fontFaceRule = nestedRule as CSSFontFaceRule;
                  const cssFamily = fontFaceRule.style.getPropertyValue('font-family')
                    ?.replace(/['"]/g, '').trim() || undefined;

                  processFontFaceCssText(nestedRule.cssText, baseUrl, cssFamily);
                }
              }
            }
          }
        } catch {}
      };

      const scanFontFaceRules = () => {
        for (const sheet of Array.from(document.styleSheets)) {
          const cssSheet = sheet as CSSStyleSheet;
          processStyleSheet(cssSheet, sheet.href || window.location.href);
        }

        for (const styleTag of Array.from(document.querySelectorAll('style'))) {
          processFontFaceCssText(styleTag.textContent || '', window.location.href);
        }
      };

      let cssScanScheduled = false;
      const scheduleCssScan = () => {
        if (cssScanScheduled) {
          return;
        }

        cssScanScheduled = true;
        queueMicrotask(() => {
          cssScanScheduled = false;
          scanFontFaceRules();
        });
      };

      processResourceEntries(performance.getEntriesByType('resource'));

      try {
        const resourceObserver = new PerformanceObserver((list) => {
          processResourceEntries(list.getEntries());
        });

        resourceObserver.observe({ type: 'resource', buffered: true });
      } catch {}

      scheduleCssScan();

      const mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            scheduleCssScan();
            continue;
          }

          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof Element)) {
              continue;
            }

            if (
              node.tagName === 'STYLE' ||
              (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet') ||
              node.querySelector('style,link[rel="stylesheet"]')
            ) {
              scheduleCssScan();
              break;
            }
          }
        }
      });

      if (document.documentElement) {
        mutationObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['href', 'rel'],
        });
      }
    } catch {}
  },
});
