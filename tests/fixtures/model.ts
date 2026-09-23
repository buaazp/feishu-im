/** Deterministic external-model replacement for private-chat composition tests. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

export class TestModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly entered = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const users = options.messages.filter(message => message.role === 'user' && message.source?.kind === 'user')
    const text = users.at(-1)?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
    if (text === 'hold') {
      this.entered.resolve(undefined)
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
      })
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Stopped' } } }
      return
    }
    // Older Harness represents tool results as user messages with a tool source.
    if (['write validation file', 'confirm test choice'].includes(text) && options.messages.at(-1)?.source?.kind !== 'tool') {
      const asking = text === 'confirm test choice'
      const name = asking ? 'ask_user_question' : 'write'
      const args = JSON.stringify(asking
        ? { questions: [{ id: 'choice', question: 'Choose the test option', options: [{ label: 'Proceed' }, { label: 'Cancel' }] }] }
        : { file_path: 'lark-validation.txt', content: 'LARK_TOOL_OK\n' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('lark-tool'), name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('lark-tool'), name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const answer = `第 ${users.length} 条消息：${text}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'lark-test-model'
export const inject = ['llm']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.llm.registerAdapter(['lark-test'], new TestModel()))
}
