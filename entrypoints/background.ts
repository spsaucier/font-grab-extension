import { decompressFont, detectFontFormat } from "../lib/decompressor";
import { downloadFont } from "../lib/downloader";
import { hashFontData } from "../lib/hasher";
import { logger } from "../lib/logger";
import { BOGUS_FAMILY_RE, parseFontMetadata } from "../lib/metadata-parser";
import {
	getAllFonts,
	getFont,
	type StoredFont,
	saveFont,
} from "../lib/storage";
import { detectSubset } from "../lib/subset-detector";
import { findDemoUrl } from "../lib/web-search";

type SupportedFormat = StoredFont["format"];

interface FontDetectedMessage {
	type: "FONT_DETECTED";
	url: string;
	pageUrl: string;
	timestamp: number;
	cssFamily?: string;
}

interface FontCssFamilyUpdateMessage {
	type: "FONT_CSS_FAMILY_UPDATE";
	url: string;
	cssFamily: string;
}

interface GetFontsForTabMessage {
	type: "GET_FONTS_FOR_TAB";
	tabUrl: string;
}

const SUPPORTED_FORMATS: SupportedFormat[] = ["woff2", "woff", "ttf", "otf"];

function normalizeFormat(format: string): SupportedFormat {
	return SUPPORTED_FORMATS.includes(format as SupportedFormat)
		? (format as SupportedFormat)
		: "woff2";
}

function safeNotify(message: unknown): void {
	try {
		chrome.runtime.sendMessage(message, () => {
			void chrome.runtime.lastError;
		});
	} catch {}
}

