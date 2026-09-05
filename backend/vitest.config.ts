import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Enforces "tests never touch the network". Must be setupFiles, not
    // globalSetup: specs run in worker processes.
    setupFiles: ['./test/offline-guard.ts'],
  },
});
