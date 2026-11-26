import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approvePairingCode,
  ecosystemPaths,
  readEcosystemConfig,
  readEcosystemSecrets,
  setEcosystemSecret
} from './ecosystem-config'
import {
  buildHermesReviewBrief,
  parseAndValidateHermesSkill,
  saveValidatedSkillWithUndo,
  stripTrojanUnicode,
  undoLearnedSkill
} from './hermes-learning-connector'
import {
  formatRikuganContextResult,
  isExplicitRikuganRequest,
  isTrivialRikuganPrompt,
  resetRikuganSessionStateForTests,
  scrubSecretsForRikugan
} from './rikugan-connector'

describe('Unified Orca Ecosystem connectors (Rikugan, Hermes, OpenClaw)', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    resetRikuganSessionStateForTests()
    delete process.env.ORCA_ECOSYSTEM_DIR
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps Rikugan strictly opt-in and deduplicates/scrubs when explicitly requested', () => {
    // Urgent coding/CLI tasks must NEVER involve Rikugan unless explicitly asked
    expect(isExplicitRikuganRequest('Fix production auth race condition right now')).toBe(false)
    expect(isExplicitRikuganRequest('Complete PR #18 in Claude and push to main')).toBe(false)
    expect(isExplicitRikuganRequest('Check Rikugan for my HDFC credit card statement')).toBe(true)
    expect(isExplicitRikuganRequest('/rikugan summarize open threads')).toBe(true)
    expect(isExplicitRikuganRequest('Summarize open threads', true)).toBe(true)

    expect(isTrivialRikuganPrompt('thanks!')).toBe(true)
    expect(isTrivialRikuganPrompt('/status')).toBe(true)
    expect(isTrivialRikuganPrompt('Summarize my HDFC credit card statement')).toBe(false)

    const seen = new Set<string>()
    const rawContext = {
      brief: 'Owner prefers concise technical summaries.',
      preferences: [{ id: 'pref:1', statement: 'Run checks with --maxWorkers=2' }],
      facts: [{ id: 'fact:1', statement: 'Rikugan stays on Mac internal SSD' }],
      sessions: [{ id: 'sess:1', title: 'Orca F5 mobile build', summary: 'Installed APK' }]
    }

    const turn1 = formatRikuganContextResult(rawContext, { includeBrief: true, seenIds: seen })
    expect(turn1.itemCount).toBe(3)
    expect(turn1.text).toContain('Owner prefers concise technical summaries.')
    expect(turn1.text).toContain('[pref:1]')

    // Turn 2 with identical nodes + brief already sent should emit nothing (preserves prompt cache!)
    const turn2 = formatRikuganContextResult(rawContext, { includeBrief: false, seenIds: seen })
    expect(turn2.itemCount).toBe(0)
    expect(turn2.text).toBe('')

    // Secret & OTP scrubbing before writing session summaries to Rikugan
    const dirty =
      'Used token rkg_AbCdEf1234567890xyz and OTP 482910 with sk-proj1234567890abcdefghijkl'
    const scrubbed = scrubSecretsForRikugan(dirty)
    expect(scrubbed).not.toContain('rkg_AbCdEf')
    expect(scrubbed).not.toContain('482910')
    expect(scrubbed).not.toContain('sk-proj123')
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('enforces Hermes <=60-char routing description, strips Trojan unicode, and supports 1-tap Undo', async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), 'orca-eco-hermes-'))
    tempDirs.push(tmpHome)
    process.env.ORCA_ECOSYSTEM_DIR = join(tmpHome, '.config', 'orca-ecosystem')

    const trojan = 'Clean\u202Etext\u2066with-bidi\u200F'
    expect(stripTrojanUnicode(trojan)).toBe('Cleantextwith-bidi')

    // Rejects >60 char description
    const tooLong = `---\nname: test-long\ndescription: "${'x'.repeat(65)}"\n---\n\nValid body text with concrete instructions for the agent.\n`
    expect(parseAndValidateHermesSkill(tooLong).valid).toBe(false)

    // Rejects embedded secret
    const leaked = `---\nname: test-leak\ndescription: "Short valid routing description"\n---\n\nExport token rkg_SecretToken1234567890 right here.\n`
    expect(parseAndValidateHermesSkill(leaked).valid).toBe(false)

    // Saves valid skill across ~/.agents/skills and CLI homes, patches it, and Undoes cleanly
    const v1 = `---\nname: ssd-cache-routing\ndescription: "Route dev build caches to Thunder SSD"\n---\n\nAlways source ~/.config/thunder-cache-env.sh in non-interactive shells.\n`
    const savedV1 = await saveValidatedSkillWithUndo({ markdown: v1, skipScanner: true }, tmpHome)
    expect(savedV1.ok).toBe(true)
    expect(savedV1.entry?.action).toBe('created')

    const v2 = `---\nname: ssd-cache-routing\ndescription: "Route Gradle and Cargo caches to SSD"\n---\n\nUpdated instructions with GRADLE_USER_HOME and CARGO_HOME.\n`
    const savedV2 = await saveValidatedSkillWithUndo({ markdown: v2, skipScanner: true }, tmpHome)
    expect(savedV2.ok).toBe(true)
    expect(savedV2.entry?.action).toBe('patched')

    const undonePatch = await undoLearnedSkill('ssd-cache-routing', tmpHome)
    expect(undonePatch.ok).toBe(true)
    expect(undonePatch.detail).toContain('Restored previous version')

    const undoneCreate = await undoLearnedSkill('ssd-cache-routing', tmpHome)
    expect(undoneCreate.ok).toBe(true)
    const canonicalExists = await stat(
      join(tmpHome, '.agents', 'skills', 'ssd-cache-routing', 'SKILL.md')
    ).then(
      () => true,
      () => false
    )
    expect(canonicalExists).toBe(false)

    const review = buildHermesReviewBrief({
      messages: [{ role: 'user', text: 'Check PR #42' }],
      focus: 'auth boundary',
      loadedSkills: ['appsec-review-and-fix']
    })
    expect(review.goal).toBe('Review: auth boundary')
    expect(review.prompt).toContain('appsec-review-and-fix')
  })

  it('persists 0600 secrets and promotes valid 6-digit pairing codes into channel allowlists', async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), 'orca-eco-cfg-'))
    tempDirs.push(tmpHome)
    process.env.ORCA_ECOSYSTEM_DIR = join(tmpHome, '.config', 'orca-ecosystem')

    await setEcosystemSecret('TELEGRAM_BOT_TOKEN', '123456:TEST_BOT_TOKEN', tmpHome)
    const secrets = await readEcosystemSecrets(tmpHome)
    expect(secrets.TELEGRAM_BOT_TOKEN).toBe('123456:TEST_BOT_TOKEN')
    expect(secrets.ORCA_ECOSYSTEM_TOKEN).toMatch(/^orca_eco_/)

    const paths = ecosystemPaths(tmpHome)
    const envStat = await stat(paths.envFile)
    expect(envStat.mode & 0o777).toBe(0o600)

    await mkdir(paths.root, { recursive: true })
    await writeFile(
      paths.pairingFile,
      JSON.stringify({
        pending: [
          {
            code: '849201',
            channel: 'telegram',
            senderId: '99887766',
            senderName: 'Thunder',
            createdAt: 1_700_000_000_000,
            expiresAt: 9_999_999_999_999
          }
        ],
        approvedTelegram: [],
        approvedWhatsapp: []
      }),
      'utf8'
    )

    const approved = await approvePairingCode('849201', tmpHome)
    expect(approved?.senderId).toBe('99887766')
    const cfg = await readEcosystemConfig(tmpHome)
    expect(cfg.telegramAllowFrom).toContain('99887766')
  })
})
