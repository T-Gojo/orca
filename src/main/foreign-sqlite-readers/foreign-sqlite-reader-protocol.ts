// Keep this Electron-free so both worker and main-process clients can import it.

import type { OpenCodeSessionCursor } from './opencode-binder-sessions-result'
import type { OpenCodePromptFailureQuery } from './opencode-prompt-failure-result'

type CursorProfileRequest = {
  id: number
  kind: 'cursorProfile'
  dbPath: string
}

type KiroCliTokenRequest = {
  id: number
  kind: 'kiroCliToken'
  dbPath: string
}

type KiroCliLoginRequest = {
  id: number
  kind: 'kiroCliLogin'
  dbPath: string
}

type KiroCliLoginWriteRequest = {
  id: number
  kind: 'kiroCliLoginWrite'
  dbPath: string
  contents: string | null
  expected: string | null
}

type OpenCodeBinderSessionsRequest = {
  id: number
  kind: 'openCodeBinderSessions'
  dbPath: string
  cursor: OpenCodeSessionCursor
}

type OpenCodePromptFailureRequest = OpenCodePromptFailureQuery & {
  id: number
  kind: 'openCodePromptFailure'
}

export type ForeignSqliteReaderRequest =
  | CursorProfileRequest
  | KiroCliTokenRequest
  | KiroCliLoginRequest
  | KiroCliLoginWriteRequest
  | OpenCodeBinderSessionsRequest
  | OpenCodePromptFailureRequest

export type ForeignSqliteReaderKind = ForeignSqliteReaderRequest['kind']

export type ForeignSqliteReaderResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
