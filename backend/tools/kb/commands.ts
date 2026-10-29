/** The `kb` commands: argument parsing and what each command does. No process or network globals. */
import { parseArgs } from 'node:util';
import type { GraphInput, NodeInput, Source } from '../../src/knowledge/graph.js';
import { Client, KbError, plain } from './client.js';
import type { Graph } from './client.js';
import { addNode, editNode, link, moveNode, removeNode, start, unlink } from './edits.js';
import { renderTree } from './tree.js';

export const USAGE = `Usage: kb <command> …
  list
  show SYM [--full]
  start SYM --title … --text … [--source label=url]
  add SYM --under ID --id ID --label … --title … [--text …] [--type fundamentals] [--as-of …] [--question …] [--source label=url] [-m …]
  edit SYM ID [--title …] [--text …] [--as-of …] [--question …] [--source label=url] [-m …]
  link SYM FROM TO --label … [-m …]      unlink SYM FROM TO [-m …]
  move SYM ID --under ID [--label …] [-m …]
  remove SYM ID [--with-children] [-m …]
  history SYM      revert SYM VERSION [-m …]      delete SYM [-m …]
  pull SYM FILE    push SYM FILE -m …
A value that starts with "-" must be written as --text="-3% yoy".`;

const COMMANDS = ['list', 'show', 'start', 'add', 'edit', 'link', 'unlink', 'move', 'remove', 'history', 'revert', 'delete', 'pull', 'push'];

export interface Options {
  under?: string;
  id?: string;
  label?: string;
  title?: string;
  text?: string;
  question?: string;
  type?: string;
  'as-of'?: string;
  source?: string[];
  message?: string;
  full?: boolean;
  'with-children'?: boolean;
}

export interface Parsed {
  command: string;
  options: Options;
  positionals: string[];
}

export interface Io {
  log: (line: string) => void;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
}

