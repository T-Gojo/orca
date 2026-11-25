import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readKeychainPassword } from '../macos-keychain/generic-password'

export type MistralApiKeySource = 'env' | 'dotenv' | 'keychain'
export type CurrentMistralApiKey = { apiKey: string; source: MistralApiKeySource }

const MISTRAL_KEYCHAIN_SERVICE = 'ai.mistral.vibe'
const MISTRAL_KEYCHAIN_ACCOUNT = 'MISTRAL_API_KEY'

export function getMistralVibeHome(): string {
  return process.env.VIBE_HOME ?? join(homedir(), '.vibe')
}

/** One dotenv line, the way mistral-vibe writes its `.env`: `MISTRAL_API_KEY=value`. */
function readDotenvMistralApiKey(contents: string): string | null {
  for (const line of contents.split('\n')) {
    const text = line.trim()
    if (!text || text.startsWith('#')) {
      continue
    }
    const equal = text.indexOf('=')
    if (equal <= 0) {
      continue
    }
    const name = text.slice(0, equal).trim()
    if (name !== 'MISTRAL_API_KEY') {
      continue
    }
    let value = text.slice(equal + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    return value.length > 0 ? value : null
  }
  return null
}

/**
 * Mistral Vibe's own credential priority: `MISTRAL_API_KEY` in the environment, then
 * `$VIBE_HOME/.env` (created `0600` by `vibe --setup`), then the macOS Keychain item
 * `ai.mistral.vibe`/`MISTRAL_API_KEY` that a browser sign-in provisions. Orca only reads;
 * it never writes this keychain item.
 */
export async function readCurrentMistralApiKey(): Promise<CurrentMistralApiKey | null> {
  const fromEnv = process.env.MISTRAL_API_KEY?.trim()
  if (fromEnv) {
    return { apiKey: fromEnv, source: 'env' }
  }
  try {
    // Same 0600-permission assumption mistral-vibe itself makes for its `.env`.
    const dotenv = readDotenvMistralApiKey(
      await readFile(join(getMistralVibeHome(), '.env'), 'utf8')
    )
    if (dotenv) {
      return { apiKey: dotenv, source: 'dotenv' }
    }
  } catch {
    // A missing or unreadable `.env` simply falls through to the keychain.
  }
  if (process.platform !== 'darwin') {
    return null
  }
  const keychain = await readKeychainPassword(MISTRAL_KEYCHAIN_SERVICE, MISTRAL_KEYCHAIN_ACCOUNT)
  return keychain ? { apiKey: keychain, source: 'keychain' } : null
}
