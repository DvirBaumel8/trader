/** File-path rules for `kb pull` / `kb push`. Pure: the caller supplies the cwd and a `.git` probe. */
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { KbError } from './client.js';

export const PRIVATE_MESSAGE = 'Graph files are private — write them outside the repo, e.g. ~/kb/NVDA.json';

/** The nearest ancestor of `dir` (itself included) that contains `.git`, or null. */
export function repoRootOf(dir: string, hasGit: (candidate: string) => boolean): string | null {
  let cur = resolve(dir);
  for (;;) {
    if (hasGit(join(cur, '.git'))) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/**
 * Where a relative file means: npm runs scripts from backend/, so the caller's
 * directory is INIT_CWD. `~/` is expanded for quoted arguments the shell left alone.
 */
export function resolveGraphFile(file: string, base: { initCwd?: string; cwd: string; home: string }): string {
  if (file === '~' || file.startsWith('~/')) return join(base.home, file.slice(1));
  return isAbsolute(file) ? resolve(file) : resolve(base.initCwd ?? base.cwd, file);
}

/** True when `path` is the repo root or lies under it. */
export function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The resolved path to write a pulled graph to; refuses anywhere inside the repo that holds this tool. */
export function writableGraphPath(
  file: string,
  env: { initCwd?: string; cwd: string; home: string; toolDir: string; hasGit: (candidate: string) => boolean },
): string {
  const resolved = resolveGraphFile(file, env);
  const root = repoRootOf(env.toolDir, env.hasGit);
  if (root && isInside(resolved, root)) throw new KbError(PRIVATE_MESSAGE);
  return resolved;
}
