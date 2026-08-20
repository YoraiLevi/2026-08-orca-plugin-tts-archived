#!/usr/bin/env node
/**
 * End-to-end audible check: a realistic agent reply goes through the REAL pipeline
 * (normalize -> chunk -> provider -> sink) and comes out of the speakers.
 *
 * Everything except the ORCA event seam. If this sounds right, the only untested
 * thing left is the plugin host wiring.
 */
import { normalize, Chunker } from '../packages/core/src/index.ts'
import { OsSynthProvider } from '../packages/providers/src/index.ts'
import { SubprocessSink } from '../packages/plugin/src/sinks/subprocess-sink.ts'

const REPLY = `## Summary

I fixed the **race condition** in \`session_handler.py\`. The problem was in \`_flush_buffer()\`:

\`\`\`python
def _flush_buffer(self):
    for item in self.buffer:
        self.sink.write(item)
\`\`\`

Two things to note:

- The lock was released too early, at line 42.
- Retries happened 3 times before failing, which hid the bug.

See https://example.com/docs for details. I'll check back at 14:30 🎉`

const t0 = Date.now()
const spoken = normalize(REPLY)
console.log('\n--- what the engine will actually say ---')
console.log(spoken)
console.log('----------------------------------------\n')

const chunker = new Chunker({ maxUnits: 180 })
const chunks = [...chunker.addText(spoken), ...chunker.finish()]
console.log(`chunks: ${chunks.length}`)
chunks.forEach((c, i) => console.log(`  ${i + 1}. [${c.boundary}${c.isFirst ? ', first' : ''}] ${JSON.stringify(c.text)}`))

const provider = new OsSynthProvider()
await provider.prepare()
const sink = new SubprocessSink()

let first = null
for (const c of chunks) {
  for await (const audio of provider.generate(c.text)) {
    if (first === null) { first = Date.now() - t0; console.log(`\n[measured] time to first audio: ${first} ms`) }
    await sink.enqueue(audio)
  }
}
console.log(`[measured] total wall clock: ${Date.now() - t0} ms`)
console.log('\nIf you heard that, the pipeline works end to end.')
