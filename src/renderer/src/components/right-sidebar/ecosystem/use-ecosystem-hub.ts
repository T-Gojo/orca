import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type {
  EcosystemAskResult,
  EcosystemControlAction,
  EcosystemLearnResult,
  EcosystemStatusSnapshot
} from '../../../../../shared/ecosystem/ecosystem-types'

/** Fork: state and RPC controller hook for Desktop Ecosystem Hub & Workspace views (FORK.md §16). */

export type SkillHubItem = NonNullable<EcosystemLearnResult['items']>[number]

export function useEcosystemHub(isVisible: boolean) {
  const [status, setStatus] = useState<EcosystemStatusSnapshot | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [lastAskReply, setLastAskReply] = useState<string | null>(null)
  const [skillResults, setSkillResults] = useState<SkillHubItem[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    setIsRefreshing(true)
    callRuntimeRpc<EcosystemStatusSnapshot>(
      { kind: 'local' },
      'delegation.ecosystemStatus',
      {},
      { timeoutMs: 12_000 }
    )
      .then((res) => {
        if (mountedRef.current) {
          setStatus(res)
          setErrorText(null)
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setErrorText(err instanceof Error ? err.message : String(err))
        }
      })
      .then(() => {
        if (mountedRef.current) {
          setIsRefreshing(false)
        }
      })
  }, [])

  useEffect(() => {
    if (isVisible) {
      refresh()
    }
  }, [isVisible, refresh])

  const runControl = useCallback(
    (
      action: EcosystemControlAction,
      payload: {
        code?: string
        token?: string
        skillName?: string
        message?: string
        channel?: 'auto' | 'telegram' | 'whatsapp'
      } = {}
    ) => {
      setBusyAction(action)
      setErrorText(null)
      callRuntimeRpc<{ ok: boolean; detail: string; status: EcosystemStatusSnapshot }>(
        { kind: 'local' },
        'delegation.ecosystemControl',
        { action, ...payload },
        { timeoutMs: 95_000 }
      )
        .then((res) => {
          if (mountedRef.current) {
            setStatus(res.status)
            setNotice(res.detail)
          }
        })
        .catch((err: unknown) => {
          if (mountedRef.current) {
            setErrorText(err instanceof Error ? err.message : String(err))
          }
        })
        .then(() => {
          if (mountedRef.current) {
            setBusyAction(null)
          }
        })
    },
    []
  )

  const submitAsk = useCallback(
    (prompt: string, wait: boolean, rikugan: boolean = false) => {
      const trimmed = prompt.trim()
      if (!trimmed) {
        return
      }
      setBusyAction('ask')
      setErrorText(null)
      setLastAskReply(null)
      callRuntimeRpc<EcosystemAskResult>(
        { kind: 'local' },
        'delegation.ecosystemAsk',
        { prompt: trimmed, source: 'desktop', wait, ...(rikugan ? { rikugan: true } : {}) },
        { timeoutMs: wait ? 160_000 : 25_000 }
      )
        .then((res) => {
          if (!mountedRef.current) {
            return
          }
          if (!res.accepted) {
            setErrorText(res.error ?? 'Dispatch failed')
          } else if (res.reply) {
            setLastAskReply(res.reply)
            setNotice(null)
          } else {
            setNotice(`Dispatched to ${res.routedAgent ?? 'Orca HQ'}.`)
          }
          refresh()
        })
        .catch((err: unknown) => {
          if (mountedRef.current) {
            setErrorText(err instanceof Error ? err.message : String(err))
          }
        })
        .then(() => {
          if (mountedRef.current) {
            setBusyAction(null)
          }
        })
    },
    [refresh]
  )

  const runHermes = useCallback(
    (mode: 'learn' | 'review' | 'skills-install' | 'skills-search', value: string) => {
      setBusyAction(mode)
      setErrorText(null)
      callRuntimeRpc<EcosystemLearnResult>(
        { kind: 'local' },
        'delegation.ecosystemLearn',
        {
          mode,
          ...(mode === 'learn' ? { topic: value } : {}),
          ...(mode === 'review' ? { focus: value } : {}),
          ...(mode === 'skills-install' || mode === 'skills-search' ? { query: value } : {})
        },
        { timeoutMs: 75_000 }
      )
        .then((res) => {
          if (!mountedRef.current) {
            return
          }
          if (mode === 'skills-search') {
            setSkillResults(res.items ?? [])
          }
          if (res.ok) {
            setNotice(res.summary)
          } else {
            setErrorText(res.summary)
          }
          refresh()
        })
        .catch((err: unknown) => {
          if (mountedRef.current) {
            setErrorText(err instanceof Error ? err.message : String(err))
          }
        })
        .then(() => {
          if (mountedRef.current) {
            setBusyAction(null)
          }
        })
    },
    [refresh]
  )

  return {
    status,
    isRefreshing,
    busyAction,
    notice,
    errorText,
    lastAskReply,
    skillResults,
    refresh,
    runControl,
    submitAsk,
    runHermes
  }
}
