import { zipSync } from 'fflate'
import { z } from 'zod'

const githubContents = z.array(
  z.object({
    path: z.string(),
    type: z.string(),
    download_url: z.string().nullable().optional(),
  }),
)

export interface SkillSource {
  registry: string
  paths: string[]
}

export async function buildSkillZip(sources: SkillSource[]) {
  const entries = (
    await Promise.all(sources.flatMap(({ registry, paths }) => paths.map((path) => fetchSkillFiles(registry, path))))
  ).flat()
  const files: Record<string, Uint8Array> = {}

  for (const [path, contents] of entries) {
    if (path in files) throw new Error(`Duplicate skill file path: ${path}`)
    files[path] = contents
  }

  return zipSync(files)
}

async function fetchSkillFiles(registry: string, path: string): Promise<[string, Uint8Array][]> {
  const response = await fetch(`https://api.github.com/repos/${registry}/contents/${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${path}`)

  const parsed = githubContents.safeParse(await response.json())
  if (!parsed.success) throw parsed.error

  return (await Promise.all(parsed.data.map((entry) => fetchEntry(registry, entry)))).flat()
}

async function fetchEntry(
  registry: string,
  entry: z.infer<typeof githubContents>[number],
): Promise<[string, Uint8Array][]> {
  if (entry.type === 'dir') return fetchSkillFiles(registry, entry.path)
  if (entry.type !== 'file' || !entry.download_url) return []

  const response = await fetch(entry.download_url)
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${entry.path}`)
  return [[entry.path, new Uint8Array(await response.arrayBuffer())]]
}
