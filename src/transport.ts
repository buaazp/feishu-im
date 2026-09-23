/** Managed lark-cli event ingress and bot replies using an existing CLI profile. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.ts'
import { readLines, replyChunks, type LarkMessageId } from './protocol.ts'

/** CLI transport whose callers own the shared cancellation signal. */
export class LarkCli {
  constructor(private readonly ctx: Context, private readonly config: Config) {}

  private spawn(args: string[], signal?: AbortSignal, streaming = false): SubprocessHandle {
    return this.ctx.subprocess.spawn({
      argv: [...this.config.command, '--profile', this.config.profile, ...args, '--as', 'bot'],
      cwd: this.config.cwd,
      env: { LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
      graceMs: this.config.graceMs,
      signal,
      stdio: {
        stdin: streaming ? 'pipe' : 'ignore',
        stdout: streaming ? 'pipe' : { maxBytes: this.config.maxRecordBytes },
        stderr: streaming ? 'pipe' : { maxBytes: this.config.maxRecordBytes },
      },
    })
  }

  /**
   * Consume events until cancellation; unexpected exit or malformed framing rejects.
   * @param receive - synchronous receiver that owns any scheduled message work.
   * @param ready - called once after the CLI's subscription-ready marker.
   * @param signal - plugin lifetime; closes stdin before escalating termination.
   * @returns settlement after the consumer process and output readers stop.
   */
  async consume(receive: (line: string) => void, ready: () => void, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const child = this.spawn(['event', 'consume', 'im.message.receive_v1'], undefined, true)
    const started = Promise.withResolvers<void>()
    let diagnostic = ''
    let escalation: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      child.stdin?.end()
      escalation ??= setTimeout(() => { child.terminate() }, this.config.graceMs)
      started.reject(new Error('feishu-im: event consumer stopped before readiness'))
    }
    const startup = setTimeout(() => {
      started.reject(new Error('feishu-im: event consumer readiness timed out'))
    }, this.config.startupTimeoutMs)
    signal.addEventListener('abort', stop, { once: true })
    const exited = child.done.then((outcome) => {
      if (!signal.aborted) throw new Error(`feishu-im: event consumer exited (${String(outcome.exitCode)}): ${diagnostic}`)
    }).catch((error: unknown) => {
      started.reject(error)
      throw error
    })
    const stderr = (async () => {
      for await (const line of readLines(child.stderr as NonNullable<SubprocessHandle['stderr']>, this.config.maxRecordBytes)) {
        diagnostic = Buffer.from(`${diagnostic}${line}\n`).subarray(-this.config.maxRecordBytes).toString('utf8')
        if (line === '[event] ready event_key=im.message.receive_v1') started.resolve()
      }
    })().catch((error: unknown) => { started.reject(error); throw error })
    const stdout = (async () => {
      await started.promise
      clearTimeout(startup)
      signal.throwIfAborted()
      ready()
      for await (const line of readLines(child.stdout as NonNullable<SubprocessHandle['stdout']>, this.config.maxRecordBytes)) {
        if (!signal.aborted && line.trim() !== '') receive(line)
      }
    })()
    try {
      await Promise.all([exited, stderr, stdout])
    } finally {
      clearTimeout(startup)
      signal.removeEventListener('abort', stop)
      stop()
      await Promise.allSettled([child.done, stderr, stdout])
      clearTimeout(escalation)
      await child.waitForExit()
    }
  }

  /**
   * Reply as the configured bot, with deterministic per-chunk idempotency keys.
   * @param messageId - human message receiving the reply.
   * @param phase - distinct response purpose for this incoming message.
   * @param text - literal user-visible text, excluding model reasoning.
   * @param signal - owner cancellation.
   */
  async reply(messageId: LarkMessageId, phase: string, text: string, signal: AbortSignal): Promise<void> {
    for (const [index, chunk] of replyChunks(text, this.config.maxReplyBytes).entries()) {
      signal.throwIfAborted()
      const uuid = createHash('sha256').update(JSON.stringify([messageId, phase, index])).digest('hex').slice(0, 32)
      const deadline = new AbortController()
      const timer = setTimeout(() => { deadline.abort() }, this.config.requestTimeoutMs)
      let child: SubprocessHandle | undefined
      try {
        child = this.spawn(['im', '+messages-reply', '--message-id', messageId, '--text', chunk, '--idempotency-key', uuid],
          AbortSignal.any([signal, deadline.signal]))
        const outcome = await child.done
        if (deadline.signal.aborted) throw new Error('feishu-im: reply timed out')
        signal.throwIfAborted()
        const stdout = (child.collected.stdout as NonNullable<SubprocessHandle['collected']['stdout']>).readFrom(0)
        const stderr = (child.collected.stderr as NonNullable<SubprocessHandle['collected']['stderr']>).readFrom(0)
        if (outcome.exitCode !== 0) throw new Error(`feishu-im: reply failed (${String(outcome.exitCode)}): ${stderr.text}`)
        if (stdout.lossy) throw new Error('feishu-im: incomplete reply response')
        const response: unknown = JSON.parse(stdout.text)
        if (response === null || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
          throw new Error('feishu-im: CLI did not acknowledge the reply')
        }
      } finally {
        clearTimeout(timer)
        if (child !== undefined) {
          child.terminate()
          await child.waitForExit()
        }
      }
    }
  }
}
