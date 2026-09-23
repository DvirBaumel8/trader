export const RENDER_HEALTH_URL = 'https://trader-backend-ufhg.onrender.com/health/ping';

type Fetcher = (input: string) => Promise<Response>;
type ErrorLogger = Pick<Console, 'error'>;

export async function pingRenderHealth(
  fetcher: Fetcher = fetch,
  logger: ErrorLogger = console,
): Promise<void> {
  try {
    const response = await fetcher(RENDER_HEALTH_URL);
    if (!response.ok) {
      logger.error(`Trader keepalive health check returned HTTP ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Trader keepalive health check failed: ${message}`);
  }
}

export default {
  scheduled(_controller, _env, ctx) {
    ctx.waitUntil(pingRenderHealth());
  },
} satisfies ExportedHandler;
