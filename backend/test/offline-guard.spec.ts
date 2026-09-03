import { connect, createServer, type AddressInfo, type Server } from 'node:net';

/**
 * The guard in `offline-guard.ts` is the enforcement behind "tests never touch
 * the network". A safety net nobody tests is a safety net with a hole in it,
 * so these are the two properties it has to hold at once: the outside is
 * unreachable, and localhost is not.
 */
describe('offline guard', () => {
  it('blocks a request to an external host, naming it', async () => {
    const error = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/NVDA').then(
      () => null,
      (e: Error) => e,
    );

    // `fetch` reports a flat "fetch failed" and hides the reason in `cause`.
    // Asserting on the cause is what distinguishes "the guard stopped this"
    // from "some other network error happened to occur".
    expect(error).not.toBeNull();
    const cause = (error as Error & { cause?: Error }).cause;
    expect(cause?.message).toMatch(/OFFLINE GUARD/);
    expect(cause?.message).toContain('query1.finance.yahoo.com');
  });

  it('blocks a plain DNS lookup of an external host', async () => {
    const { lookup } = await import('node:dns/promises');
    await expect(lookup('finance.yahoo.com')).rejects.toThrow(/OFFLINE GUARD/);
  });

  it('still allows localhost, so Postgres keeps working', async () => {
    const server: Server = createServer((socket) => socket.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const reached = await new Promise<boolean>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', reject);
    });

    server.close();
    expect(reached).toBe(true);
  });
});
