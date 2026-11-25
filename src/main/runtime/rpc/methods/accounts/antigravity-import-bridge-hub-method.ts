import { defineMethod } from '../../core'
import { AntigravityAccountTargetParams } from '../../../../../shared/rpc-contract/accounts/antigravity-accounts-params'
import { getAntigravityAccountService } from '../../../../antigravity/native-account-host'
import { readBridgeHubAntigravityLogins } from '../../../../antigravity/bridge-hub-antigravity-accounts'
import { withAntigravityChatBackend } from './antigravity-chat-backend'

// Fork: Bridge Hub import (FORK.md section 2). Kept in its own file so antigravity-accounts.ts
// stays under the oxlint max-lines gate; ANTIGRAVITY_ACCOUNT_METHODS places it last so the
// upstream methods keep their positions in that list.
export const ANTIGRAVITY_IMPORT_BRIDGE_HUB_METHOD = defineMethod({
  name: 'accounts.antigravityImportBridgeHub',
  permission: 'accounts-admin',
  params: AntigravityAccountTargetParams,
  handler: async (target, ctx) => {
    // Fork: Bridge Hub lives on this Mac, so only the host's own agy can take its logins.
    if (target.runtime !== 'host') {
      throw new Error('Bridge Hub accounts can only be imported for this computer’s agy.')
    }
    const logins = await readBridgeHubAntigravityLogins()
    if (logins.length === 0) {
      throw new Error('No Bridge Hub Antigravity accounts were found on this computer.')
    }
    const result = await (await getAntigravityAccountService(target)).importLogins(logins)
    return {
      ...result,
      state: await withAntigravityChatBackend(ctx.runtime, target, result.state)
    }
  }
})
