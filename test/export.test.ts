import { afterEach, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
import { buildSkillZip } from '../src/lib/export'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('bundles selected skills from multiple registries into one ZIP', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)

    if (url.endsWith('/repos/owner/one/contents/skills/alpha')) {
      return Response.json([
        { path: 'skills/alpha/SKILL.md', type: 'file', download_url: 'https://raw.test/alpha.md' },
        { path: 'skills/alpha/references', type: 'dir' },
      ])
    }
    if (url.endsWith('/repos/owner/one/contents/skills/alpha/references')) {
      return Response.json([
        { path: 'skills/alpha/references/note.md', type: 'file', download_url: 'https://raw.test/note.md' },
      ])
    }
    if (url.endsWith('/repos/owner/two/contents/skills/beta')) {
      return Response.json([{ path: 'skills/beta/SKILL.md', type: 'file', download_url: 'https://raw.test/beta.md' }])
    }
    if (url === 'https://raw.test/alpha.md') return new Response('# Alpha')
    if (url === 'https://raw.test/beta.md') return new Response('# Beta')
    if (url === 'https://raw.test/note.md') return new Response(new Uint8Array([0, 1, 2, 255]))

    throw new Error(`Unexpected fetch: ${url}`)
  }

  const archive = unzipSync(
    await buildSkillZip([
      { registry: 'owner/one', paths: ['skills/alpha'] },
      { registry: 'owner/two', paths: ['skills/beta'] },
    ]),
  )

  expect(Object.keys(archive).sort()).toEqual([
    'skills/alpha/SKILL.md',
    'skills/alpha/references/note.md',
    'skills/beta/SKILL.md',
  ])
  expect(strFromU8(archive['skills/alpha/SKILL.md'])).toBe('# Alpha')
  expect(strFromU8(archive['skills/beta/SKILL.md'])).toBe('# Beta')
  expect([...archive['skills/alpha/references/note.md']]).toEqual([0, 1, 2, 255])
})
