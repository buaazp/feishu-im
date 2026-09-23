#!/usr/bin/env node
/** Management entrypoint only; run Agents through dsh profiles. */
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { CommanderError } from 'commander'
import { createManagementProgram } from '../dist/management.js'
import { queryLark } from '../dist/lark-auth.js'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
let input
const program = createManagementProgram({
  version,
  directory: process.cwd(),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  query: (command, args) => queryLark(command, args),
  ask: async (question, suggestion) => {
    input ??= createInterface({ input: process.stdin, output: process.stdout })
    const answer = await input.question(`${question}${suggestion ? ` [${suggestion}]` : ''}: `)
    return answer.trim() || suggestion || ''
  },
  write: text => { process.stdout.write(text) },
  writeError: text => { process.stderr.write(text) },
  exitCode: code => { process.exitCode = code },
})
try {
  await program.parseAsync(process.argv)
} catch (error) {
  if (error instanceof CommanderError) process.exitCode = error.exitCode
  else {
    process.stderr.write(`feishu-im: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
} finally {
  input?.close()
}