export function parseCli(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new KbError(`Unknown command "${command}".\n\n${USAGE}`);
  try {
    const { values, positionals } = parseArgs({
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
    return { command, options: values as Options, positionals };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      throw new KbError('Value starts with "-": write it as --text="-3% yoy" (with an equals sign).');
    }
    throw new KbError(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }
}

export function parseSources(values: string[] | undefined): Source[] | undefined {
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

function report(io: Io, saved: Graph, message: string, changedId?: string): void {
  io.log(`${saved.symbol} v${saved.version} · ${message}`);
  if (changedId) {
    const line = nodeLine(saved.nodes.find((n) => n.id === changedId));
    if (line) io.log(line);
  }
}

export async function runCommand(client: Client, parsed: Parsed, io: Io): Promise<void> {
  const { command, options: o, positionals: pos } = parsed;
  const arg = (i: number, name: string): string => {
    const v = pos[i];
    if (!v) throw new KbError(`Missing ${name}.\n\n${USAGE}`);
    return v;
  };
  const opt = (v: string | undefined, name: string): string => {
    if (v === undefined) throw new KbError(`Missing --${name}.`);
    return v;
  };

  if (command === 'list') {
    const rows = await client.list();
    if (rows.length === 0) io.log('No graphs yet.');
    for (const g of rows) {
      io.log(`${g.symbol.padEnd(8)} ${String(g.nodeCount).padStart(3)} nodes  updated ${g.updatedAt.slice(0, 10)}${g.hasNew ? '  new' : ''}`);
    }
    return;
  }

  const symbol = arg(0, 'symbol').toUpperCase();
  const msg = (fallback: string): string => o.message ?? fallback;
  const edit = async (
    message: string,
    apply: (cur: Graph) => GraphInput,
    changedId?: string,
  ): Promise<void> => {
    const cur = await client.needGraph(symbol);
    const saved = await client.save(symbol, cur.version, message, apply(cur));
    report(io, saved, message, changedId);
  };

  switch (command) {
    case 'show': {
      const g = await client.needGraph(symbol);
      io.log(`${g.symbol} v${g.version} · updated ${g.updatedAt.slice(0, 10)}`);
      io.log(renderTree(g, { full: o.full === true }));
      return;
    }
    case 'start': {
      const g = start({ title: opt(o.title, 'title'), text: opt(o.text, 'text'), sources: parseSources(o.source) });
      const base = await client.baseForCreate(symbol);
      if (base.current) throw new KbError(`${symbol} already has a graph; use add/edit.`);
      if (base.deleted) io.log(`${symbol} was deleted; starting fresh restores it as a new version.`);
      const saved = await client.save(symbol, base.baseVersion, msg('start'), g);
      report(io, saved, msg('start'), 'summary');
      return;
    }
    case 'add': {
      const id = opt(o.id, 'id');
      const type = o.type as NodeInput['type'];
      if (type !== undefined && type !== 'text' && type !== 'fundamentals') throw new KbError('--type must be text or fundamentals.');
      await edit(
        msg(`add ${id}`),
        (cur) =>
          addNode(cur, {
            under: opt(o.under, 'under'),
            id,
            label: opt(o.label, 'label'),
            title: opt(o.title, 'title'),
            text: o.text ?? '',
            type,
            asOf: o['as-of'],
            question: o.question,
            sources: parseSources(o.source),
          }),
        id,
      );
      return;
    }
    case 'edit': {
      const id = arg(1, 'node id');
      const patch: Partial<Omit<NodeInput, 'id'>> = {};
      if (o.title !== undefined) patch.title = o.title;
      if (o.text !== undefined) patch.text = o.text;
      if (o.question !== undefined) patch.question = o.question;
      if (o['as-of'] !== undefined) patch.asOf = o['as-of'];
      const sources = parseSources(o.source);
      if (sources) patch.sources = sources;
      if (Object.keys(patch).length === 0) throw new KbError('Nothing to change: pass --title, --text, --question, --as-of or --source.');
      await edit(msg(`edit ${id}`), (cur) => editNode(cur, id, patch), id);
      return;
    }
    case 'link': {
      const from = arg(1, 'from');
      const to = arg(2, 'to');
      await edit(msg(`link ${from} ${to}`), (cur) => link(cur, from, to, opt(o.label, 'label')));
      return;
    }
    case 'unlink': {
      const from = arg(1, 'from');
      const to = arg(2, 'to');
      await edit(msg(`unlink ${from} ${to}`), (cur) => unlink(cur, from, to));
      return;
    }
    case 'move': {
      const id = arg(1, 'node id');
      await edit(msg(`move ${id}`), (cur) => moveNode(cur, id, { under: opt(o.under, 'under'), label: o.label }), id);
      return;
    }
    case 'remove': {
      const id = arg(1, 'node id');
      await edit(msg(`remove ${id}`), (cur) => removeNode(cur, id, o['with-children'] === true));
      return;
    }
    case 'history': {
      for (const v of await client.versions(symbol)) {
        io.log(`v${String(v.version).padEnd(4)} ${v.createdAt.slice(0, 16).replace('T', ' ')}  ${v.message}`);
      }
      return;
    }
    case 'revert': {
      const version = Number(arg(1, 'version').replace(/^v/i, ''));
      if (!Number.isInteger(version) || version < 1) throw new KbError('The version must be a number.');
      const message = msg(`revert to v${version}`);
      const saved = await client.revert(symbol, version, message);
      io.log(`${symbol} v${saved.version} · ${message}`);
      return;
    }
    case 'delete': {
      const version = await client.remove(symbol, msg('delete'));
      io.log(`${symbol}${version === null ? '' : ` v${version}`} · deleted; revert to bring it back.`);
      return;
    }
    case 'pull': {
      const file = arg(1, 'file');
      const g = await client.needGraph(symbol);
      io.writeFile(file, `${JSON.stringify(plain(g), null, 2)}\n`);
      io.log(`${symbol} v${g.version} written to ${file}`);
      return;
    }
    case 'push': {
      const file = arg(1, 'file');
      if (o.message === undefined) throw new KbError('push needs -m "message".');
      let g: GraphInput;
      try {
        g = JSON.parse(io.readFile(file)) as GraphInput;
      } catch (err) {
        throw new KbError(`Cannot read ${file} as JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) throw new KbError('The file must be {"nodes": […], "edges": […]}.');
      const base = await client.baseForCreate(symbol);
      const saved = await client.save(symbol, base.baseVersion, o.message, g);
      report(io, saved, o.message);
      return;
    }
  }
}