function getOrigin(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function familyFromUrl(url: string): string {
	try {
		const pathname = new URL(url).pathname;
		const filename = pathname.split("/").pop() ?? "";

		return filename
			.replace(/\.(woff2?|ttf|otf)$/i, "")
			.replace(
				/[-_](regular|bold|italic|light|medium|semibold|thin|black|condensed|expanded|\d+).*$/i,
				"",
			)
			.replace(/[-_]/g, " ")
			.trim();
	} catch {
		return "";
	}
}

function shouldPreferCssFamily(
	font: StoredFont,
	cssFamily: string,
	sourceUrl: string,
): boolean {
	const trimmedCssFamily = cssFamily.trim();
	if (!trimmedCssFamily) {
		return false;
	}

	const currentFamily = font.family?.trim() || "";
	if (currentFamily === trimmedCssFamily) {
		return false;
	}

	if (!currentFamily || currentFamily === "Unknown") {
		return true;
	}

	return currentFamily === familyFromUrl(sourceUrl);
}

export default defineBackground(() => {
	const inProgressUrls = new Set<string>();

	const updateFontFamilyFromCss = async (
		message: FontCssFamilyUpdateMessage,
	): Promise<void> => {
		const cssFamily = message.cssFamily.trim();
		if (!cssFamily) {
			return;
		}

		try {
			const fonts = await getAllFonts();
			const matchingFonts = fonts.filter((font) => font.sourceUrl === message.url);

			for (const font of matchingFonts) {
				if (!shouldPreferCssFamily(font, cssFamily, font.sourceUrl)) {
					continue;
				}

				const updatedFont: StoredFont = { ...font, family: cssFamily };
				await saveFont(updatedFont);
				const { fontData: _fontData, ...fontWithoutData } = updatedFont;
				safeNotify({ type: "FONT_UPDATED", font: fontWithoutData });
			}
		} catch (error) {
			logger.error("Failed to apply CSS family update", {
				url: message.url,
				cssFamily: message.cssFamily,
				error,
			});
		}
	};

	const processFont = async (message: FontDetectedMessage): Promise<void> => {
		const { url, pageUrl, timestamp } = message;

		if (inProgressUrls.has(url)) {
			return;
		}

		inProgressUrls.add(url);

		try {
			const downloadResult = await downloadFont(url, pageUrl);
			const originalData = downloadResult.data;
			const detectedFormat = detectFontFormat(originalData);
			const normalizedFormat = normalizeFormat(detectedFormat);
			const decompressedData = await decompressFont(originalData, normalizedFormat);
			const contentHash = await hashFontData(decompressedData);

			const existingFont = await getFont(contentHash);
			if (existingFont) {
				const existingFamily = existingFont.family?.trim() || "";
				if (existingFamily && existingFamily !== "Unknown" && !BOGUS_FAMILY_RE.test(existingFamily)) {
					return;
				}
			}

			const metadata = await parseFontMetadata(
				decompressedData,
				message.cssFamily,
			);
			const subset = detectSubset(metadata.unicodeRanges);
			const family =
				metadata.family ||
				message.cssFamily?.trim() ||
				familyFromUrl(url) ||
				"Unknown";

			const storedFont: StoredFont = {
				contentHash,
				family,
				subfamily: metadata.subfamily || "",
				format: normalizedFormat,
				fileSize: downloadResult.fileSize,
				glyphCount: metadata.glyphCount,
				designer: metadata.designer,
				manufacturer: metadata.manufacturer,
				license: metadata.license,
				isSubset: subset.isSubset,
				demoUrl: undefined,
				sourceUrl: downloadResult.finalUrl || url,
				pageUrl,
				fontData: originalData,
				timestamp,
			};

			const finalFont: StoredFont = existingFont
				? {
						...existingFont,
						family,
						subfamily: metadata.subfamily || existingFont.subfamily,
						sourceUrl: storedFont.sourceUrl,
						pageUrl,
						timestamp,
						fontData: originalData,
				  }
				: storedFont;

			await saveFont(finalFont);
			const { fontData: _fontData, ...fontWithoutData } = finalFont;
			safeNotify({ type: existingFont ? "FONT_UPDATED" : "FONT_SAVED", font: fontWithoutData });

			void (async () => {
				try {
					const demoUrl = await findDemoUrl(finalFont.family);
					if (!demoUrl) {
						return;
					}

					const updatedFont: StoredFont = { ...finalFont, demoUrl };
					await saveFont(updatedFont);
					const { fontData: _updatedFontData, ...updatedFontWithoutData } =
						updatedFont;
					safeNotify({ type: "FONT_UPDATED", font: updatedFontWithoutData });
				} catch (error) {
					logger.error("Failed to resolve demo URL", {
						url,
						pageUrl,
						contentHash: finalFont.contentHash,
						error,
					});
				}
			})();
		} catch (error) {
			logger.error("Failed to process detected font", { url, pageUrl, error });
		} finally {
			inProgressUrls.delete(url);
		}
	};

	chrome.runtime.onMessage.addListener(
		(
			message:
				| FontDetectedMessage
				| FontCssFamilyUpdateMessage
				| GetFontsForTabMessage,
			_sender,
			sendResponse,
		) => {
			if (message.type === "FONT_DETECTED") {
				void processFont(message);
				return;
			}

			if (message.type === "FONT_CSS_FAMILY_UPDATE") {
				void updateFontFamilyFromCss(message);
				return;
			}

			if (message.type === "GET_FONTS_FOR_TAB") {
				void (async () => {
					try {
						const tabOrigin = getOrigin(message.tabUrl);
						if (!tabOrigin) {
							sendResponse([] as StoredFont[]);
							return;
						}

						const fonts = await getAllFonts();
						const filteredFonts = fonts
							.filter((font) => font.pageUrl.startsWith(tabOrigin))
							.map(({ fontData: _fontData, ...rest }) => rest);
						sendResponse(filteredFonts);
					} catch (error) {
						logger.error("Failed to get fonts for tab", {
							tabUrl: message.tabUrl,
							error,
						});
						sendResponse([] as StoredFont[]);
					}
				})();

				return true;
			}

			return;
		},
	);
});
