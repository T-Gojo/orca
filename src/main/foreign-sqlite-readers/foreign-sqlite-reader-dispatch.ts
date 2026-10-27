import type {
  ForeignSqliteReaderRequest,
  ForeignSqliteReaderResponse
} from './foreign-sqlite-reader-protocol'
import { readCursorProfile } from './readers/cursor-profile'
import { readKiroCliToken } from './readers/kiro-cli-token'
import { readKiroCliLogin, writeKiroCliLogin } from './readers/kiro-cli-login'
import { readOpenCodeBinderSessions } from './readers/opencode-binder-sessions'

/** Structured-clone requests may carry unknown kinds despite the static type. */
export function handleForeignSqliteReaderRequest(
  request: ForeignSqliteReaderRequest
): ForeignSqliteReaderResponse {
  // Destructuring here preserves request narrowing through kind and exhaustiveness at never.
  const { id, kind } = request
  try {
    switch (kind) {
      case 'cursorProfile':
        return { id, ok: true, value: readCursorProfile(request.dbPath) }
      case 'kiroCliToken':
        return { id, ok: true, value: readKiroCliToken(request.dbPath) }
      case 'kiroCliLogin':
        return { id, ok: true, value: readKiroCliLogin(request.dbPath) }
      case 'kiroCliLoginWrite':
        return {
          id,
          ok: true,
          value: writeKiroCliLogin(request.dbPath, request.contents, request.expected)
        }
      case 'openCodeBinderSessions':
        return { id, ok: true, value: readOpenCodeBinderSessions(request.dbPath, request.cursor) }
    }
    return unknownKind(id, kind)
  } catch (err) {
    return { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// never makes new unhandled request kinds a compile error.
function unknownKind(id: number, kind: never): ForeignSqliteReaderResponse {
  return { id, ok: false, error: `Unknown foreign SQLite reader kind: ${String(kind)}` }
}
