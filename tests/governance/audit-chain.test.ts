import { describe, it, expect } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditChain,
  AuditChainBreakError,
  HmacSigner,
  Ed25519Signer,
  canonicalJson,
  sha256,
} from '../../src/governance/audit-chain';

describe('AuditChain', () => {
  it('chains entries with prevHash linking seq-by-seq', () => {
    const chain = new AuditChain<{ action: string }>();
    const a = chain.append({ action: 'a' });
    const b = chain.append({ action: 'b' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(b.prevHash).toBe(a.hash);
    expect(chain.head).toBe(b.hash);
  });

  it('verifies a valid chain', () => {
    const chain = new AuditChain<{ n: number }>();
    for (let i = 0; i < 5; i++) chain.append({ n: i });
    expect(() => AuditChain.verify(chain.snapshot())).not.toThrow();
  });

  it('throws on tampered payload', () => {
    const chain = new AuditChain<{ n: number }>();
    chain.append({ n: 1 });
    chain.append({ n: 2 });
    const snap = chain.snapshot();
    // tamper: mutate payload without recomputing hash
    (snap[0].payload as { n: number }).n = 999;
    expect(() => AuditChain.verify(snap)).toThrow(AuditChainBreakError);
  });

  it('throws on broken prevHash link', () => {
    const chain = new AuditChain<{ n: number }>();
    chain.append({ n: 1 });
    chain.append({ n: 2 });
    const snap = chain.snapshot();
    snap[1].prevHash = '0'.repeat(64);
    expect(() => AuditChain.verify(snap)).toThrow(AuditChainBreakError);
  });

  it('signs and verifies export via HMAC signer', () => {
    const signer = new HmacSigner(randomBytes(32));
    const chain = new AuditChain<{ m: string }>();
    chain.append({ m: 'one' });
    chain.append({ m: 'two' });
    const bundle = chain.exportSigned(signer);
    expect(AuditChain.verifyExport(bundle, signer)).toBe(true);
  });

  it('signs and verifies export via Ed25519 signer', () => {
    const signer = Ed25519Signer.generate();
    const chain = new AuditChain<{ m: string }>();
    chain.append({ m: 'one' });
    const bundle = chain.exportSigned(signer);
    expect(AuditChain.verifyExport(bundle, signer)).toBe(true);
  });

  it('rejects tampered export', () => {
    const signer = new HmacSigner(randomBytes(32));
    const chain = new AuditChain<{ m: string }>();
    chain.append({ m: 'one' });
    const bundle = chain.exportSigned(signer);
    (bundle.payload.entries[0].payload as { m: string }).m = 'mutated';
    expect(AuditChain.verifyExport(bundle, signer)).toBe(false);
  });

  it('loadFromDisk verifies chain across files (strict)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chain-'));
    const file = join(dir, 'chain.jsonl');
    const chain = new AuditChain<{ n: number }>();
    for (let i = 0; i < 3; i++) {
      const e = chain.append({ n: i });
      await chain.appendToFile(file, e);
    }
    const loaded = await AuditChain.loadFromDisk<{ n: number }>([file], true);
    expect(loaded.length).toBe(3);
    expect(loaded.head).toBe(chain.head);
  });

  it('loadFromDisk throws on chain break', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chain-'));
    const file = join(dir, 'chain.jsonl');
    const chain = new AuditChain<{ n: number }>();
    for (let i = 0; i < 2; i++) {
      const e = chain.append({ n: i });
      await chain.appendToFile(file, e);
    }
    // corrupt line 2
    const raw = await readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const bad = JSON.parse(lines[1]);
    bad.prevHash = '0'.repeat(64);
    lines[1] = JSON.stringify(bad);
    await writeFile(file, lines.join('\n') + '\n');
    await expect(AuditChain.loadFromDisk([file], true)).rejects.toThrow(AuditChainBreakError);
  });

  it('canonicalJson is stable across key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(sha256(canonicalJson({ b: 1, a: 2 }))).toBe(sha256(canonicalJson({ a: 2, b: 1 })));
  });
});
