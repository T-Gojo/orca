import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { MobileAgentIcon } from '../components/icons/MobileAgentIcon'
import { ListGroup, ListRow, SectionHeader } from '../components/list/ListGroup'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { runRpcOperation } from '../transport/rpc/rpc-operation'
import { styles } from './mobile-accounts-screen-styles'
import {
  antigravityListOp,
  antigravitySelectOp,
  kiroListOp,
  kiroSelectOp,
  mistralListOp,
  type MobileAntigravityAccountState,
  type MobileKiroAccountState,
  type MobileMistralAccountState
} from './mobile-fork-accounts-rpc'

// Fork: Kiro, Antigravity, and Mistral Vibe account switcher section on MobileAccountsScreen (FORK.md §15).

export function MobileForkProviderAccountsSection(props: {
  client: RpcClient | null
  connected: boolean
  refreshToken: number
  onNotice: (notice: { title: string; message: string }) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [kiro, setKiro] = useState<MobileKiroAccountState | null>(null)
  const [antigravity, setAntigravity] = useState<MobileAntigravityAccountState | null>(null)
  const [mistral, setMistral] = useState<MobileMistralAccountState | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  useEffect(() => {
    if (!props.client || !props.connected) {
      return
    }
    let cancelled = false
    const client = props.client
    void Promise.all([
      runRpcOperation(client, kiroListOp).catch(() => null),
      runRpcOperation(client, antigravityListOp, { runtime: 'host' }).catch(() => null),
      runRpcOperation(client, mistralListOp).catch(() => null)
    ]).then(([kiroRes, agyRes, mistralRes]) => {
      if (cancelled) {
        return
      }
      setKiro(kiroRes)
      setAntigravity(agyRes)
      setMistral(mistralRes)
    })
    return () => {
      cancelled = true
    }
  }, [props.client, props.connected, props.refreshToken])

  const selectKiro = useCallback(
    (accountId: string) => {
      if (!props.client || !props.connected || busyKey !== null) {
        return
      }
      const key = `kiro:${accountId}`
      setBusyKey(key)
      const failTitle = t('accounts.screen.switchFailed', 'Could not switch account')
      void runRpcOperation(props.client, kiroSelectOp, { accountId }).then(
        (next) => {
          setKiro(next)
          setBusyKey(null)
        },
        (err: unknown) => {
          props.onNotice({
            title: failTitle,
            message: err instanceof Error ? err.message : String(err)
          })
          setBusyKey(null)
        }
      )
    },
    [props, busyKey, t]
  )

  const selectAntigravity = useCallback(
    (accountId: string) => {
      if (!props.client || !props.connected || busyKey !== null) {
        return
      }
      const key = `antigravity:${accountId}`
      setBusyKey(key)
      const failTitle = t('accounts.screen.switchFailed', 'Could not switch account')
      void runRpcOperation(props.client, antigravitySelectOp, {
        target: { runtime: 'host' },
        accountId
      }).then(
        (next) => {
          setAntigravity(next)
          setBusyKey(null)
        },
        (err: unknown) => {
          props.onNotice({
            title: failTitle,
            message: err instanceof Error ? err.message : String(err)
          })
          setBusyKey(null)
        }
      )
    },
    [props, busyKey, t]
  )

  const spinner = <ActivityIndicator size="small" color={colors.textSecondary} />
  const switchBlocked = !props.connected || busyKey !== null

  return (
    <>
      {kiro && kiro.accounts.length > 0 ? (
        <View>
          <SectionHeader
            title={t('fork.accounts.kiro', 'Kiro')}
            icon={<MobileAgentIcon agentId="kiro" size={14} />}
          />
          <ListGroup style={styles.group}>
            {kiro.accounts.map((account) => {
              const isActive = (kiro.activeAccountId ?? kiro.selectedAccountId) === account.id
              const title = account.email || account.userId || account.id
              return (
                <ListRow
                  key={account.id}
                  title={title}
                  subtitle={account.authMethod}
                  selected={isActive}
                  accessory={busyKey === `kiro:${account.id}` ? spinner : undefined}
                  onPress={switchBlocked || isActive ? undefined : () => selectKiro(account.id)}
                />
              )
            })}
          </ListGroup>
        </View>
      ) : null}

      {antigravity && antigravity.accounts.length > 0 ? (
        <View>
          <SectionHeader
            title={t('fork.accounts.antigravity', 'Antigravity')}
            icon={<MobileAgentIcon agentId="antigravity" size={14} />}
          />
          <ListGroup style={styles.group}>
            {antigravity.accounts.map((account) => {
              const isActive =
                (antigravity.activeAccountId ?? antigravity.selectedAccountId) === account.id
              const title = account.email || account.subject || account.id
              return (
                <ListRow
                  key={account.id}
                  title={title}
                  subtitle={account.authMethod}
                  selected={isActive}
                  accessory={busyKey === `antigravity:${account.id}` ? spinner : undefined}
                  onPress={
                    switchBlocked || isActive ? undefined : () => selectAntigravity(account.id)
                  }
                />
              )
            })}
          </ListGroup>
        </View>
      ) : null}

      {mistral && mistral.accounts.length > 0 ? (
        <View>
          <SectionHeader
            title={t('fork.accounts.mistral', 'Mistral Vibe')}
            icon={<MobileAgentIcon agentId="mistral-vibe" size={14} />}
            trailing={t('fork.accounts.pinnedPerLaunch', 'Per-launch pin')}
          />
          <ListGroup style={styles.group}>
            {mistral.accounts.map((account) => {
              const isCurrent = mistral.currentAccount?.keyFingerprint === account.keyFingerprint
              return (
                <ListRow
                  key={account.id}
                  title={account.customer}
                  subtitle={account.planName ?? undefined}
                  selected={isCurrent}
                />
              )
            })}
          </ListGroup>
        </View>
      ) : null}
    </>
  )
}
