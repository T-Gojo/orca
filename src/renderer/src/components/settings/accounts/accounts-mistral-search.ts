import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../search/settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

// Fork: Mistral Vibe's Accounts search entry (FORK.md section 10), kept out of upstream's catalog file.
export const getAccountsMistralSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('accounts.mistral.searchTitle', 'Mistral Vibe Accounts'),
    description: translate(
      'accounts.mistral.searchDescription',
      'Save Mistral Vibe API keys and pick which one each new Mistral Vibe terminal uses, with each account’s quota usage.'
    ),
    keywords: [
      ...translateSearchKeyword('accounts.mistral.keyword.mistralVibe', 'mistral vibe'),
      ...translateSearchKeyword('accounts.mistral.keyword.vibe', 'vibe'),
      ...translateSearchKeyword('accounts.antigravity.keyword.accounts', 'accounts'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.a9f3d7b5c8', 'login'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.cursor.kw.usage', 'usage')
    ]
  }
])
