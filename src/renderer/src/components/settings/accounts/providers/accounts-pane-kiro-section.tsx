import { translate } from '../../../../i18n/i18n'
import type { Translate } from '../../../../i18n/use-translate'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { matchesSettingsSearch } from '../../search/settings-search'
import { getAccountsKiroSearchEntries } from '../accounts-search'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import { KiroAccountsSection } from './KiroAccountsSection'

/** Fork: Kiro's saved accounts, shown after Antigravity in the Accounts pane. */
export function renderKiroAccountsSection(
  model: AccountsPaneSectionModel,
  t: Translate = translate
): React.JSX.Element | null {
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
