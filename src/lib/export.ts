import { zipSync } from 'fflate'
import { z } from 'zod'
import { fetchGithubBlob, githubHeaders } from './github'

const githubContents = z.array(
  z.object({
    path: z.string(),
    type: z.string(),
    sha: z.string().optional(),
    download_url: z.string().nullable().optional(),
  }),
)

export interface SkillSource {
  registry: string
  paths: string[]
  token?: string
}

export interface IndividualSkillSource {
  registry: string
  name: string
  path: string
  token?: string
}

export async function buildSkillZip(sources: SkillSource[]) {
  const entries = (
    await Promise.all(
      sources.flatMap(({ registry, paths, token }) =>
        paths.map((path) => fetchSkillFiles(registry, path, token)),
      ),
    )
  ).flat()
  const files: Record<string, Uint8Array> = {}

  for (const [path, contents] of entries) {
    if (path in files) throw new Error(`Duplicate skill file path: ${path}`)
    files[path] = contents
  }

  return zipSync(files)
}

export async function buildIndividualSkillZips(skills: IndividualSkillSource[]) {
  const archiveNames = uniqueArchiveNames(skills)
  const archives = await Promise.all(
    skills.map(async (skill, index) => {
      const files = Object.fromEntries(
        (await fetchSkillFiles(skill.registry, skill.path, skill.token)).map(([path, contents]) => [
          relativeSkillPath(path, skill.path),
          contents,
        ]),
      )
      return [archiveNames[index], zipSync(files)] as const
    }),
  )

  return zipSync(Object.fromEntries(archives))
}

function uniqueArchiveNames(skills: IndividualSkillSource[]) {
  const used = new Set<string>()

  return skills.map((skill) => {
    const base = skill.name.replaceAll(/[^a-zA-Z0-9._-]+/g, '-') || 'skill'
    let name = `${base}.zip`
    let suffix = 2
    while (used.has(name)) {
      name = `${base}-${suffix}.zip`
      suffix += 1
    }
    used.add(name)
    return name
  })
}

function relativeSkillPath(path: string, skillPath: string) {
  if (!skillPath) return path
  return path.slice(skillPath.length + 1)
}

async function fetchSkillFiles(registry: string, path: string, token?: string): Promise<[string, Uint8Array][]> {
  const response = await fetch(`https://api.github.com/repos/${registry}/contents/${path}`, {
    headers: githubHeaders(token),
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`)

  const parsed = githubContents.safeParse(await response.json())
  if (!parsed.success) throw parsed.error

  return (await Promise.all(parsed.data.map((entry) => fetchEntry(registry, entry, token)))).flat()
}

async function fetchEntry(
  registry: string,
  entry: z.infer<typeof githubContents>[number],
  token?: string,
): Promise<[string, Uint8Array][]> {
  if (entry.type === 'dir') return fetchSkillFiles(registry, entry.path, token)
  if (entry.type !== 'file') return []
  if (token && entry.sha) return [[entry.path, await fetchGithubBlob(registry, entry.sha, token)]]
  if (!entry.download_url) return []

  const response = await fetch(entry.download_url)
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${entry.path}`)
  return [[entry.path, new Uint8Array(await response.arrayBuffer())]]
}
