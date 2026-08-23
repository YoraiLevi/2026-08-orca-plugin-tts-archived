/**
 * Scoring policy for the shipped-artifact probes (R18-01 / R18-02 / R19-01 / R19-04).
 *
 * Extracted so `scripts/build.mjs` and `scripts/artifact-e2e.mjs` cannot drift, and so a
 * test can hand the mutants to the SAME functions the probes run — a helper that
 * exists only in a test file is how R17-02's "/pocket:/ in a log" guard stayed green
 * while the class vanished.
 *
 * P36: the 23 required Pocket filenames are restated here, not imported from models.ts.
 * A test that imported the required-files table would shrink when the table shrank.
 */

export const POCKET_RATE = 24_000
export const OS_RATE = 22_050

/**
 * A Pocket-only weight the real `PocketSynthProvider.prepare()` enumerates when the
 * cache is empty. Kept as a named pin so tests can name it without importing the table.
 */
export const POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES = 'mimi_encoder.onnx'

/**
 * Every file `modelStatus` enumerates for an empty dir (8 weights + 12 voices +
 * 2 licences + the marker). Restated, not imported (P36).
 */
export const REQUIRED_POCKET_FILES = Object.freeze([
  'bundle.json',
  'bos_before_voice.npy',
  'tokenizer.model',
  'flow_lm_main_int8.onnx',
  'flow_lm_flow_int8.onnx',
  'mimi_decoder_int8.onnx',
  'mimi_encoder.onnx',
  'text_conditioner.onnx',
  'anna.wav',
  'vera.wav',
  'fantine.wav',
  'charles.wav',
  'paul.wav',
  'eponine.wav',
  'azelma.wav',
  'george.wav',
  'reference_sample.wav',
  'jane.wav',
  'michael.wav',
  'eve.wav',
  'LICENSE',
  'MODEL_LICENSE.txt',
  '.orca-tts-model-manifest',
])

/**
 * Consult arm: did the bundled `PocketSynthProvider` actually run `prepare()` against
 * THIS directory?
 *
 * A sentence is a string and a stub can copy any sentence we name. Round 17 grepped a
 * class NAME. Round 18 grepped `/pocket:/`. Round 18's repair grepped two longer
 * substrings (`Pocket TTS model is not ready in ${dir}` and `mimi_encoder.onnx`).
 * Round 19's stub interpolated that exact sentence and `pnpm build` stayed EXIT 0
 * while `PocketSynthProvider` and `PocketTts` were both absent from the artifact.
 *
 * The discriminator a stub cannot forge: `err instanceof BundlePocketModelUnavailableError`
 * where the class was imported FROM THE BUNDLE ITSELF. Then the STRUCTURED status —
 * `err.status.dir` is the dir we passed, `err.status.missing` enumerates the 23
 * required files — not a rendered sentence.
 *
 * @param {unknown} err  the live throw from `new BundlePocketSynthProvider({ dir }).prepare()`
 * @param {string} emptyModelDir
 * @param {Function} BundlePocketModelUnavailableError  the class imported from dist/plugin/main.mjs
 */
export function consultProvesRealPocket (err, emptyModelDir, BundlePocketModelUnavailableError) {
  if (typeof BundlePocketModelUnavailableError !== 'function') return false
  if (typeof emptyModelDir !== 'string' || emptyModelDir.length === 0) return false
  if (err == null || (typeof err !== 'object' && typeof err !== 'function')) return false
  if (!(err instanceof BundlePocketModelUnavailableError)) return false
  const status = /** @type {{ dir?: unknown, missing?: unknown }} */ (err).status
  if (status == null || typeof status !== 'object') return false
  if (status.dir !== emptyModelDir) return false
  if (!Array.isArray(status.missing)) return false
  if (status.missing.length !== REQUIRED_POCKET_FILES.length) return false
  const got = new Set(status.missing.map(String))
  if (got.size !== REQUIRED_POCKET_FILES.length) return false
  for (const f of REQUIRED_POCKET_FILES) {
    if (!got.has(f)) return false
  }
  return true
}

/**
 * ABSENT must NAME the floor. Empty string, whitespace, and a constant `'ok'` are
 * not a name — they are R18-02's next costumes (R19-04). CI maps exit 2 to green,
 * so a field that is present-but-blank must not be able to skip.
 *
 * @param {unknown} value
 */
export function isNamedSubstitution (value) {
  if (typeof value !== 'string') return false
  const s = value.trim()
  if (s.length === 0) return false
  return /was unavailable/.test(s) && /using /.test(s)
}

