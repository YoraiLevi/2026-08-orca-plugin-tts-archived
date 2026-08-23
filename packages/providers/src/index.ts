import type { TtsProvider } from '@orca-tts/core'
import { OsSynthProvider } from './os-synth/index.ts'
import { PocketSynthProvider } from './pocket-synth/index.ts'
import { ProviderRegistry } from './registry.ts'

export * from './os-synth/index.ts'
export * from './pocket-synth/index.ts'
export * from './registry.ts'

export interface BuiltInProviderOptions {
  readonly os?: TtsProvider
  /**
   * The neural backend, registered BESIDE the OS floor.
   *
   * `false` skips it (tests that must not construct a real `PocketSynthProvider`
   * against the author's model cache — R061 / P40). Omit the field for the
   * production default: OS preferred, Pocket constructed and registered.
   */
  readonly pocket?: TtsProvider | false
}

/**
 * THE assembler. `packages/plugin/src/main.ts` must call this — a second copy of
 * the two `register()` calls is how R17-06 inverted preference while every plugin
 * test stayed green.
 */
export function createProviderRegistry(options: BuiltInProviderOptions = {}): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(options.os ?? new OsSynthProvider(), { preferred: true })
  if (options.pocket !== false) {
    registry.register(options.pocket ?? new PocketSynthProvider())
  }
  return registry
}
