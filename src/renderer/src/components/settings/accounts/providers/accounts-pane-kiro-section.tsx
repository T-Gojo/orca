import { useTranslate } from '../../../../i18n/use-translate'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { matchesSettingsSearch } from '../../search/settings-search'
import { getAccountsKiroSearchEntries } from '../accounts-kiro-search'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import { KiroAccountsSection } from './KiroAccountsSection'

type KiroSectionModel = Pick<
  AccountsPaneSectionModel,
  'searchQuery' | 'accountOwner' | 'isRemoteAccountScope' | 'accountRuntimeSentenceLabel'
>

/** Fork: Kiro's saved accounts, shown after Antigravity in the Accounts pane. A component, not a
 *  render call: the pane's model carries ref-reading runners the React compiler rejects in render. */
export function KiroAccountsPaneSection({
  model
}: {
  model: KiroSectionModel
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!matchesSettingsSearch(model.searchQuery, getAccountsKiroSearchEntries())) {
    return null
  }
  return (
    <KiroAccountsSection
      key={`kiro:${getProviderAccountsOwnerKey(model.accountOwner)}`}
      owner={model.accountOwner}
      label={
        model.isRemoteAccountScope
          ? model.accountRuntimeSentenceLabel
          : t('accounts.kiro.thisComputer', 'this computer')
      }
    />
  )
}
