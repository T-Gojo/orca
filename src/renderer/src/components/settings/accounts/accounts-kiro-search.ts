import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from '../search/settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

// Fork: Kiro's Accounts search entry (FORK.md section 1), kept out of upstream's catalog file.
export const getAccountsKiroSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('accounts.kiro.searchTitle', 'Kiro Accounts'),
    description: translate(
      'accounts.kiro.searchDescription',
      'Save kiro-cli logins and switch between them, with each account’s credit usage.'
    ),
    keywords: [
      ...translateSearchKeyword('accounts.kiro.keyword.kiro', 'kiro'),
      ...translateSearchKeyword('accounts.kiro.keyword.kiroCli', 'kiro-cli'),
      ...translateSearchKeyword('accounts.antigravity.keyword.accounts', 'accounts'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.a9f3d7b5c8', 'login'),
      ...translateSearchKeyword('auto.components.settings.accounts.search.cursor.kw.usage', 'usage')
    ]
  }
])
