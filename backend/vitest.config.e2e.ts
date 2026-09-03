import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Enforces "tests never touch the network". Must be setupFiles, not
    // globalSetup: globalSetup runs once in vitest's main process, while specs
    // execute in workers that would never see the patch.
    setupFiles: ['./test/offline-guard.ts'],
    /**
     * Every e2e file shares one `trader_test` database and truncates tables in
     * beforeEach. Run in parallel they deadlock and stomp on each other's rows,
     * producing failures that look like application bugs but are not. Unit
     * tests are unaffected — they touch no database and still run in parallel.
     */
    fileParallelism: false,
  },
});
