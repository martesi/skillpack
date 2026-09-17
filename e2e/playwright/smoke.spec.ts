import { expect, test } from '@playwright/test'

test('persists registries but keeps selections and export mode session-only', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('tbody tr')).toHaveCount(0)

  await page.evaluate(() => {
    localStorage.setItem('skillpack:registries', JSON.stringify(['martesi/arca']))
    localStorage.setItem(
      'skillpack:registry:martesi/arca',
      JSON.stringify({
        savedAt: Date.now(),
        skills: [{ name: 'arca-index', path: 'skills/arca-index' }],
      }),
    )
    localStorage.setItem(
      'skillpack:registry:openai/skills',
      JSON.stringify({
        savedAt: Date.now(),
        skills: [{ name: 'docs', path: 'skills/docs' }],
      }),
    )
  })
  await page.reload()

  await expect(page.locator('tr[data-registry="martesi/arca"]')).toHaveCount(1)
  await page.getByLabel('Select martesi/arca/arca-index').check()
  await page.getByRole('textbox', { name: 'Registry' }).fill('https://github.com/openai/skills')
  await page.getByRole('button', { name: 'Add registry' }).click()

  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByLabel('Select openai/skills/docs').check()
  await page.getByText('Per-skill ZIPs', { exact: true }).click()
  await expect(page.locator('tbody input[type=checkbox]:checked')).toHaveCount(2)
  await expect(page.getByLabel('Per-skill ZIPs')).toBeChecked()

  await page.reload()

  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.locator('tr[data-registry="martesi/arca"]')).toHaveCount(1)
  await expect(page.locator('tr[data-registry="openai/skills"]')).toHaveCount(1)
  await expect(page.locator('tbody input[type=checkbox]:checked')).toHaveCount(0)
  await expect(page.getByLabel('One pack')).toBeChecked()
  await expect(page.getByRole('button', { name: 'Export ZIP' })).toBeDisabled()
})
