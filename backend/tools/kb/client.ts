/** HTTP side of `kb`: talks to the Trader API. Takes `fetch` as a parameter so specs can fake it. */
import type { Edge, GraphInput, GraphNode, NodeInput } from '../../src/knowledge/graph.js';

export class KbError extends Error {}

export interface Config {
  url: string;
  key: string;
}

export interface Graph {
  symbol: string;
  version: number;
  updatedAt: string;
  lastViewedAt: string | null;
  nodes: GraphNode[];
  edges: Edge[];
}

export interface VersionRow {
  version: number;
  message: string;
  createdAt: string;
}

export interface ListRow {
  symbol: string;
  nodeCount: number;
  updatedAt: string;
  hasNew: boolean;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface ErrorBody {
  message?: string | string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Strips server-owned fields; a clear KbError for a hand-edited file whose shape would otherwise crash. */
export function plain(g: GraphInput): GraphInput {
  if (!isObject(g) || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new KbError('The file must be {"nodes": […], "edges": […]}.');
  }
  g.nodes.forEach((n, i) => {
    if (!isObject(n)) throw new KbError(`node #${i + 1}: must be an object`);
    const where = `node ${typeof n.id === 'string' ? n.id : `#${i + 1}`}`;
    const s = (n as { sources?: unknown }).sources;
    if (s !== undefined) {
      const ok = Array.isArray(s) && s.every((x) => isObject(x) && typeof x.label === 'string' && typeof x.url === 'string');
      if (!ok) throw new KbError(`${where}: sources must be a list of {label, url}`);
    }
  });
  g.edges.forEach((e, i) => {
    if (!isObject(e)) throw new KbError(`edge #${i + 1}: must be an object {from, to, label}`);
  });
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

export class Client {
  constructor(
    private readonly cfg: Config,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.url}/api/knowledge${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.key}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new KbError(`Cannot reach ${this.cfg.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data: data as T };
  }

  fail(status: number, data: unknown, symbol: string): never {
    if (status === 409) throw new KbError(`${symbol} changed since it was read — run the command again.`);
    const m = (data as ErrorBody | null)?.message;
    throw new KbError(Array.isArray(m) ? m.join('\n') : typeof m === 'string' ? m : `request failed (HTTP ${status})`);
  }

  private path(symbol: string, suffix = ''): string {
    return `/${encodeURIComponent(symbol)}${suffix}`;
  }

  async list(): Promise<ListRow[]> {
    const r = await this.request<ListRow[]>('GET', '');
    if (r.status !== 200) this.fail(r.status, r.data, 'list');
    return r.data;
  }

  async getGraph(symbol: string): Promise<Graph | null> {
    const r = await this.request<Graph>('GET', this.path(symbol));
    if (r.status === 404) return null;
    if (r.status !== 200) this.fail(r.status, r.data, symbol);
    return r.data;
  }

  async needGraph(symbol: string): Promise<Graph> {
    const g = await this.getGraph(symbol);
    if (!g) throw new KbError(`No knowledge on ${symbol} yet.`);
    return g;
  }

  /** Whether the ticker is a company (the fundamentals endpoint answers 404 "not a company" otherwise). */
  async isCompany(symbol: string): Promise<boolean> {
    const r = await this.request<unknown>('GET', this.path(symbol, '/fundamentals'));
    if (r.status === 200) return true;
    const m = (r.data as ErrorBody | null)?.message;
    if (r.status === 404 && typeof m === 'string' && m.includes('not a company')) return false;
    return this.fail(r.status, r.data, symbol);
  }

  async versions(symbol: string): Promise<VersionRow[]> {
    const r = await this.request<VersionRow[]>('GET', this.path(symbol, '/versions'));
    if (r.status !== 200) this.fail(r.status, r.data, symbol);
    return r.data;
  }

  /**
   * Base version for a write that may create the graph. GET is 404 for a
   * deleted graph, so fall back to its newest version (writing at it
   * un-deletes); no versions at all means a brand-new graph (0).
   */
  async baseForCreate(symbol: string): Promise<{ baseVersion: number; deleted: boolean; current: Graph | null }> {
    const current = await this.getGraph(symbol);
    if (current) return { baseVersion: current.version, deleted: false, current };
    // /versions is 404 for a symbol that never had a graph.
    const r = await this.request<VersionRow[]>('GET', this.path(symbol, '/versions'));
    if (r.status !== 200 && r.status !== 404) this.fail(r.status, r.data, symbol);
    const versions = r.status === 200 ? r.data : [];
    if (versions.length > 0) return { baseVersion: versions[0].version, deleted: true, current: null };
    return { baseVersion: 0, deleted: false, current: null };
  }

  async save(symbol: string, baseVersion: number, message: string, g: GraphInput): Promise<Graph> {
    if (message.length < 1 || message.length > 120) throw new KbError('The message must be 1 to 120 characters.');
    const r = await this.request<Graph>('PUT', this.path(symbol), { baseVersion, message, ...plain(g) });
    if (r.status !== 200 && r.status !== 201) this.fail(r.status, r.data, symbol);
    return r.data;
  }

  async revert(symbol: string, version: number, message: string): Promise<Graph> {
    const latest = (await this.versions(symbol))[0]?.version;
    if (latest === undefined) throw new KbError(`No knowledge on ${symbol} yet.`);
    const r = await this.request<Graph>('POST', this.path(symbol, '/revert'), { baseVersion: latest, version, message });
    if (r.status !== 200 && r.status !== 201) this.fail(r.status, r.data, symbol);
    return r.data;
  }

  /** Deletes the graph; returns the new version when the history shows it. */
  async remove(symbol: string, message: string): Promise<number | null> {
    const cur = await this.needGraph(symbol);
    const r = await this.request<unknown>('DELETE', this.path(symbol), { baseVersion: cur.version, message });
    if (r.status !== 200) this.fail(r.status, r.data, symbol);
    try {
      const v = (await this.versions(symbol))[0]?.version;
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }
}
