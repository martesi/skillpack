import { z } from 'zod'

const githubBlob = z.object({
  content: z.string(),
  encoding: z.literal('base64'),
})

export function githubHeaders(token?: string) {
  const headers = new Headers({ Accept: 'application/vnd.github+json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

export async function fetchGithubBlob(registry: string, sha: string, token?: string) {
  const response = await fetch(`https://api.github.com/repos/${registry}/git/blobs/${encodeURIComponent(sha)}`, {
    headers: githubHeaders(token),
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${registry}`)

  const blob = githubBlob.parse(await response.json())
  const binary = atob(blob.content.replaceAll('\n', ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
