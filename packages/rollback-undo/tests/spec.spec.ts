import { describe, expect, it } from 'vitest'
import { conversationUndoJournalSchema } from '../src/spec.ts'

describe('conversationUndoJournalSchema', () => {
  it('accepts a versioned logical-conversation generation', () => {
    expect(conversationUndoJournalSchema.parse({
      schemaVersion: 1,
      logicalConversationId: 'conversation-a',
      generation: 2,
      sourceSessionId: 'session-a',
      rollbackSessionId: 'session-b',
      messageId: 'message-a',
      prompt: 'restore this',
      workspace: '/workspace',
      beforeTree: 'a'.repeat(40),
      redoTree: 'b'.repeat(40),
      turn: 3,
      phase: 'complete',
    })).toMatchObject({ logicalConversationId: 'conversation-a', generation: 2 })
  })

  it('accepts a revoking transaction with its planned restored Session', () => {
    expect(conversationUndoJournalSchema.parse({
      schemaVersion: 1,
      logicalConversationId: 'conversation-a',
      generation: 2,
      sourceSessionId: 'session-a',
      rollbackSessionId: 'session-b',
      revokeSessionId: 'session-c',
      messageId: 'message-a',
      prompt: 'restore this',
      workspace: '/workspace',
      beforeTree: 'a'.repeat(40),
      redoTree: 'b'.repeat(40),
      turn: 3,
      phase: 'revoking',
    })).toMatchObject({ phase: 'revoking', revokeSessionId: 'session-c' })
  })

  it('rejects an obsolete manifest without its lineage fields', () => {
    expect(() => conversationUndoJournalSchema.parse({
      sourceSessionId: 'session-a',
      messageId: 'message-a',
      prompt: 'restore this',
      workspace: '/workspace',
      beforeTree: 'a'.repeat(40),
      turn: 3,
      phase: 'ready',
    })).toThrow()
  })
})
