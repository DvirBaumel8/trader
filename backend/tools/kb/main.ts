/**
 * `kb`: command-line editor for the private per-ticker knowledge graphs.
 * Run with `npm run -s kb --prefix backend -- <command> …`. Talks to the
 * Trader API with a `kb_` key from the file named by KB_ENV
 * (default ~/.config/trader-host/kb.env).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Client, KbError } from './client.js';
import type { Config } from './client.js';
import { USAGE, parseCli, runCommand } from './commands.js';

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
  await runCommand(client, parsed, {
    log: (line) => console.log(line),
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content),
  });
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof KbError ? err.message : `kb: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
