import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { readContentFile, writeContentFile, mergeContent, readManifest, writeManifest } from '../core/content.js';

const TEST_DIR = join(process.cwd(), '.test-content');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readContentFile', () => {
  it('returns empty object for non-existent file', () => {
    const result = readContentFile(TEST_DIR, 'en');
    expect(result).toEqual({});
  });

  it('reads an existing content file', () => {
    const data = { 'key1': 'value1', 'key2': 'value2' };
    writeContentFile(TEST_DIR, 'en', data);
    const result = readContentFile(TEST_DIR, 'en');
    expect(result).toEqual(data);
  });
});

describe('writeContentFile', () => {
  it('creates the directory if needed', () => {
    const nestedDir = join(TEST_DIR, 'nested', 'dir');
    writeContentFile(nestedDir, 'en', { key: 'value' });
    const raw = readFileSync(join(nestedDir, 'content.en.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ key: 'value' });
  });

  it('writes with sorted keys', () => {
    writeContentFile(TEST_DIR, 'en', { z: '1', a: '2', m: '3' });
    const raw = readFileSync(join(TEST_DIR, 'content.en.json'), 'utf-8');
    const keys = Object.keys(JSON.parse(raw));
    expect(keys).toEqual(['a', 'm', 'z']);
  });
});

describe('mergeContent', () => {
  it('adds new keys', () => {
    const result = mergeContent({ a: '1' }, { b: '2' });
    expect(result).toEqual({ a: '1', b: '2' });
  });

  it('overwrites existing keys', () => {
    const result = mergeContent({ a: '1' }, { a: '2' });
    expect(result).toEqual({ a: '2' });
  });

  it('preserves keys not in changes', () => {
    const result = mergeContent({ a: '1', b: '2' }, { b: '3' });
    expect(result).toEqual({ a: '1', b: '3' });
  });
});

describe('manifest read/write', () => {
  it('returns empty manifest for non-existent file', () => {
    expect(readManifest(TEST_DIR)).toEqual({});
  });

  it('round-trips manifest data', () => {
    const manifest = {
      'key1': {
        key: 'key1',
        contentHash: 'abc123',
        filePath: 'app/page.tsx',
        line: 5,
        column: 6,
        elementTag: 'h1',
        attribute: 'children',
        lastExtracted: '2024-01-01T00:00:00.000Z',
      },
    };
    writeManifest(TEST_DIR, manifest);
    expect(readManifest(TEST_DIR)).toEqual(manifest);
  });
});
