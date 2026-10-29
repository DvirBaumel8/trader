/**
 * `kb`: command-line editor for the private per-ticker knowledge graphs.
 * Run with `npm run -s kb --prefix backend -- <command> …`. Talks to the
 * Trader API with a `kb_` key from the file named by KB_ENV
 * (default ~/.config/trader-host/kb.env).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import type { Edge, GraphInput, GraphNode, NodeInput, Source } from '../../src/knowledge/graph.js';
import { addNode, editNode, link, moveNode, removeNode, start, unlink } from './edits.js';
import { renderTree } from './tree.js';

class KbError extends Error {}

interface Config {
  url: string;
  key: string;
}

interface Graph {
  symbol: string;
  version: number;
  updatedAt: string;
  lastViewedAt: string | null;
  nodes: GraphNode[];
  edges: Edge[];
}

const USAGE = `Usage: kb <command> …
  list
  show SYM [--full]
  start SYM --title … --text … [--source label=url]
  add SYM --under ID --id ID --label … --title … [--text …] [--type fundamentals] [--as-of …] [--question …] [--source label=url] [-m …]
  edit SYM ID [--title …] [--text …] [--as-of …] [--question …] [--source label=url] [-m …]
  link SYM FROM TO --label … [-m …]      unlink SYM FROM TO [-m …]
  move SYM ID --under ID [--label …] [-m …]
  remove SYM ID [--with-children] [-m …]
  history SYM      revert SYM VERSION [-m …]      delete SYM [-m …]
  pull SYM FILE    push SYM FILE -m …`;

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

async function api(cfg: Config, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/api/knowledge${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new KbError(`Cannot reach ${cfg.url}: ${reason}`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function fail(status: number, data: any, symbol: string): never {
  if (status === 409) throw new KbError(`${symbol} changed since it was read — run the command again.`);
  const m = data?.message;
  const message = Array.isArray(m) ? m.join('\n') : typeof m === 'string' ? m : `request failed (HTTP ${status})`;
  throw new KbError(message);
}

async function getGraph(cfg: Config, symbol: string): Promise<Graph | null> {
  const r = await api(cfg, 'GET', `/${encodeURIComponent(symbol)}`);
  if (r.status === 404) return null;
  if (r.status !== 200) fail(r.status, r.data, symbol);
  return r.data as Graph;
}

async function needGraph(cfg: Config, symbol: string): Promise<Graph> {
  const g = await getGraph(cfg, symbol);
  if (!g) throw new KbError(`No knowledge on ${symbol} yet.`);
  return g;
}

function plain(g: GraphInput): GraphInput {
  const nodes = g.nodes.map((n) => {
    const out: NodeInput = { id: n.id, title: n.title, text: n.text };
    if (n.type !== undefined) out.type = n.type;
    if (n.asOf !== undefined) out.asOf = n.asOf;
    if (n.question !== undefined) out.question = n.question;
    if (n.sources !== undefined) out.sources = n.sources.map((s) => ({ label: s.label, url: s.url }));
    return out;
  });
  return { nodes, edges: g.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })) };
}

async function save(
  cfg: Config,
  symbol: string,
  baseVersion: number,
  message: string,
  g: GraphInput,
): Promise<Graph> {
  if (message.length < 1 || message.length > 120) throw new KbError('The message must be 1 to 120 characters.');
  const r = await api(cfg, 'PUT', `/${encodeURIComponent(symbol)}`, { baseVersion, message, ...plain(g) });
  if (r.status !== 200 && r.status !== 201) fail(r.status, r.data, symbol);
  return r.data as Graph;
}

function parseSources(values: string[] | undefined): Source[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => {
    const i = v.indexOf('=');
    if (i < 1) throw new KbError(`--source must look like "label=url" (got "${v}")`);
    return { label: v.slice(0, i).trim(), url: v.slice(i + 1).trim() };
  });
}

function nodeLine(n: NodeInput | undefined): string {
  if (!n) return '';
  const head = `  [${n.id}] ${n.title}${n.asOf ? ` (${n.asOf})` : ''}`;
  return n.text ? `${head}\n  ${n.text}` : head;
}

function report(saved: Graph, message: string, changedId?: string): void {
  console.log(`${saved.symbol} v${saved.version} · ${message}`);
  if (changedId) {
    const line = nodeLine(saved.nodes.find((n) => n.id === changedId));
    if (line) console.log(line);
  }
}

async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    if (!command) process.exitCode = 1;
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        under: { type: 'string' },
        id: { type: 'string' },
        label: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        question: { type: 'string' },
        type: { type: 'string' },
        'as-of': { type: 'string' },
        source: { type: 'string', multiple: true },
        message: { type: 'string', short: 'm' },
        full: { type: 'boolean' },
        'with-children': { type: 'boolean' },
      },
    });
  } catch (err) {
    throw new KbError(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }
  const { values: o, positionals: pos } = parsed;
  const known = ['list', 'show', 'start', 'add', 'edit', 'link', 'unlink', 'move', 'remove', 'history', 'revert', 'delete', 'pull', 'push'];
  if (!known.includes(command)) throw new KbError(`Unknown command "${command}".\n\n${USAGE}`);

  const arg = (i: number, name: string): string => {
    const v = pos[i];
    if (!v) throw new KbError(`Missing ${name}.\n\n${USAGE}`);
    return v;
  };
  const opt = (v: string | undefined, name: string): string => {
    if (v === undefined) throw new KbError(`Missing --${name}.`);
    return v;
  };
  const cfg = loadConfig();

  if (command === 'list') {
    const r = await api(cfg, 'GET', '');
    if (r.status !== 200) fail(r.status, r.data, 'list');
    const rows = r.data as Array<{ symbol: string; nodeCount: number; updatedAt: string; hasNew: boolean }>;
    if (rows.length === 0) console.log('No graphs yet.');
    for (const g of rows) {
      console.log(`${g.symbol.padEnd(8)} ${String(g.nodeCount).padStart(3)} nodes  updated ${g.updatedAt.slice(0, 10)}${g.hasNew ? '  new' : ''}`);
    }
    return;
  }

  const symbol = arg(0, 'symbol').toUpperCase();
  const msg = (fallback: string): string => o.message ?? fallback;

  switch (command) {
    case 'show': {
      const g = await needGraph(cfg, symbol);
      console.log(`${g.symbol} v${g.version} · updated ${g.updatedAt.slice(0, 10)}`);
      console.log(renderTree(g, { full: o.full === true }));
      return;
    }
    case 'start': {
      if (await getGraph(cfg, symbol)) throw new KbError(`${symbol} already has a graph; use add/edit.`);
      const g = start({ title: opt(o.title, 'title'), text: opt(o.text, 'text'), sources: parseSources(o.source) });
      const saved = await save(cfg, symbol, 0, msg('start'), g);
      report(saved, msg('start'), 'summary');
      return;
    }
    case 'add': {
      const id = opt(o.id, 'id');
      const cur = await needGraph(cfg, symbol);
      const type = o.type === undefined ? undefined : (o.type as NodeInput['type']);
      if (type !== undefined && type !== 'text' && type !== 'fundamentals') throw new KbError('--type must be text or fundamentals.');
      const next = addNode(cur, {
        under: opt(o.under, 'under'),
        id,
        label: opt(o.label, 'label'),
        title: opt(o.title, 'title'),
        text: o.text ?? '',
        type,
        asOf: o['as-of'],
        question: o.question,
        sources: parseSources(o.source),
      });
      const saved = await save(cfg, symbol, cur.version, msg(`add ${id}`), next);
      report(saved, msg(`add ${id}`), id);
      return;
    }
    case 'edit': {
      const id = arg(1, 'node id');
      const cur = await needGraph(cfg, symbol);
      const patch: Partial<Omit<NodeInput, 'id'>> = {};
      if (o.title !== undefined) patch.title = o.title;
      if (o.text !== undefined) patch.text = o.text;
      if (o.question !== undefined) patch.question = o.question;
      if (o['as-of'] !== undefined) patch.asOf = o['as-of'];
      const sources = parseSources(o.source);
      if (sources) patch.sources = sources;
      if (Object.keys(patch).length === 0) throw new KbError('Nothing to change: pass --title, --text, --question, --as-of or --source.');
      const next = editNode(cur, id, patch);
      const saved = await save(cfg, symbol, cur.version, msg(`edit ${id}`), next);
      report(saved, msg(`edit ${id}`), id);
      return;
    }
    case 'link': {
      const from = arg(1, 'from');
      const to = arg(2, 'to');
      const cur = await needGraph(cfg, symbol);
      const saved = await save(cfg, symbol, cur.version, msg(`link ${from} ${to}`), link(cur, from, to, opt(o.label, 'label')));
      report(saved, msg(`link ${from} ${to}`));
      return;
    }
    case 'unlink': {
      const from = arg(1, 'from');
      const to = arg(2, 'to');
      const cur = await needGraph(cfg, symbol);
      const saved = await save(cfg, symbol, cur.version, msg(`unlink ${from} ${to}`), unlink(cur, from, to));
      report(saved, msg(`unlink ${from} ${to}`));
      return;
    }
    case 'move': {
      const id = arg(1, 'node id');
      const cur = await needGraph(cfg, symbol);
      const next = moveNode(cur, id, { under: opt(o.under, 'under'), label: o.label });
      const saved = await save(cfg, symbol, cur.version, msg(`move ${id}`), next);
      report(saved, msg(`move ${id}`), id);
      return;
    }
    case 'remove': {
      const id = arg(1, 'node id');
      const cur = await needGraph(cfg, symbol);
      const next = removeNode(cur, id, o['with-children'] === true);
      const saved = await save(cfg, symbol, cur.version, msg(`remove ${id}`), next);
      report(saved, msg(`remove ${id}`));
      console.log(`  removed ${cur.nodes.length - next.nodes.length} node(s)`);
      return;
    }
    case 'history': {
      const r = await api(cfg, 'GET', `/${encodeURIComponent(symbol)}/versions`);
      if (r.status !== 200) fail(r.status, r.data, symbol);
      for (const v of r.data as Array<{ version: number; message: string; createdAt: string }>) {
        console.log(`v${String(v.version).padEnd(4)} ${v.createdAt.slice(0, 16).replace('T', ' ')}  ${v.message}`);
      }
      return;
    }
    case 'revert': {
      const version = Number(arg(1, 'version').replace(/^v/i, ''));
      if (!Number.isInteger(version) || version < 1) throw new KbError('The version must be a number.');
      const vr = await api(cfg, 'GET', `/${encodeURIComponent(symbol)}/versions`);
      if (vr.status !== 200) fail(vr.status, vr.data, symbol);
      const latest = (vr.data as Array<{ version: number }>)[0]?.version;
      if (latest === undefined) throw new KbError(`No knowledge on ${symbol} yet.`);
      const message = msg(`revert to v${version}`);
      const r = await api(cfg, 'POST', `/${encodeURIComponent(symbol)}/revert`, { baseVersion: latest, version, message });
      if (r.status !== 200 && r.status !== 201) fail(r.status, r.data, symbol);
      console.log(`${symbol} v${r.data.version} · ${message}`);
      return;
    }
    case 'delete': {
      const cur = await needGraph(cfg, symbol);
      const message = msg('delete');
      const r = await api(cfg, 'DELETE', `/${encodeURIComponent(symbol)}`, { baseVersion: cur.version, message });
      if (r.status !== 200) fail(r.status, r.data, symbol);
      console.log(`${symbol} deleted (v${cur.version + 1}); revert to bring it back.`);
      return;
    }
    case 'pull': {
      const file = arg(1, 'file');
      const g = await needGraph(cfg, symbol);
      writeFileSync(file, `${JSON.stringify(plain(g), null, 2)}\n`);
      console.log(`${symbol} v${g.version} written to ${file}`);
      return;
    }
    case 'push': {
      const file = arg(1, 'file');
      if (o.message === undefined) throw new KbError('push needs -m "message".');
      let g: GraphInput;
      try {
        g = JSON.parse(readFileSync(file, 'utf8')) as GraphInput;
      } catch (err) {
        throw new KbError(`Cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) throw new KbError('The file must be {"nodes": […], "edges": […]}.');
      const cur = await getGraph(cfg, symbol);
      const saved = await save(cfg, symbol, cur?.version ?? 0, o.message, g);
      report(saved, o.message);
      return;
    }
  }
}

run(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof KbError ? err.message : `kb: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
