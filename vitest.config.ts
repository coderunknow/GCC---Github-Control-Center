import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors the `@/*` path alias from tsconfig so tests can import modules by the
// same specifier the application uses.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // PGlite boots a real database in-process; give it room without hiding hangs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
