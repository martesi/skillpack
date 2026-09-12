import { z } from 'zod'

const githubRepository = z.object({ default_branch: z.string() })
const githubTree = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
})
const registryName = z.string().regex(/^[\w.-]+\/[\w.-]+$/)

const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__'])
const skillContainerDepth = 3
const priorityPrefixes = [
  '',
  'skills/',
  'skills/.curated/',
  'skills/.experimental/',
  'skills/.system/',
  '.apm/skills/',
  '.agents/skills/',
  '.claude/skills/',
  '.cline/skills/',
  '.codebuddy/skills/',
  '.codex/skills/',
  '.commandcode/skills/',
  '.continue/skills/',
  '.factory/skills/',
  '.github/skills/',
  '.goose/skills/',
  '.grok/skills/',
  '.iflow/skills/',
  '.junie/skills/',
  '.kilo/skills/',
  '.kilocode/skills/',
  '.kimchi/skills/',
  '.kiro/skills/',
  '.minimax/skills/',
  '.mux/skills/',
  '.neovate/skills/',
  '.opencode/skills/',
  '.openhands/skills/',
  '.pi/skills/',
  '.posit/assistant/skills/',
  '.qoder/skills/',
  '.roo/skills/',
  '.trae/skills/',
  '.windsurf/skills/',
  '.zcode/skills/',
  '.zencoder/skills/',
] as const

interface GithubTreeEntry {
  path: string
  type: string
}

export interface RegistrySkill {
  name: string
  path: string
}

export function normalizeRegistry(input: string): string | null {
  const direct = registryName.safeParse(input.trim())
  if (direct.success) return direct.data

  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null

    const [owner, rawRepo] = url.pathname.split('/').filter(Boolean)
    if (!owner || !rawRepo) return null
    const repo = rawRepo.replace(/\.git$/, '')
    const normalized = registryName.safeParse(`${owner}/${repo}`)
    return normalized.success ? normalized.data : null
  } catch {
    return null
  }
}

export async function discoverRegistrySkills(registry: string): Promise<RegistrySkill[]> {
  const repository = githubRepository.parse(await fetchGithub(`https://api.github.com/repos/${registry}`, registry))
  const tree = githubTree.parse(
    await fetchGithub(
      `https://api.github.com/repos/${registry}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
      registry,
    ),
  )

  if (tree.truncated) throw new Error(`GitHub returned a truncated tree for ${registry}`)

  const skills = await Promise.all(
    findSkillMdPaths(tree.tree).map(async (skillMdPath) => {
      const content = await fetchText(
        `https://raw.githubusercontent.com/${registry}/${encodeURIComponent(repository.default_branch)}/${encodePath(skillMdPath)}`,
        registry,
      )
      const name = skillName(content)
      if (!name) return null

      return {
        name,
        path: skillMdPath.replace(/\/?skill\.md$/i, ''),
      }
    }),
  )

  return skills
    .filter((skill): skill is RegistrySkill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
}

export function findSkillMdPaths(tree: GithubTreeEntry[]): string[] {
  const skillMdPaths = tree
    .filter((entry) => entry.type === 'blob' && entry.path.toLowerCase().endsWith('skill.md'))
    .map((entry) => entry.path)

  const rootSkill = skillMdPaths.find((path) => path.toLowerCase() === 'skill.md')
  if (rootSkill) return [rootSkill]

  const priorityResults: string[] = []
  const seen = new Set<string>()
  const lowerSkillMdPaths = new Set(skillMdPaths.map((path) => path.toLowerCase()))

  for (const prefix of priorityPrefixes) {
    for (const skillMdPath of skillMdPaths) {
      if (!skillMdPath.startsWith(prefix)) continue

      const rest = skillMdPath.slice(prefix.length)
      const parts = rest.split('/')
      if (parts.at(-1)?.toLowerCase() !== 'skill.md') continue

      const skillDirectories = parts.slice(0, -1)
      const directlyNested = parts.length === 2
      const nestedInContainer =
        prefix !== '' &&
        parts.length >= 3 &&
        parts.length <= skillContainerDepth + 1 &&
        skillDirectories.every((part) => !ignoredDirectories.has(part)) &&
        !hasAncestorSkill(prefix, skillDirectories, lowerSkillMdPaths)

      if (!(directlyNested || nestedInContainer) || seen.has(skillMdPath)) continue

      priorityResults.push(skillMdPath)
      seen.add(skillMdPath)
    }
  }

  if (priorityResults.length > 0) return priorityResults

  return skillMdPaths.filter((path) => {
    const parts = path.split('/')
    return parts.length <= 6 && parts.slice(0, -1).every((part) => !ignoredDirectories.has(part))
  })
}

function hasAncestorSkill(prefix: string, directories: string[], skillMdPaths: Set<string>) {
  return directories.slice(0, -1).some((_, index) => {
    const ancestor = directories.slice(0, index + 1).join('/')
    return skillMdPaths.has(`${prefix}${ancestor}/skill.md`.toLowerCase())
  })
}

function skillName(content: string): string | null {
  const frontmatter = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/)?.[1]
  if (!frontmatter || !/^description:\s*\S/m.test(frontmatter)) return null

  const rawName = frontmatter.match(/^name:\s*(.+?)\s*$/m)?.[1]
  if (!rawName) return null

  if ((rawName.startsWith('"') && rawName.endsWith('"')) || (rawName.startsWith("'") && rawName.endsWith("'"))) {
    return rawName.slice(1, -1)
  }
  return rawName
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function fetchGithub(url: string, registry: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${registry}`)
  return response.json()
}

async function fetchText(url: string, registry: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${registry}`)
  return response.text()
}
