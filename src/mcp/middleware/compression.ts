import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { logger } from '../../utils/logger.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Result of a compression operation, including size metrics.
 */
export interface CompressionResult {
  compressed: Buffer;
  originalSize: number;
  compressedSize: number;
  ratio: number;
}

/** Default byte threshold below which compression is not worthwhile. */
const DEFAULT_THRESHOLD = 1024;

/**
 * Determine whether a string payload is large enough to benefit from
 * gzip compression.
 *
 * @param data      - The string payload to evaluate.
 * @param threshold - Minimum byte length to trigger compression (default 1024).
 * @returns `true` when the UTF-8 byte length of `data` exceeds `threshold`.
 */
export function shouldCompress(data: string, threshold: number = DEFAULT_THRESHOLD): boolean {
  return Buffer.byteLength(data, 'utf-8') > threshold;
}

/**
 * Compress a string payload using gzip.
 *
 * @param data - UTF-8 string to compress.
 * @returns A `CompressionResult` with the compressed buffer and size metrics.
 */
export async function compressResponse(data: string): Promise<CompressionResult> {
  const input = Buffer.from(data, 'utf-8');
  const originalSize = input.length;

  try {
    const compressed = await gzipAsync(input);
    const compressedSize = compressed.length;
    const ratio = originalSize > 0 ? compressedSize / originalSize : 1;

    logger.debug('Response compressed', {
      originalSize,
      compressedSize,
      ratio: ratio.toFixed(3),
    });

    return { compressed, originalSize, compressedSize, ratio };
  } catch (error) {
    logger.error('Compression failed', { error, originalSize });
    throw error;
  }
}

/**
 * Decompress a gzip buffer back to a UTF-8 string.
 *
 * @param data - Gzip-compressed buffer.
 * @returns The decompressed string.
 */
export async function decompressResponse(data: Buffer): Promise<string> {
  try {
    const decompressed = await gunzipAsync(data);
    return decompressed.toString('utf-8');
  } catch (error) {
    logger.error('Decompression failed', { error, inputSize: data.length });
    throw error;
  }
}
