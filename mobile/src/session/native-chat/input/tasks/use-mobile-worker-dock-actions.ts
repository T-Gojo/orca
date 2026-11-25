import { useCallback, useRef, useState } from 'react'
import * as z from 'zod'
import {
  formatOrcaSessionAddress,
  isOrcaSessionId
} from '../../../../../../src/shared/agent-session/identity/orca-session-address'
import {
  workerDockClearable,
  type WorkerDockEntry
} from '../../../../../../src/shared/orchestration/dock/worker-dock'
import { triggerSelection } from '../../../../platform/haptics/haptics'
import type { ConnectionState } from '../../../../transport/connection/connection-state'
import type { RpcClient } from '../../../../transport/rpc/rpc-client-contract'
import { defineRpcOperation, runRpcOperation } from '../../../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../../../transport/rpc/rpc-operation-result-reader'

// Fork: mobile worker dock Stop and Clear actions (FORK.md §15).

const workerDockStopOp = defineRpcOperation({
  name: 'fork.mobile-worker-dock-stop',
  method: 'orchestration.workerDockStop',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('worker-dock-stop', z.unknown())
})

const workerDockAckOp = defineRpcOperation({
  name: 'fork.mobile-worker-dock-acknowledge',
  method: 'orchestration.workerDockAcknowledge',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('worker-dock-ack', z.unknown())
})

export type MobileWorkerDockActions = {
  available: boolean
  busyIds: ReadonlySet<string>
  clearingAll: boolean
  error: string | null
  onStop: (row: WorkerDockEntry) => void
  onClear: (row: WorkerDockEntry) => void
  onClearAll: (rows: readonly WorkerDockEntry[]) => void
}

let actionSeq = 0

function nextRequestId(prefix: string): string {
  actionSeq += 1
  return `${prefix}:${Date.now()}:${actionSeq}`
}

export function canStopDockRow(row: WorkerDockEntry): boolean {
  return (
    row.stoppable &&
    row.ownerActionsAvailable !== false &&
    row.state !== 'stopping' &&
    row.state !== 'failed' &&
    row.state !== 'unexpected' &&
    row.state !== 'idle'
  )
}

export function useMobileWorkerDockActions({
  client,
  connState,
  sessionId
}: {
  client: RpcClient | null
  connState: ConnectionState
  sessionId: string | null
}): MobileWorkerDockActions {
  const party = sessionId && isOrcaSessionId(sessionId) ? formatOrcaSessionAddress(sessionId) : null
  const available = Boolean(client && connState === 'connected' && party)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const busyRef = useRef<Set<string>>(new Set())
  const [clearingAll, setClearingAll] = useState(false)
  const clearingAllRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const setBusy = useCallback((id: string, busy: boolean) => {
    const next = new Set(busyRef.current)
    if (busy) {
      next.add(id)
    } else {
      next.delete(id)
    }
    busyRef.current = next
    setBusyIds(next)
  }, [])

  const onStop = useCallback(
    (row: WorkerDockEntry) => {
      if (!client || connState !== 'connected' || !party || !canStopDockRow(row)) {
        return
      }
      if (busyRef.current.has(row.id)) {
        return
      }
      triggerSelection()
      setError(null)
      setBusy(row.id, true)
      void runRpcOperation(client, workerDockStopOp, {
        party,
        dispatch: row.dispatchId,
        requestId: nextRequestId('mobile-dock-stop')
      }).then(
        () => {
          setBusy(row.id, false)
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
          setBusy(row.id, false)
        }
      )
    },
    [client, connState, party, setBusy]
  )

  const onClear = useCallback(
    (row: WorkerDockEntry) => {
      if (!client || connState !== 'connected' || !party || !workerDockClearable(row)) {
        return
      }
      if (busyRef.current.has(row.id)) {
        return
      }
      triggerSelection()
      setError(null)
      setBusy(row.id, true)
      void runRpcOperation(client, workerDockAckOp, {
        party,
        settlements: [{ dispatchId: row.dispatchId, settlement: row.settlement }],
        acknowledged: true
      }).then(
        () => {
          setBusy(row.id, false)
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
          setBusy(row.id, false)
        }
      )
    },
    [client, connState, party, setBusy]
  )

  const onClearAll = useCallback(
    (rows: readonly WorkerDockEntry[]) => {
      if (!client || connState !== 'connected' || !party || clearingAllRef.current) {
        return
      }
      const settlements = rows.flatMap((row) =>
        workerDockClearable(row) ? [{ dispatchId: row.dispatchId, settlement: row.settlement }] : []
      )
      if (settlements.length === 0) {
        return
      }
      triggerSelection()
      setError(null)
      clearingAllRef.current = true
      setClearingAll(true)
      void runRpcOperation(client, workerDockAckOp, {
        party,
        settlements,
        acknowledged: true
      }).then(
        () => {
          clearingAllRef.current = false
          setClearingAll(false)
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
          clearingAllRef.current = false
          setClearingAll(false)
        }
      )
    },
    [client, connState, party]
  )

  return { available, busyIds, clearingAll, error, onStop, onClear, onClearAll }
}
