/**
 * Voices, and what a voice IS in each backend.
 *
 * This is the piece that changes the shape of the setting, so it is worth stating plainly. For the
 * OS synthesizer a voice is **a name the operating system already knows** — `Alex`, `Microsoft
 * Zira`, `en-gb+f3`. For Pocket TTS a voice is **a reference recording**: the model clones
 * zero-shot from a ~10 s clip, so a "voice" is a 600 KB WAV and nothing else. Adding a voice means
 * adding an audio file, which is why cloning is free and why the preset list is data.
 *
 * Keys are `backend:voice`, exactly as buzz does it
 * (`desktop/src-tauri/src/huddle/tts_voice_registry.rs`). That is what lets a listener keep an
 * ordered preference list across machines that do not have the same engines: resolution walks the
 * list and takes the first entry whose backend is actually running, rather than falling back to
 * "whatever is default" and quietly changing who is speaking.
 */

export const OS_BACKEND = 'os'
export const POCKET_BACKEND = 'pocket'

export interface VoiceKey {
  readonly backend: string
  readonly voice: string
}

export interface PocketVoice {
  /** `pocket:eve` */
  readonly key: string
  /** What a person calls it. */
  readonly displayName: string
  /** The reference clip in the model directory. */
  readonly file: string
  /** The VCTK speaker this clip is, so the provenance is inspectable rather than folklore. */
  readonly source: string
}

/**
 * The twelve English presets, in the order Kyutai publishes them.
 *
 * Same set and same names as buzz, so a listener who tuned a voice there recognises it here. Each
 * is an ai-coustics-enhanced VCTK speaker from `kyutai/tts-voices`; the mapping is recorded
 * because "Anna" is not a fact about the world and the speaker id is.
 */
export const POCKET_VOICES: readonly PocketVoice[] = [
  { key: 'pocket:anna', displayName: 'Anna', file: 'anna.wav', source: 'VCTK p228' },
  { key: 'pocket:vera', displayName: 'Vera', file: 'vera.wav', source: 'VCTK p229' },
  { key: 'pocket:fantine', displayName: 'Fantine', file: 'fantine.wav', source: 'VCTK p244' },
  { key: 'pocket:charles', displayName: 'Charles', file: 'charles.wav', source: 'VCTK' },
  { key: 'pocket:paul', displayName: 'Paul', file: 'paul.wav', source: 'VCTK' },
  { key: 'pocket:eponine', displayName: 'Eponine', file: 'eponine.wav', source: 'VCTK' },
  { key: 'pocket:azelma', displayName: 'Azelma', file: 'azelma.wav', source: 'VCTK' },
  { key: 'pocket:george', displayName: 'George', file: 'george.wav', source: 'VCTK' },
  { key: 'pocket:mary', displayName: 'Mary', file: 'reference_sample.wav', source: 'VCTK p333' },
  { key: 'pocket:jane', displayName: 'Jane', file: 'jane.wav', source: 'VCTK' },
  { key: 'pocket:michael', displayName: 'Michael', file: 'michael.wav', source: 'VCTK' },
  { key: 'pocket:eve', displayName: 'Eve', file: 'eve.wav', source: 'VCTK' },
]

/** The one used when nothing has been chosen. Mary is the bundle's own reference sample. */
export const POCKET_DEFAULT_VOICE = 'pocket:mary'

/**
 * Split `backend:voice`.
 *
 * A key with no colon is an OS voice, because that is what every setting written before this
 * existed looks like — `"Alex"` must keep meaning `os:Alex` rather than becoming unresolvable.
 * Migration by construction, so no settings file has to be rewritten.
 */
export function parseVoiceKey(key: string): VoiceKey {
  const at = key.indexOf(':')
  if (at < 0) return { backend: OS_BACKEND, voice: key }
  return { backend: key.slice(0, at), voice: key.slice(at + 1) }
}

export function formatVoiceKey(backend: string, voice: string): string {
  return `${backend}:${voice}`
}

/**
 * The first preference this backend can actually honour.
 *
 * Returns `null` rather than a default when nothing matches, so the caller decides what silence
 * means. Guessing here is how a listener ends up hearing a voice they never chose and cannot
 * trace: the setting says one thing, the machine has another engine, and something in the middle
 * substitutes without saying so.
 */
export function resolveVoiceForBackend(
  preferences: readonly string[],
  backend: string,
  available: readonly string[],
): string | null {
  const have = new Set(available)
  for (const pref of preferences) {
    const parsed = parseVoiceKey(pref)
    if (parsed.backend !== backend) continue
    if (have.has(parsed.voice) || have.has(pref)) return parsed.voice
  }
  return null
}

/** Every reference clip the model directory must hold for the preset list to be complete. */
export function pocketVoiceFiles(): string[] {
  return [...new Set(POCKET_VOICES.map((v) => v.file))]
}
