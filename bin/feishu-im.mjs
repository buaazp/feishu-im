#!/usr/bin/env node
/** Management entrypoint only; run Agents through dsh profiles. */
import { readFile } from 'node:fs/promises'
import { CommanderError } from 'commander'
import { createManagementProgram } from '../dist/management.js'
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const program = createManagementProgram({
  version, directory: process.cwd(),
  readSecret: async () => {
    if (process.stdin.isTTY) throw new Error('Pipe App Secret to standard input, or use the dsh configuration page.')
    const chunks = []; let bytes = 0
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 16384) throw new Error('Secret input too large'); chunks.push(chunk) }
    return Buffer.concat(chunks).toString('utf8')
  },
  write: text => { process.stdout.write(text) },
  writeError: text => { process.stderr.write(text) },
  exitCode: code => { process.exitCode = code },
})
try { await program.parseAsync(process.argv) }
catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode
  else { process.stderr.write(`feishu-im: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
}
