import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    // Cross-platform: no OS-specific reporters, no snapshot path assumptions.
    environment: 'node',
    // M1 gate: an empty suite must exit 0. From M2 on, real tests carry the gate.
    passWithNoTests: true
  }
})
