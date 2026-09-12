import { expect, test } from 'bun:test'
import { discoverRegistrySkills, findSkillMdPaths, normalizeRegistry } from '../src/lib/registry'

const blob = (path: string) => ({ path, type: 'blob' })

test('normalizes GitHub repository inputs', () => {
  expect(normalizeRegistry('owner/repo')).toBe('owner/repo')
  expect(normalizeRegistry('https://github.com/owner/repo')).toBe('owner/repo')
  expect(normalizeRegistry('https://github.com/owner/repo.git/')).toBe('owner/repo')
  expect(normalizeRegistry('https://github.com/owner/repo/tree/main')).toBe('owner/repo')
  expect(normalizeRegistry('https://example.com/owner/repo')).toBeNull()
})

test('matches skills CLI priority discovery and APM skill containers', () => {
  expect(
    findSkillMdPaths([
      blob('skills/flat/SKILL.md'),
      blob('skills/category/nested/SKILL.md'),
      blob('.agents/skills/group/agent-skill/SKILL.md'),
      blob('.apm/skills/apm-skill/SKILL.md'),
      blob('custom/SKILL.md'),
      blob('examples/category/example-skill/SKILL.md'),
    ]),
  ).toEqual([
    'custom/SKILL.md',
    'skills/flat/SKILL.md',
    'skills/category/nested/SKILL.md',
    '.apm/skills/apm-skill/SKILL.md',
    '.agents/skills/group/agent-skill/SKILL.md',
  ])
})

test('root skill short-circuits and nested skills do not leak through a parent skill', () => {
  expect(findSkillMdPaths([blob('SKILL.md'), blob('skills/alpha/SKILL.md')])).toEqual(['SKILL.md'])
  expect(findSkillMdPaths([blob('skills/outer/SKILL.md'), blob('skills/outer/inner/SKILL.md')])).toEqual([
    'skills/outer/SKILL.md',
  ])
})

test('falls back to arbitrary paths only when no priority skills exist', () => {
  expect(
    findSkillMdPaths([
      blob('packages/category/beta/SKILL.md'),
      blob('examples/deep/gamma/SKILL.md'),
      blob('node_modules/pkg/SKILL.md'),
    ]),
  ).toEqual(['packages/category/beta/SKILL.md', 'examples/deep/gamma/SKILL.md'])
})

test('uses SKILL.md frontmatter names when discovering a registry', async () => {
  const originalFetch = globalThis.fetch
  const requested: string[] = []

  globalThis.fetch = (async (input) => {
    const url = String(input)
    requested.push(url)

    if (url === 'https://api.github.com/repos/owner/repo') return Response.json({ default_branch: 'main' })
    if (url === 'https://api.github.com/repos/owner/repo/git/trees/main?recursive=1') {
      return Response.json({
        truncated: false,
        tree: [blob('skills/folder-name/SKILL.md'), blob('packages/category/fallback/SKILL.md')],
      })
    }
    if (url === 'https://raw.githubusercontent.com/owner/repo/main/skills/folder-name/SKILL.md') {
      return new Response('---\nname: public-name\ndescription: test skill\n---\n')
    }

    return new Response(null, { status: 404 })
  }) as typeof fetch

  try {
    expect(await discoverRegistrySkills('owner/repo')).toEqual([{ name: 'public-name', path: 'skills/folder-name' }])
    expect(requested).toEqual([
      'https://api.github.com/repos/owner/repo',
      'https://api.github.com/repos/owner/repo/git/trees/main?recursive=1',
      'https://raw.githubusercontent.com/owner/repo/main/skills/folder-name/SKILL.md',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
