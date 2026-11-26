import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { saveValidatedSkillWithUndo, stripTrojanUnicode } from './hermes-learning-connector'

/** Fork: Hermes Skills Hub federation — local domain packs + ClawHub/GitHub search & audited install (§16). */

export type SkillsHubCandidate = {
  name: string
  source: 'domain-pack' | 'github' | 'installed'
  description: string
  url: string | null
  localPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

function normalizeHermesFrontmatter(rawMarkdown: string, fallbackName: string): string {
  const clean = stripTrojanUnicode(rawMarkdown).replace(/\r\n/g, '\n').trim()
  const safeSlug =
    fallbackName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'imported-skill'

  const match = clean.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/)
  if (!match) {
    const firstLine = clean.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? safeSlug
    const shortDesc =
      firstLine.replace(/["']/g, '').trim().slice(0, 58) || 'Imported workflow skill'
    return `---\nname: ${safeSlug}\ndescription: "${shortDesc}"\n---\n\n${clean}\n`
  }
  const fm = match[1] ?? ''
  const body = (match[2] ?? '').trim()
  const nameMatch = fm.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)
  const descMatch = fm.match(/^description:\s*["']?([^\n"']+)["']?\s*$/m)
  const slug =
    (nameMatch?.[1] ?? safeSlug)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 58) || safeSlug
  const rawDesc = (descMatch?.[1] ?? `Workflow for ${slug}`).replace(/["']/g, '').trim()
  const boundedDesc = rawDesc.length <= 60 ? rawDesc : `${rawDesc.slice(0, 57).trimEnd()}...`
  return `---\nname: ${slug}\ndescription: "${boundedDesc}"\n---\n\n${body}\n`
}

async function searchLocalDomainPacks(query: string, home: string): Promise<SkillsHubCandidate[]> {
  const packsRoot = join(home, 'agent-skill-packs')
  if (!(await exists(packsRoot))) {
    return []
  }
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
  if (terms.length === 0) {
    return []
  }
  const domains = await readdir(packsRoot, { withFileTypes: true }).catch(() => [])
  const hits: SkillsHubCandidate[] = []
  for (const domain of domains) {
    if (!domain.isDirectory() && !domain.isSymbolicLink()) {
      continue
    }
    const domainDir = join(packsRoot, domain.name)
    const entries = await readdir(domainDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue
      }
      const lower = `${domain.name}/${entry.name}`.toLowerCase()
      if (!terms.some((term) => lower.includes(term))) {
        continue
      }
      const skillMd = join(domainDir, entry.name, 'SKILL.md')
      if (!(await exists(skillMd))) {
        continue
      }
      const head = await readFile(skillMd, 'utf8').catch(() => '')
      const descMatch = head.match(/^description:\s*["']?([^\n"']+)["']?/m)
      hits.push({
        name: entry.name,
        source: 'domain-pack',
        description: (descMatch?.[1] ?? `Domain pack (${domain.name})`).slice(0, 90),
        url: skillMd,
        localPath: skillMd
      })
      if (hits.length >= 12) {
        return hits
      }
    }
  }
  return hits
}

async function searchGitHubSkills(query: string): Promise<SkillsHubCandidate[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4_500)
  try {
    const q = encodeURIComponent(`${query} filename:SKILL.md`)
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} agent skill`)}&per_page=6`,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'orca-ecosystem/1.0' },
        signal: controller.signal
      }
    )
    void q
    if (!res.ok) {
      return []
    }
    const data: unknown = await res.json()
    if (!isRecord(data) || !Array.isArray(data.items)) {
      return []
    }
    return data.items
      .filter(isRecord)
      .slice(0, 6)
      .map((repo) => ({
        name: String(repo.name ?? 'skill'),
        source: 'github' as const,
        description: String(repo.description ?? 'GitHub agent skill repository').slice(0, 90),
        url: typeof repo.html_url === 'string' ? repo.html_url : null
      }))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function searchSkillsHub(
  query: string,
  home: string = homedir()
): Promise<SkillsHubCandidate[]> {
  const [localHits, githubHits] = await Promise.all([
    searchLocalDomainPacks(query, home),
    searchGitHubSkills(query)
  ])
  return [...localHits, ...githubHits].slice(0, 15)
}

export async function installFromSkillsHub(
  specifier: string,
  home: string = homedir()
): Promise<{ ok: boolean; skillName: string | null; backupId: string | null; summary: string }> {
  const trimmed = specifier.trim()
  let markdown: string | null = null
  let fallbackName = 'imported-skill'

  if (await exists(trimmed)) {
    const file = trimmed.endsWith('SKILL.md') ? trimmed : join(trimmed, 'SKILL.md')
    markdown = await readFile(file, 'utf8').catch(() => null)
    fallbackName = basename(trimmed.endsWith('SKILL.md') ? dirname(trimmed) : trimmed)
  } else if (/^https?:\/\//i.test(trimmed)) {
    const rawUrl = trimmed.replace(
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//,
      'https://raw.githubusercontent.com/$1/'
    )
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const res = await fetch(rawUrl, { signal: controller.signal })
      if (res.ok) {
        markdown = await res.text()
      }
    } catch {
      markdown = null
    } finally {
      clearTimeout(timer)
    }
    fallbackName = basename(trimmed.replace(/\/SKILL\.md$/i, ''))
  } else {
    const localHits = await searchLocalDomainPacks(trimmed, home)
    const exact =
      localHits.find((item) => item.name.toLowerCase() === trimmed.toLowerCase()) ?? localHits[0]
    if (exact?.localPath) {
      markdown = await readFile(exact.localPath, 'utf8').catch(() => null)
      fallbackName = exact.name
    }
  }

  if (!markdown) {
    return {
      ok: false,
      skillName: null,
      backupId: null,
      summary: `Could not locate SKILL.md for '${trimmed}' in local domain packs or URL.`
    }
  }
  const normalized = normalizeHermesFrontmatter(markdown, fallbackName)
  const saved = await saveValidatedSkillWithUndo({ markdown: normalized }, home)
  if (!saved.ok || !saved.entry) {
    return {
      ok: false,
      skillName: null,
      backupId: null,
      summary: saved.error ?? 'Skill validation failed.'
    }
  }
  return {
    ok: true,
    skillName: saved.entry.skillName,
    backupId: saved.entry.backupId,
    summary: `Installed '${saved.entry.skillName}' across ~/.agents/skills and all 6 CLIs (backup ${saved.entry.backupId}).`
  }
}
