/**
 * 006 site 35 and 36, and 006 section 19's RANK ONE undetectable: "that the plugin is mute".
 *
 * `#play` resolved `true` on the `close` event regardless of exit code. Two faults in one line:
 * a player that exits non-zero was reported as success, so the ladder stopped at a rung that did
 * not work; and "the plugin is broken" became the same observable state as "the plugin is idle" on
 * all three platforms, because nothing anywhere asserted that audio reached a device.
 *
 * NOTHING HERE PLAYS AUDIO — P31. The player ladder is overridden with `sh -c 'exit N'`, which
 * exercises the exit-code path exactly and opens no audio device. A test that proved this with
 * `afplay` would interrupt whoever is at the machine, which is how benchmarks get deleted.
 */
import { describe, expect, it } from 'vitest'
import { SubprocessSink, type PlaybackFailure, type Player } from './subprocess-sink.js'
import type { AudioChunk } from '@orca-tts/core'

const chunk = (n = 8): AudioChunk => ({
  data: new Uint8Array(n), format: 'wav', sampleRate: 22050, channels: 1
})

const exits = (code: number): Player => ({ cmd: 'sh', args: () => ['-c', `exit ${code}`] })

describe('006 site 35 — a player that fails is not playback', () => {
  it('does not count a non-zero exit as audio played', async () => {
    const failures: PlaybackFailure[] = []
    const sink = new SubprocessSink({ players: [exits(3)], onFailure: (f) => failures.push(f) })
    await sink.enqueue(chunk(64))
    expect(sink.lastExitCode, 'the exit code must be observed at all').toBe(3)
    expect(sink.bytesPlayed, 'a failed player must never advance the played-bytes counter').toBe(0)
    expect(failures, 'a total playback failure reached nobody').toHaveLength(1)
    expect(failures[0]?.kind).toBe('player-failed')
    expect(String(failures[0]?.reason)).toContain('exited 3')
  })

  it('falls through to the next player instead of stopping at the broken one', async () => {
    // The second half of site 35: resolving `true` unconditionally meant `if (ok) return` fired on
    // the FIRST rung whatever it did, so the working player below it was never reached.
    const failures: PlaybackFailure[] = []
    const sink = new SubprocessSink({
      players: [exits(1), exits(0)], onFailure: (f) => failures.push(f)
    })
    await sink.enqueue(chunk(128))
    expect(sink.bytesPlayed, 'the working rung below the broken one was never tried').toBe(128)
    // The discriminating assertion: with `resolve(true)` the LAST player to run is the broken one,
    // so the exit code left behind is 1. Only a real fall-through leaves 0 here.
    expect(sink.lastExitCode, 'the ladder stopped at the rung that failed').toBe(0)
    expect(failures, 'a recovered failure must not be announced as a loss').toHaveLength(0)
  })

  it('CONTROL: a player that exits 0 counts, so the assertions above can fail for the right reason', async () => {
    const sink = new SubprocessSink({ players: [exits(0)] })
    await sink.enqueue(chunk(32))
    expect(sink.bytesPlayed).toBe(32)
    expect(sink.lastExitCode).toBe(0)
  })

  it('site 36: "no audio player on this platform" is a reported failure, not a log line', async () => {
    const failures: PlaybackFailure[] = []
    const sink = new SubprocessSink({ platform: 'plan9', onFailure: (f) => failures.push(f) })
    await sink.enqueue(chunk())
    expect(failures[0]?.kind, 'headless Linux and an unknown platform both land here').toBe('no-player')
    expect(String(failures[0]?.reason)).toContain('plan9')
  })

  it('barge-in is not a playback fault: a killed player must never be announced as one', async () => {
    // Without this, every Stop would announce an error — the control that exists to produce
    // silence would produce more speech, which is P22's helplessness, not a fix for it.
    const failures: PlaybackFailure[] = []
    const sink = new SubprocessSink({
      players: [{ cmd: 'sh', args: () => ['-c', 'sleep 5'] }], onFailure: (f) => failures.push(f)
    })
    const playing = sink.enqueue(chunk())
    await new Promise((r) => setTimeout(r, 60))
    await sink.stop()
    await playing
    expect(failures, 'stopping on purpose was reported to the listener as a failure').toHaveLength(0)
  })
})
