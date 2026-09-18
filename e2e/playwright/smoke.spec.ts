import { expect, test } from '@playwright/test'

test('builder persists registries, tracks updates, and keeps pack choices session-only', async ({ page }) => {
  const updateRequests: string[] = []

  await page.route('https://api.github.com/repos/*/*/git/trees/*?recursive=1', async (route) => {
    const url = route.request().url()
    updateRequests.push(url)

    if (url.includes('/martesi/arca/')) {
      await route.fulfill({
        json: {
          sha: 'arca-root',
          truncated: false,
          tree: [
            { path: 'skills', type: 'tree', sha: 'skills-sha' },
            { path: 'skills/arca-index', type: 'tree', sha: 'arca-new-sha' },
            { path: 'skills/arca-index/SKILL.md', type: 'blob', sha: 'arca-skill-md' },
            { path: 'skills/new-skill', type: 'tree', sha: 'new-skill-sha' },
            { path: 'skills/new-skill/SKILL.md', type: 'blob', sha: 'new-skill-md' },
          ],
        },
      })
      return
    }

    await route.fulfill({
      json: {
        sha: 'openai-root',
        truncated: false,
        tree: [
          { path: 'skills', type: 'tree', sha: 'skills-sha' },
          { path: 'skills/docs', type: 'tree', sha: 'docs-sha' },
          { path: 'skills/docs/SKILL.md', type: 'blob', sha: 'docs-skill-md' },
        ],
      },
    })
  })

  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('skillpack:registries', JSON.stringify(['martesi/arca']))
    localStorage.setItem(
      'skillpack:registry:martesi/arca',
      JSON.stringify({
        savedAt: Date.now(),
        branch: 'main',
        skills: [
          {
            name: 'arca-index',
            description: 'Index Arca skills',
            path: 'skills/arca-index',
            fingerprint: 'arca-old-sha',
          },
        ],
      }),
    )
    localStorage.setItem(
      'skillpack:registry:openai/skills',
      JSON.stringify({
        savedAt: Date.now(),
        branch: 'main',
        skills: [
          {
            name: 'docs',
            description: 'Work with documents',
            path: 'skills/docs',
            fingerprint: 'docs-sha',
          },
        ],
      }),
    )
    localStorage.setItem(
      'skillpack:last-export',
      JSON.stringify({
        savedAt: Date.now() - 10_000,
        skills: {
          'martesi/arca:skills/arca-index': {
            registry: 'martesi/arca',
            name: 'arca-index',
            path: 'skills/arca-index',
            fingerprint: 'arca-old-sha',
          },
          'martesi/arca:skills/removed': {
            registry: 'martesi/arca',
            name: 'removed',
            path: 'skills/removed',
            fingerprint: 'removed-sha',
          },
          'openai/skills:skills/docs': {
            registry: 'openai/skills',
            name: 'docs',
            path: 'skills/docs',
            fingerprint: 'docs-sha',
          },
        },
      }),
    )
  })
  await page.reload()

  await expect(page.locator('.skill-item[data-registry="martesi/arca"]')).toHaveCount(1)
  await page.getByLabel('Select martesi/arca/arca-index').check()
  await page.getByRole('textbox', { name: 'Registry' }).fill('https://github.com/openai/skills')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: /All registries/ }).click()

  await expect(page.locator('.skill-item[data-registry]')).toHaveCount(2)
  await page.getByLabel('Select openai/skills/docs').check()
  await page.getByText('Per-skill ZIPs', { exact: true }).click()
  await expect(page.locator('.skill-item input[type=checkbox]:checked')).toHaveCount(2)

  await page.getByRole('button', { name: 'Check updates' }).click()
  await expect(page.getByText('Updated', { exact: true })).toHaveCount(1)
  await expect(page.getByText('New', { exact: true })).toHaveCount(1)
  expect(updateRequests).toHaveLength(2)

  await page.getByLabel('Filter skills').selectOption('updates')
  await expect(page.getByText('removed', { exact: true })).toBeVisible()
  await expect(page.getByText('Removed', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByText('All registries', { exact: true })).toBeVisible()
  await expect(page.locator('.skill-item[data-registry]')).toHaveCount(3)
  await expect(page.locator('.skill-item input[type=checkbox]:checked')).toHaveCount(0)
  await expect(page.getByLabel('One pack')).toBeChecked()
  await expect(page.getByRole('button', { name: 'Export skillpack.zip' })).toBeDisabled()
})
