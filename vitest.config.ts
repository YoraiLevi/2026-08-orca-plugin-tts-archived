import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@orca-tts/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@orca-tts/providers': fileURLToPath(new URL('./packages/providers/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // Cross-platform: no OS-specific reporters, no snapshot path assumptions.
    environment: 'node',
    // M1 gate: an empty suite must exit 0. From M2 on, real tests carry the gate.
    passWithNoTests: true
  }
})
