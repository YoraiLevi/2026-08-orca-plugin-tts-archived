/**
 * Scoring policy for the shipped-artifact probes (R18-01 / R18-02).
 *
 * Extracted so `scripts/build.mjs` and `scripts/artifact-e2e.mjs` cannot drift, and so a
 * test can hand the R18 mutants to the SAME functions the probes run — a helper that
 * exists only in a test file is how R17-02's "/pocket:/ in a log" guard stayed green
 * while the class vanished.
 *
 * P36: `mimi_encoder.onnx` is restated here, not imported from models.ts. A test that
 * imported the required-files table would shrink when the table shrank.
 */

export const POCKET_RATE = 24_000
export const OS_RATE = 22_050

/**
 * A Pocket-only weight the real `PocketSynthProvider.prepare()` enumerates when the
 * cache is empty. Round 18's stub (`id: 'pocket'`, throw `'pocket: mutant stub'`)
 * never called `modelStatus()` and cannot name this file.
 */
export const POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES = 'mimi_encoder.onnx'

/**
 * Consult arm (OS floor forced down, empty model dir): did the bundled
 * `PocketSynthProvider` actually run `prepare()` against THIS directory?
 *
 * `/pocket:/` in a log is not this. A stub with `id: 'pocket'` whose `prepare()`
 * throws `'pocket: mutant stub'` satisfies the substring and is R18-01's mutant.
 * The real class throws `PocketModelUnavailableError`, which names the empty dir
 * the harness created and enumerates `mimi_encoder.onnx`. A stub cannot produce
 * either without implementing `modelStatus()`.
 *
 * 24 kHz is the stronger discriminator, but it needs weights CI does not have.
 * Against an empty dir, 24 kHz would mean the provider ignored `ORCA_TTS_MODEL_DIR`
 * (R17-07) and is a failure, not a pass. The PRESENT arm of `probe:artifact` is
 * the 24 kHz gate; this is the no-weights gate.
 *
 * @param {object} consult  JSON an artifact-e2e `--child` wrote
 * @param {string} emptyModelDir  the isolated empty dir that child was pointed at
 */
export function consultProvesRealPocket (consult, emptyModelDir) {
  if (consult == null || typeof emptyModelDir !== 'string' || emptyModelDir.length === 0) {
    return false
  }
  const hay = [consult.error, consult.engineReady, ...(consult.logs ?? [])]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join('\n')
  const observedThisDir = hay.includes(`Pocket TTS model is not ready in ${emptyModelDir}`)
  const enumeratedAWeight = hay.includes(POCKET_WEIGHT_THE_REAL_CLASS_ENUMERATES)
  return observedThisDir && enumeratedAWeight
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
  if (absent.substitution == null) {
    rows.push(
      'ABSENT did not NAME the substitution. Expected a log/announcement matching ' +
      '"was unavailable" + "using <floor>". engine=' +
      JSON.stringify(absent.displayName) + ' rung=' + absent.rung,
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
