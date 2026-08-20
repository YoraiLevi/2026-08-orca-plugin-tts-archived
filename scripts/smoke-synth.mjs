#!/usr/bin/env node
/**
 * Verify by effect: the OS synthesizer on THIS machine produces non-empty audio.
 * Presence of a binary is not evidence it works (constitution R003).
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TEXT = 'Testing one two three.'
const dir = await mkdtemp(join(tmpdir(), 'orca-tts-smoke-'))
const out = join(dir, 'out.wav')

const spec = {
  darwin: ['say', ['-o', out, '--data-format=LEI16@22050', TEXT]],
  linux: ['espeak-ng', ['-w', out, TEXT]],
  win32: ['powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}'); $s.Speak('${TEXT}'); $s.Dispose()`]]
}[process.platform]

if (spec === undefined) {
  console.error(`no OS synthesizer known for ${process.platform}`)
  process.exit(1)
}

const t0 = Date.now()
const code = await new Promise((resolve) => {
  const c = spawn(spec[0], spec[1], { stdio: 'ignore' })
  c.on('error', () => resolve(-1))
  c.on('close', resolve)
})
const elapsed = Date.now() - t0

const bytes = await readFile(out).then((b) => b.length).catch(() => 0)
await rm(dir, { recursive: true, force: true }).catch(() => {})

console.log(`[measured] ${process.platform}: exit=${code} bytes=${bytes} elapsed=${elapsed}ms`)
if (bytes < 1000) {
  console.error(`FAIL: expected real audio, got ${bytes} bytes`)
  process.exit(1)
}
console.log('PASS: OS synthesizer produced audio')
