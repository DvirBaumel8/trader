import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Enforces "tests never touch the network". Must be setupFiles, not
    // globalSetup: specs run in worker processes.
    setupFiles: ['./test/offline-guard.ts'],
  },
});
