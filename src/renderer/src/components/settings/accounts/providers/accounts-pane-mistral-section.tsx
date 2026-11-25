import { useTranslate } from '../../../../i18n/use-translate'
import { getProviderAccountsOwnerKey } from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { matchesSettingsSearch } from '../../search/settings-search'
import { getAccountsMistralSearchEntries } from '../accounts-mistral-search'
import type { AccountsPaneSectionModel } from '../accounts-pane-types'
import { MistralAccountsSection } from './MistralAccountsSection'

type MistralSectionModel = Pick<
  AccountsPaneSectionModel,
  'searchQuery' | 'accountOwner' | 'isRemoteAccountScope' | 'accountRuntimeSentenceLabel'
>

/** Fork: Mistral Vibe's saved API-key accounts, after Kiro in the Accounts pane (FORK.md section 10).
 *  A component, not a render call: the pane's model carries ref-reading runners the React compiler
 *  rejects in render. */
export function MistralAccountsPaneSection({
  model
}: {
  model: MistralSectionModel
}): React.JSX.Element | null {
  const t = useTranslate()
  if (!matchesSettingsSearch(model.searchQuery, getAccountsMistralSearchEntries())) {
    return null
  }
  return (
    <MistralAccountsSection
      key={`mistral:${getProviderAccountsOwnerKey(model.accountOwner)}`}
      owner={model.accountOwner}
      label={
        model.isRemoteAccountScope
          ? model.accountRuntimeSentenceLabel
          : t('accounts.mistral.thisComputer', 'this computer')
      }
    />
  )
}
