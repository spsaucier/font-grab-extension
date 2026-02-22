import * as fontkit from 'fontkit';
import { logger } from './logger';

const WOFF2_MAGIC = 0x774f4632; // 'wOF2'
const WOFF1_MAGIC = 0x774f4646; // 'wOFF'
const OTF_MAGIC = 0x4f54544f; // 'OTTO'
const TTF_MAGIC = 0x00010000;
const TTF_TRUE_MAGIC = 0x74727565; // 'true'

export function detectFontFormat(data: Uint8Array): string {
  if (data.length < 4) {
    return 'unknown';
  }

  const magic =
    (data[0] << 24) |
    (data[1] << 16) |
    (data[2] << 8) |
    data[3];

  if (magic === WOFF2_MAGIC) return 'woff2';
  if (magic === WOFF1_MAGIC) return 'woff';
  if (magic === OTF_MAGIC) return 'otf';
  if (magic === TTF_MAGIC || magic === TTF_TRUE_MAGIC) return 'ttf';

  return 'unknown';
}

type FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf' | 'unknown';

function normalizeFormat(format: string): FontFormat {
  switch (format.toLowerCase()) {
    case 'woff2':
    case 'woff':
    case 'ttf':
    case 'otf':
      return format.toLowerCase() as FontFormat;
    default:
      return 'unknown';
  }
}

/**
 * Decompress a font to raw sfnt bytes.
 * - WOFF2: use fontkit (pure-JS brotli, no WASM)
 * - WOFF1/TTF/OTF: pass through
 */
export async function decompressFont(data: Uint8Array, format: string): Promise<Uint8Array> {
  const requestedFormat = normalizeFormat(format);
  const detectedFormat = normalizeFormat(detectFontFormat(data));
  const effectiveFormat = requestedFormat === 'unknown' ? detectedFormat : requestedFormat;

  if (effectiveFormat !== 'woff2') {
    return data;
  }

  try {
    // fontkit.create() accepts Uint8Array directly — no Buffer needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const font = (fontkit as any).create(data) as any;

    // After parsing WOFF2, fontkit stores the decompressed sfnt in font.stream.buffer
    // This is the raw TTF/OTF bytes that opentype.js can parse.
    const streamBuf: Uint8Array = font.stream?.buffer ?? font._buf ?? data;

    if (streamBuf && streamBuf.byteLength > 0 && streamBuf.byteLength < data.byteLength * 10) {
      return new Uint8Array(
        streamBuf.buffer ?? streamBuf,
        streamBuf.byteOffset ?? 0,
        streamBuf.byteLength,
      );
    }

    logger.warn('Could not extract decompressed sfnt from fontkit, using original');
    return data;
  } catch (error) {
    logger.warn('fontkit WOFF2 decompression failed, using original data', error);
    return data;
  }
}
