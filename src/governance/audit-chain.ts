import {
  createHash,
  createHmac,
  generateKeyPairSync,
  KeyObject,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { writeFile, readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Tamper-evident audit chain (Framework §8.2).
 *
 * Every entry is SHA-256 chained to its predecessor; any edit invalidates all
 * subsequent entries. Daily manifests are signed (Ed25519 prod, HMAC-SHA256
 * dev). Exports carry (payload, signature, algorithm) with canonical JSON
 * serialisation so a regulator can verify independently.
 */

export type SignerAlgorithm = 'ed25519' | 'hmac-sha256';

export interface ChainEntry<T = unknown> {
  seq: number;
  timestamp: string;
  prevHash: string;
  payload: T;
  hash: string;
}

export interface ChainManifest {
  date: string;
  fileSha256: string;
  entryCount: number;
  firstSeq: number;
  lastSeq: number;
  lastHash: string;
  signature: string;
  algorithm: SignerAlgorithm;
}

export interface SignedExport<T = unknown> {
  payload: { entries: ChainEntry<T>[]; generatedAt: string };
  signature: string;
  algorithm: SignerAlgorithm;
}

export interface Signer {
  algorithm: SignerAlgorithm;
  sign(data: string): string;
  verify(data: string, signature: string): boolean;
}

const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export class HmacSigner implements Signer {
  readonly algorithm: SignerAlgorithm = 'hmac-sha256';
  constructor(private readonly secret: Buffer) {
    if (secret.length < 32) {
      throw new Error('HMAC signing secret must be ≥32 bytes');
    }
  }
  sign(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64');
  }
  verify(data: string, signature: string): boolean {
    const expected = this.sign(data);
    return timingSafeEqualB64(expected, signature);
  }
}

export class Ed25519Signer implements Signer {
  readonly algorithm: SignerAlgorithm = 'ed25519';
  constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject
  ) {}
  static fromPem(privatePem: string, publicPem: string): Ed25519Signer {
    return new Ed25519Signer(createPrivateKey(privatePem), createPublicKey(publicPem));
  }
  static generate(): Ed25519Signer {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return new Ed25519Signer(privateKey, publicKey);
  }
  sign(data: string): string {
    return edSign(null, Buffer.from(data), this.privateKey).toString('base64');
  }
  verify(data: string, signature: string): boolean {
    return edVerify(null, Buffer.from(data), this.publicKey, Buffer.from(signature, 'base64'));
  }
}

function timingSafeEqualB64(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class AuditChain<T = unknown> {
  private seq = 0;
  private prevHash = GENESIS_HASH;
  private readonly entries: ChainEntry<T>[] = [];

  append(payload: T, at: Date = new Date()): ChainEntry<T> {
    this.seq += 1;
    const entry: ChainEntry<T> = {
      seq: this.seq,
      timestamp: at.toISOString(),
      prevHash: this.prevHash,
      payload,
      hash: '',
    };
    entry.hash = sha256(
      canonicalJson({
        seq: entry.seq,
        timestamp: entry.timestamp,
        prevHash: entry.prevHash,
        payload,
      })
    );
    this.prevHash = entry.hash;
    this.entries.push(entry);
    return entry;
  }

  get length(): number {
    return this.entries.length;
  }
  get head(): string {
    return this.prevHash;
  }
  snapshot(): ChainEntry<T>[] {
    return [...this.entries];
  }

  /** Fail-closed verification. Throws on first break (§13.4 degraded mode). */
  static verify<T>(entries: ChainEntry<T>[]): void {
    let prev = GENESIS_HASH;
    for (const entry of entries) {
      if (entry.prevHash !== prev) {
        throw new AuditChainBreakError(`chain break at seq=${entry.seq}: prevHash mismatch`);
      }
      const expected = sha256(
        canonicalJson({
          seq: entry.seq,
          timestamp: entry.timestamp,
          prevHash: entry.prevHash,
          payload: entry.payload,
        })
      );
      if (expected !== entry.hash) {
        throw new AuditChainBreakError(`chain break at seq=${entry.seq}: hash mismatch`);
      }
      prev = entry.hash;
    }
  }

  /**
   * Load existing chain from disk (JSONL across rotations). `strict=true`
   * raises on break at load time rather than silently resetting (§8.2).
   */
  static async loadFromDisk<T>(paths: string[], strict = true): Promise<AuditChain<T>> {
    const chain = new AuditChain<T>();
    for (const path of paths) {
      if (!existsSync(path)) continue;
      const raw = await readFile(path, 'utf8');
      for (const line of raw.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line) as ChainEntry<T>;
        if (strict && entry.prevHash !== chain.prevHash) {
          throw new AuditChainBreakError(`chain break loading ${path} at seq=${entry.seq}`);
        }
        chain.entries.push(entry);
        chain.seq = entry.seq;
        chain.prevHash = entry.hash;
      }
    }
    return chain;
  }

  async appendToFile(path: string, entry: ChainEntry<T>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + '\n', 'utf8');
  }

  /** Produce a signed daily manifest (§8.2). */
  async writeDailyManifest(
    dir: string,
    date: string,
    signer: Signer,
    filePath: string
  ): Promise<ChainManifest> {
    const raw = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
    const lines = raw.split('\n').filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l) as ChainEntry<T>);
    const firstSeq = parsed[0]?.seq ?? 0;
    const lastSeq = parsed[parsed.length - 1]?.seq ?? 0;
    const lastHash = parsed[parsed.length - 1]?.hash ?? GENESIS_HASH;
    const fileSha256 = sha256(raw);
    const manifestPayload = {
      date,
      fileSha256,
      entryCount: parsed.length,
      firstSeq,
      lastSeq,
      lastHash,
    };
    const signature = signer.sign(canonicalJson(manifestPayload));
    const manifest: ChainManifest = { ...manifestPayload, signature, algorithm: signer.algorithm };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `manifest-${date}.json`), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  /** Export a signed bundle for regulator hand-off. */
  exportSigned(signer: Signer, generatedAt: Date = new Date()): SignedExport<T> {
    const payload = { entries: this.snapshot(), generatedAt: generatedAt.toISOString() };
    const signature = signer.sign(canonicalJson(payload));
    return { payload, signature, algorithm: signer.algorithm };
  }

  static verifyExport<T>(bundle: SignedExport<T>, signer: Signer): boolean {
    if (bundle.algorithm !== signer.algorithm) return false;
    if (!signer.verify(canonicalJson(bundle.payload), bundle.signature)) return false;
    try {
      AuditChain.verify(bundle.payload.entries);
      return true;
    } catch {
      return false;
    }
  }
}

export class AuditChainBreakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditChainBreakError';
  }
}
