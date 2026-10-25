import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Plugin tests (tests/dsh/) exercise packages/dsh-scale source against
      // the live main-package source, not a possibly-stale dist/ build.
      '@hongmaple0820/scale-engine': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        // 16 physical cores on the primary dev box; 8 forks halved the full
        // suite wall time vs 4 while leaving headroom for child processes the
        // heavier suites spawn (adapter init / dashboard / CLI e2e).
        maxForks: 8,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/adapters/**'],
      // Enforce minimums matching the PR template checklist ("Coverage remains above 80%").
      // Vitest exits non-zero when any threshold is breached.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
