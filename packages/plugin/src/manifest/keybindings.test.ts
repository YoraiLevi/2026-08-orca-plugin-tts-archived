import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../orca-plugin.json', import.meta.url)), 'utf8')
) as { contributes: { keybindings: Array<{ command: string; key: string }> } }

/**
 * Chords ORCA's own defaults already claim, extracted from src/shared/keybindings.ts at commit
 * 0f26ff4a (app version 1.4.185). Vendored deliberately: a plugin cannot query the host's bindings,
 * and shipping a conflicting chord means the user sees
 * "conflicts with Show Ports" and the command never fires.
 *
 * Re-extract when bumping the supported ORCA version:
 *   grep -oE "'Mod\+Shift\+[A-Za-z0-9]+'" src/shared/keybindings.ts | sort -u
 */
const ORCA_DEFAULT_MOD_SHIFT = new Set([
  'mod+shift+0', 'mod+shift+a', 'mod+shift+arrowdown', 'mod+shift+arrowup', 'mod+shift+b',
  'mod+shift+bracketleft', 'mod+shift+bracketright', 'mod+shift+d', 'mod+shift+e', 'mod+shift+f',
  'mod+shift+g', 'mod+shift+i', 'mod+shift+j', 'mod+shift+m', 'mod+shift+n', 'mod+shift+o',
  'mod+shift+plus', 'mod+shift+r', 'mod+shift+t', 'mod+shift+v', 'mod+shift+z', 'mod+shift+enter'
])

describe('keybindings do not collide with ORCA defaults', () => {
  it('no declared chord is already claimed by the host', () => {
    for (const kb of manifest.contributes.keybindings) {
      const key = kb.key.toLowerCase()
      expect(ORCA_DEFAULT_MOD_SHIFT.has(key), `${kb.command} uses ${kb.key}, which ORCA already claims`)
        .toBe(false)
    }
  })

  it('declares no duplicate chords among our own commands', () => {
    const keys = manifest.contributes.keybindings.map((k) => k.key.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })
})
