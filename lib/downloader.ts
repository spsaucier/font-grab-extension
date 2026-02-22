import { logger } from './logger';

const MAX_FONT_SIZE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface DownloadResult {
  data: Uint8Array;
  mimeType: string;
  finalUrl: string;
  fileSize: number;
}

export class FontTooLargeError extends Error {
  constructor(url: string, size: number) {
    super(`Font too large (${(size / 1024 / 1024).toFixed(1)}MB > 25MB): ${url}`);
    this.name = 'FontTooLargeError';
  }
}

export async function downloadFont(url: string, pageUrl: string): Promise<DownloadResult> {
  const pageOrigin = new URL(pageUrl).origin;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await attemptDownload(url, pageUrl, pageOrigin);
    } catch (error) {
      if (error instanceof FontTooLargeError) {
        throw error;
      }

      if (isHttpClientError(error)) {
        throw error;
      }

      const canRetry = attempt < MAX_RETRIES && isRetryableNetworkError(error);
      if (!canRetry) {
        logger.error('Failed to download font', { url, pageUrl, attempt, error });
        throw error;
      }

      logger.warn('Retrying font download after network failure', {
        url,
        pageUrl,
        attempt,
        retriesRemaining: MAX_RETRIES - attempt,
      });
    }
  }

  throw new Error(`Failed to download font: ${url}`);
}

async function attemptDownload(url: string, referer: string, origin: string): Promise<DownloadResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Referer: referer,
        Origin: origin,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpStatusError(response.status, response.statusText, response.url || url);
    }

    const finalUrl = response.url || url;
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const parsedSize = Number.parseInt(contentLength, 10);
      if (Number.isFinite(parsedSize) && parsedSize > MAX_FONT_SIZE_BYTES) {
        throw new FontTooLargeError(finalUrl, parsedSize);
      }
    }

    const { data, fileSize } = await readResponseData(response, finalUrl);
    const mimeType = normalizeMimeType(response.headers.get('content-type'));

    return {
      data,
      mimeType,
      finalUrl,
      fileSize,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseData(response: Response, url: string): Promise<{ data: Uint8Array; fileSize: number }> {
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_FONT_SIZE_BYTES) {
      throw new FontTooLargeError(url, data.byteLength);
    }
    return { data, fileSize: data.byteLength };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalSize += value.byteLength;
    if (totalSize > MAX_FONT_SIZE_BYTES) {
      throw new FontTooLargeError(url, totalSize);
    }

    chunks.push(value);
  }

  const data = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { data, fileSize: totalSize };
}

function normalizeMimeType(contentType: string | null): string {
  if (!contentType) {
    return 'application/octet-stream';
  }

  const [mimeType] = contentType.split(';');
  return mimeType.trim() || 'application/octet-stream';
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error instanceof HttpStatusError) {
    return false;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  return error instanceof TypeError;
}

function isHttpClientError(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status >= 400 && error.status < 500;
}

class HttpStatusError extends Error {
  status: number;

  constructor(status: number, statusText: string, url: string) {
    super(`Failed to download font (${status} ${statusText}): ${url}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}
