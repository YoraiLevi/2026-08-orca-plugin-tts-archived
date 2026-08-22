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
  /** The reference clip's name in the model directory. */
  readonly file: string
  /** The upstream file it is fetched from, in `kyutai/tts-voices`. */
  readonly upstream: string
  /** Pinned, like every other artifact. R14-02: `ready` must mean the voices work. */
  readonly sha256: string
  readonly bytes: number
  /** The VCTK speaker, so the provenance is inspectable rather than folklore. */
  readonly source: string
}

/** The revision of `kyutai/tts-voices` these clips come from. Never a branch. */
export const VOICES_REPO = 'kyutai/tts-voices'
export const VOICES_REVISION = '323332d33f997de8394f24a193e1a76df720e01a'

/** Where a reference clip is fetched from. */
export function voiceUrl(upstream: string): string {
  return `https://huggingface.co/${VOICES_REPO}/resolve/${VOICES_REVISION}/vctk/${upstream}`
}

/**
 * The twelve English presets, in the order Kyutai publishes them.
 *
 * Same set and same names as buzz, so a listener who tuned a voice there recognises it here. Each
 * is an ai-coustics-enhanced VCTK speaker from `kyutai/tts-voices`; the mapping is recorded
 * because "Anna" is not a fact about the world and the speaker id is.
 */
export const POCKET_VOICES: readonly PocketVoice[] = [
  { key: 'pocket:anna', displayName: 'Anna', file: 'anna.wav',
    upstream: 'p228_023_enhanced.wav', sha256: '0a6de25cf12bf1540beb85979f306a92be81fecc051c547c5395e7e5237a3856', bytes: 804630, source: 'VCTK p228' },
  { key: 'pocket:vera', displayName: 'Vera', file: 'vera.wav',
    upstream: 'p229_023_enhanced.wav', sha256: '309cf91a895830f15842b398f69a4962cb1f7e0bfab10e25dd27838e826c204b', bytes: 691416, source: 'VCTK p229' },
  { key: 'pocket:fantine', displayName: 'Fantine', file: 'fantine.wav',
    upstream: 'p244_023_enhanced.wav', sha256: '5f07d4e2a3f20a15572aae885156b43ef3fc12ef3812996fd135680d9956448b', bytes: 674852, source: 'VCTK p244' },
  { key: 'pocket:charles', displayName: 'Charles', file: 'charles.wav',
    upstream: 'p254_023_enhanced.wav', sha256: '6b681a429198f16e378d53bccb08d06939da7b00144a7696111d4f8f76be7756', bytes: 639272, source: 'VCTK p254' },
  { key: 'pocket:paul', displayName: 'Paul', file: 'paul.wav',
    upstream: 'p259_023_enhanced.wav', sha256: '7aba504fe0b3b16478b69eb27ce6007e3cb42b0c1915b5f1c6a6024ae37d679b', bytes: 717182, source: 'VCTK p259' },
  { key: 'pocket:eponine', displayName: 'Eponine', file: 'eponine.wav',
    upstream: 'p262_023_enhanced.wav', sha256: 'a13c27fb47627b05223691a0ef2974358a18c886e6c2f9d2762ff1d02c20926b', bytes: 716330, source: 'VCTK p262' },
  { key: 'pocket:azelma', displayName: 'Azelma', file: 'azelma.wav',
    upstream: 'p303_023_enhanced.wav', sha256: '60e3d26cdf2efdec5df712152c839928f4d5522821e6554ae11fd96c57ab1026', bytes: 823852, source: 'VCTK p303' },
  { key: 'pocket:george', displayName: 'George', file: 'george.wav',
    upstream: 'p315_023_enhanced.wav', sha256: '29a41f93bf5236e5b21501091d7774c255d5f3d4e62fa4f9fdf0a92a793c84ae', bytes: 642692, source: 'VCTK p315' },
  { key: 'pocket:mary', displayName: 'Mary', file: 'reference_sample.wav',
    upstream: 'p333_023_enhanced.wav', sha256: 'a35b0468382218e9f37a9a7494d1e4b74deaf18d7ced22265b4e325bb55c183f', bytes: 639084, source: 'VCTK p333' },
  { key: 'pocket:jane', displayName: 'Jane', file: 'jane.wav',
    upstream: 'p339_023_enhanced.wav', sha256: '2f12e7f155eb3118f55425394f1b049e5b1b67bdc9b3932c8ba4521420aeb84a', bytes: 759340, source: 'VCTK p339' },
  { key: 'pocket:michael', displayName: 'Michael', file: 'michael.wav',
    upstream: 'p360_023_enhanced.wav', sha256: 'b6743e9195e5e3fd34fe9d1633ae93f7ffab787b249e45f6467d7d6f7a6ee6ad', bytes: 751140, source: 'VCTK p360' },
  { key: 'pocket:eve', displayName: 'Eve', file: 'eve.wav',
    upstream: 'p361_023_enhanced.wav', sha256: '396e7cbd066b0f3fb6d67fa26e7904076958239d736d4390f15b5fe88feb14cd', bytes: 671872, source: 'VCTK p361' },
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
