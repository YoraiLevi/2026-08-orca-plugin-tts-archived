import type { TtsProvider } from '@orca-tts/core'
import { OsSynthProvider } from './os-synth/index.ts'
import { PocketSynthProvider } from './pocket-synth/index.ts'
import { ProviderRegistry } from './registry.ts'

export * from './os-synth/index.ts'
export * from './pocket-synth/index.ts'
export * from './registry.ts'

export interface BuiltInProviderOptions {
  readonly os?: TtsProvider
  readonly pocket?: TtsProvider
}

/** Register both built-in backends while preserving the OS synthesizer as the default. */
export function createProviderRegistry(options: BuiltInProviderOptions = {}): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(options.os ?? new OsSynthProvider(), { preferred: true })
  registry.register(options.pocket ?? new PocketSynthProvider())
  return registry
}
