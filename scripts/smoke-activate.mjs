#!/usr/bin/env node
/**
 * Drives the BUILT artifact exactly as the ORCA worker does, and asserts it wires itself up.
 *
 * Why this exists: every host API method name was originally guessed, and the defensive adapter
 * turned each wrong name into a silent no-op. Nothing failed; no command was registered; the only
 * symptom was ORCA saying "Could not run the plugin command" (PITFALLS P18). Unit tests passed
 * against the same wrong shape, because they mocked the shape they were written for.
 *
 * This runs the real bundle against the real activate() contract.
 */
const mod = await import('../dist/plugin/main.mjs')
const activate = mod.default

if (typeof activate !== 'function') {
  console.error('FAIL: dist/plugin/main.mjs must default-export activate')
  process.exit(1)
}

const registered = []
const events = []
activate({
  commands: { register: (id) => registered.push(id) },
  events: { on: (name) => events.push(name) },
  host: { call: async () => ({}) },
  log: (m) => console.log('  [plugin]', m)
}, { controlDir: false })

await new Promise((r) => setTimeout(r, 2000))

const EXPECTED_COMMANDS = [
  'read-aloud.speak-clipboard',
  'read-aloud.stop',
  'read-aloud.toggle-huddle',
  'read-aloud.speak-last-reply',
  'read-aloud.status',
  'read-aloud.skip',
  'read-aloud.unfollow'
]

let ok = true
for (const id of EXPECTED_COMMANDS) {
  if (!registered.includes(id)) { console.error(`FAIL: command not registered: ${id}`); ok = false }
}
if (!events.includes('agent.status.changed')) {
  console.error('FAIL: did not subscribe to agent.status.changed — huddle mode would be silent')
  ok = false
}

// The manifest and the code must agree, or the shortcut fires a command nobody registered.
const { readFileSync } = await import('node:fs')
const manifest = JSON.parse(readFileSync(new URL('../dist/plugin/orca-plugin.json', import.meta.url), 'utf8'))
for (const c of manifest.contributes.commands) {
  if (!registered.includes(c.id)) {
    console.error(`FAIL: manifest declares ${c.id} but activate() never registers it`)
    ok = false
  }
}

console.log(ok
  ? `PASS: ${registered.length} commands, events: ${events.join(', ')}`
  : 'FAIL')
process.exit(ok ? 0 : 1)
