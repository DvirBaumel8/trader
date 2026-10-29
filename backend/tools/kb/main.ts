/**
 * `kb`: command-line editor for the private per-ticker knowledge graphs.
 * Run with `npm run -s kb --prefix backend -- <command> …`. Talks to the
 * Trader API with a `kb_` key from the file named by KB_ENV
 * (default ~/.config/trader-host/kb.env).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, KbError } from './client.js';
import type { Config } from './client.js';
import { USAGE, parseCli, runCommand } from './commands.js';
import { resolveGraphFile, writableGraphPath } from './paths.js';

function loadConfig(): Config {
  const file = process.env.KB_ENV || `${homedir()}/.config/trader-host/kb.env`;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new KbError(`Cannot read ${file}. Create it with KB_API_URL and KB_API_KEY (or point KB_ENV at another file).`);
  }
  const vars = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars.set(m[1], m[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  const url = vars.get('KB_API_URL');
  const key = vars.get('KB_API_KEY');
  if (!url || !key) throw new KbError(`${file} must define KB_API_URL and KB_API_KEY.`);
  return { url: url.replace(/\/+$/, ''), key };
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    console.log(USAGE);
    if (argv.length === 0) process.exitCode = 1;
    return;
  }
  const parsed = parseCli(argv);
  const client = new Client(loadConfig());
  const where = { initCwd: process.env.INIT_CWD, cwd: process.cwd(), home: homedir() };
  const toolDir = dirname(fileURLToPath(import.meta.url));
  await runCommand(client, parsed, {
    log: (line) => console.log(line),
    // npm runs this from backend/, so relative files mean the caller's directory (INIT_CWD).
    readFile: (path) => readFileSync(resolveGraphFile(path, where), 'utf8'),
    writeFile: (path, content) => writeFileSync(writableGraphPath(path, { ...where, toolDir, hasGit: existsSync }), content),
  });
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof KbError ? err.message : `kb: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
