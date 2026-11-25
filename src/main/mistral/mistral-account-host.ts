import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-lifecycle/app-environment'
import { createEncryptedMistralAccountStore } from './mistral-account-store'
import { readCurrentMistralApiKey } from './mistral-credential-source'
import { fetchMistralWhoami } from './mistral-whoami'
import { MistralAccountService } from './mistral-account-service'

let service: MistralAccountService | null = null

export function getMistralAccountService(): MistralAccountService {
  service ??= new MistralAccountService(
    createEncryptedMistralAccountStore(
      join(getAppEnvironment().getPath('userData'), 'mistral-accounts', 'vault')
    ),
    readCurrentMistralApiKey,
    fetchMistralWhoami
  )
  return service
}
