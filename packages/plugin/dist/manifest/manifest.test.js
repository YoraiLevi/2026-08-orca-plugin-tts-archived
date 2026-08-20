import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../orca-plugin.json', import.meta.url)), 'utf8'));
/**
 * Shape checks mirroring ORCA's `pluginManifestSchema`. The real manifest was silently rejected
 * once — capabilities were strings, `engines` and `pluginApi` were missing — and the only symptom
 * was the plugin never appearing. Nothing here can catch a schema change upstream, but it does
 * catch us regressing the shape we verified against their parser.
 */
describe('orca-plugin.json matches the host manifest schema', () => {
    it('declares the required top-level fields', () => {
        expect(manifest['manifestVersion']).toBe(1);
        expect(manifest['pluginApi']).toBe(1);
        expect(manifest['engines']).toEqual({ orca: expect.stringMatching(/^>=/) });
        expect(manifest['id']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(manifest['publisher']).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(manifest['version']).toMatch(/^\d+\.\d+\.\d+/);
    });
    it('declares capabilities as objects, never bare strings', () => {
        const caps = manifest['capabilities'];
        expect(Array.isArray(caps)).toBe(true);
        for (const c of caps) {
            expect(typeof c, 'a bare string capability is silently rejected by the host').toBe('object');
            expect(c['kind']).toBeTypeOf('string');
        }
    });
    it('only asks for capabilities in the host closed set', () => {
        const allowed = new Set(['workspace:read', 'terminal:send', 'notifications:show',
            'storage', 'secrets', 'events:subscribe', 'settings:own']);
        for (const c of manifest['capabilities']) {
            expect(allowed.has(c.kind), `unknown capability ${c.kind}`).toBe(true);
        }
    });
    it('subscribes to the event huddle mode depends on', () => {
        const events = manifest['contributes']['events'];
        expect(events.map((e) => e.on)).toContain('agent.status.changed');
    });
    it('uses portable command ids, and every keybinding targets a declared command', () => {
        const c = manifest['contributes'];
        const commands = c['commands'].map((x) => x.id);
        for (const id of commands)
            expect(id).toMatch(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/);
        for (const k of c['keybindings']) {
            expect(commands, `keybinding targets undeclared command ${k.command}`).toContain(k.command);
        }
    });
    it('every declared artifact path is relative and inside the plugin directory', () => {
        const paths = [manifest['main'],
            ...manifest['contributes']['panels']
                .map((p) => p.entry)];
        for (const p of paths) {
            expect(p).not.toMatch(/^[/\\]/);
            expect(p).not.toContain('..');
        }
    });
});
