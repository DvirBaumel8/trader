/**
 * Enforces "tests never touch the network" (see CLAUDE.md) instead of merely
 * documenting it.
 *
 * The convention held only as long as everyone remembered it: the whole
 * pre-existing e2e suite broke the rule for months while the rule was written
 * down. This makes forgetting loud — a spec that reaches Yahoo fails with the
 * host it tried to call, rather than passing on a connected machine and
 * failing on a plane, in CI, or in a way that changes with the market.
 *
 * Localhost stays reachable, because Postgres is not "the network" for our
 * purposes: the suite is meant to be hermetic, not database-free.
 *
 * Loaded via `setupFiles`, NOT `globalSetup` — globalSetup runs once in
 * vitest's main process, while specs execute in worker processes that would
 * never see the patch.
 */
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '']);

function isLocal(host: unknown): boolean {
  return host === undefined || host === null || LOCAL_HOSTS.has(String(host));
}

function offline(host: unknown, api: string): Error {
  return new Error(
    `OFFLINE GUARD: ${api} tried to reach "${String(host)}" — a test touched ` +
      `the network. Stub the client instead; see test/yahoo-stub.ts.`,
  );
}

// `connect` covers plain HTTP and anything dialling a raw socket. Unix-socket
// connections carry `path` rather than `host` and are always allowed: that is
// how the worker processes talk to vitest.
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(
  this: net.Socket,
  ...args: unknown[]
) {
  const options = (typeof args[0] === 'object' && args[0] !== null ? args[0] : { host: args[1] }) as {
    host?: string;
    path?: string;
  };
  if (!options.path && !isLocal(options.host)) {
    throw offline(options.host, 'net.connect');
  }
  return realConnect.apply(this, args as Parameters<typeof realConnect>);
};

// HTTPS - and therefore `fetch` - goes through here rather than net.connect.
const realTlsConnect = tls.connect;
(tls as { connect: unknown }).connect = function patchedTlsConnect(...args: unknown[]) {
  const options = (typeof args[0] === 'object' && args[0] !== null ? args[0] : { host: args[1] }) as {
    host?: string;
    servername?: string;
  };
  if (!isLocal(options.host) && !isLocal(options.servername)) {
    throw offline(options.host ?? options.servername, 'tls.connect');
  }
  return (realTlsConnect as (...a: unknown[]) => unknown).apply(tls, args);
};

// Resolution is patched as well as connection, so a test that only looks a
// host up - and would otherwise silently depend on DNS - fails just as loudly.
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6'] as const) {
  const callbackApi = dns[name] as (...a: unknown[]) => unknown;
  (dns as unknown as Record<string, unknown>)[name] = function patchedDns(...args: unknown[]) {
    const host = args[0];
    const callback = args[args.length - 1];
    if (!isLocal(host) && typeof callback === 'function') {
      return (callback as (e: Error) => void)(offline(host, `dns.${name}`));
    }
    return callbackApi.apply(dns, args);
  };

  const promiseApi = dns.promises[name] as (...a: unknown[]) => Promise<unknown>;
  (dns.promises as unknown as Record<string, unknown>)[name] = async function patchedDnsPromise(
    ...args: unknown[]
  ) {
    if (!isLocal(args[0])) throw offline(args[0], `dns.promises.${name}`);
    return promiseApi.apply(dns.promises, args);
  };
}