/**
 * ABSENT arm is conclusive with no model. Failures here are always exit 1.
 * @param {object | null | undefined} absent
 * @returns {string[]}
 */
export function scoreAbsent (absent) {
  const rows = []
  if (absent == null) {
    rows.push('ABSENT produced no result')
    return rows
  }
  if (absent.error) rows.push(`ABSENT error: ${absent.error}`)
  if (absent.chunkSampleRate !== OS_RATE) {
    rows.push(
      `ABSENT chunk.sampleRate is ${absent.chunkSampleRate}, want ${OS_RATE} (OS floor)`,
    )
  }
  if (!isNamedSubstitution(absent.substitution)) {
    rows.push(
      'ABSENT did not NAME the substitution. Expected a log/announcement matching ' +
      '"was unavailable" + "using <floor>". engine=' +
      JSON.stringify(absent.displayName) + ' rung=' + absent.rung +
      ' substitution=' + JSON.stringify(absent.substitution),
    )
  }
  return rows
}

/**
 * PRESENT arm: 24 kHz neural audio with signal, and the two arms must differ.
 * Only callable when a ready model existed so PRESENT actually ran.
 * @param {object} present
 * @param {object} absent
 * @returns {string[]}
 */
export function scorePresent (present, absent) {
  const rows = []
  if (present.error) rows.push(`PRESENT error: ${present.error}`)
  if (present.chunkSampleRate !== POCKET_RATE) {
    rows.push(
      `PRESENT chunk.sampleRate is ${present.chunkSampleRate}, want ${POCKET_RATE} (Pocket), ` +
      `not ${OS_RATE} (macOS OS). engine=${JSON.stringify(present.displayName)} rung=${present.rung}`,
    )
  }
  if (present.signal !== true) {
    rows.push(
      `PRESENT audio is not signal: rms=${present.rms?.toFixed?.(4) ?? present.rms} ` +
      `peak=${present.peak?.toFixed?.(4) ?? present.peak}`,
    )
  }
  if (
    present.chunkSampleRate === absent?.chunkSampleRate &&
    present.displayName === absent?.displayName &&
    present.rung === absent?.rung
  ) {
    rows.push(
      `BOTH ARMS PRODUCED THE SAME ANSWER (sampleRate=${present.chunkSampleRate} ` +
      `engine=${JSON.stringify(present.displayName)} rung=${present.rung}). ` +
      'The probe cannot tell Pocket from the OS floor — the plugin never consulted the model dir.',
    )
  }
  return rows
}

/**
 * Pick the process exit code.
 *
 *   0  both arms passed (PRESENT ran and spoke at 24 kHz; ABSENT named the floor)
 *   1  a real defect — ABSENT failed, cache is broken (incomplete/stale), or PRESENT failed
 *   2  ONLY "the PRESENT arm could not run" (no ready model). ABSENT already passed.
 *   3  is a harness problem and is not decided here.
 *
 * R18-02: exit 2 used to fire BEFORE scoreAbsent whenever the product cache was not
 * ready. Swallowing `nameSubstitution` left ABSENT `substitution: (none named)` and
 * still EXIT 2; CI mapped 2 to green. The ABSENT arm needs no model and must be
 * conclusive always. Incomplete is a broken cache, not a skip.
 *
 * R19-04: `substitution == null` treated `''` as named. Empty, whitespace, and
 * `'ok'` now fail the same way `null` does.
 *
 * @param {{
 *   productKind: string,
 *   productDetail?: string,
 *   present: object | null,
 *   absent: object | null,
 * }} args
 */
export function judge ({ productKind, productDetail, present, absent }) {
  const rows = scoreAbsent(absent)
  if (productKind !== 'ready' && productKind !== 'absent') {
    rows.push(
      `product cache is ${productKind}, not ready: ${productDetail ?? ''}`.trim() +
      '. A cache that cannot speak is a defect (exit 1), not an inconclusive skip.',
    )
  }
  if (present != null) {
    rows.push(...scorePresent(present, absent))
  }
  if (rows.length > 0) {
    return { exit: 1, rows, summary: `FAIL: ${rows[0]}` }
  }
  if (present == null) {
    return {
      exit: 2,
      rows: [],
      summary:
        'INCONCLUSIVE: PRESENT arm could not run (no ready Pocket model). ABSENT passed. ' +
        'This is not a pass.',
    }
  }
  return {
    exit: 0,
    rows: [],
    summary:
      `PASS: PRESENT spoke at ${POCKET_RATE} Hz with signal; ` +
      `ABSENT named the OS substitution at ${OS_RATE} Hz.`,
  }
}
