import { describe, expect, it } from 'vitest';
import { KbError } from './client.js';
import { PRIVATE_MESSAGE, repoRootOf, resolveGraphFile, writableGraphPath } from './paths.js';

const REPO = '/work/trader';
const hasGit = (p: string) => p === `${REPO}/.git`;
const env = { initCwd: REPO, cwd: `${REPO}/backend`, home: '/home/me', toolDir: `${REPO}/backend/tools/kb`, hasGit };

describe('resolveGraphFile', () => {
  it('resolves relative paths against INIT_CWD, not the npm cwd', () => {
    expect(resolveGraphFile('nvda.json', { initCwd: '/elsewhere', cwd: `${REPO}/backend`, home: '/home/me' })).toBe('/elsewhere/nvda.json');
  });
  it('falls back to cwd without INIT_CWD', () => {
    expect(resolveGraphFile('a/b.json', { cwd: '/x', home: '/h' })).toBe('/x/a/b.json');
  });
  it('keeps absolute paths and expands ~/', () => {
    expect(resolveGraphFile('/tmp/a.json', { initCwd: '/x', cwd: '/y', home: '/h' })).toBe('/tmp/a.json');
    expect(resolveGraphFile('~/kb/NVDA.json', { initCwd: '/x', cwd: '/y', home: '/home/me' })).toBe('/home/me/kb/NVDA.json');
  });
});

describe('repoRootOf', () => {
  it('walks up to the directory holding .git', () => {
    expect(repoRootOf(`${REPO}/backend/tools/kb`, hasGit)).toBe(REPO);
    expect(repoRootOf('/nowhere/deep', hasGit)).toBeNull();
  });
});

describe('writableGraphPath', () => {
  it('refuses a relative file run from the repo root (it would land in the repo)', () => {
    expect(() => writableGraphPath('nvda.json', env)).toThrow(PRIVATE_MESSAGE);
  });
  it('refuses absolute paths anywhere in the repo, including backend/ and the root itself', () => {
    expect(() => writableGraphPath(`${REPO}/backend/nvda.json`, env)).toThrow(KbError);
    expect(() => writableGraphPath(REPO, env)).toThrow(KbError);
  });
  it('allows paths outside the repo, even one with a similar prefix', () => {
    expect(writableGraphPath('~/kb/NVDA.json', env)).toBe('/home/me/kb/NVDA.json');
    expect(writableGraphPath(`${REPO}-notes/a.json`, env)).toBe(`${REPO}-notes/a.json`);
    expect(writableGraphPath('a.json', { ...env, initCwd: '/home/me/kb' })).toBe('/home/me/kb/a.json');
  });
});
