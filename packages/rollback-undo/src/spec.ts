/** Durable JSON validation for the conversation-undo data directory. */

import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationUndoJournal, ConversationUndoTree, LogicalConversationId } from './types.ts'

const id = z.string().min(1)
const sessionId = id.transform(value => value as SessionId)
const messageId = id.transform(value => value as MessageId)
const tree = z.string().regex(/^[0-9a-f]{40,64}$/).transform(value => value as ConversationUndoTree)
const logicalConversationId = id.transform(value => value as LogicalConversationId)

/** Runtime schema for one app-owned snapshot journal manifest. */
export const conversationUndoJournalSchema = z.object({
  schemaVersion: z.literal(1),
  logicalConversationId,
  generation: z.number().int().nonnegative(),
  sourceSessionId: sessionId,
  rollbackSessionId: sessionId.optional(),
  revokeSessionId: sessionId.optional(),
  messageId,
  prompt: z.string(),
  workspace: z.string().min(1),
  beforeTree: tree,
  redoTree: tree.optional(),
  turn: z.number().int().nonnegative(),
  phase: z.enum(['armed', 'ready', 'quiescing', 'restoring', 'complete', 'revoking', 'cleanup-pending', 'recovery-required']),
}) as unknown as z.ZodType<ConversationUndoJournal>
