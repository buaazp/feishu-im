/** Private routing and admission state, persisted separately from model history. */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const conversationStore = defineDomain({
  name: 'feishu_im', version: 1,
  tables: {
    chats: domainTable(z.object({
      cwd: z.string(), sessionId: z.string().nullable(),
      admitted: z.array(z.string()),
      pendingArchive: z.string().optional(),
    })),
  },
})
