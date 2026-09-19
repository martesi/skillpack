import { expect, test } from '@playwright/test'

test('manages credentials, applies global defaults, and allows registry overrides', async ({ page }) => {
  const globalToken = 'synthetic-global-token'
  const privateToken = 'synthetic-private-token'
  const authByRepo = new Map<string, string[]>()

  await page.route('https://api.github.com/repos/**', async (route) => {
    const url = new URL(route.request().url())
    const [, , owner, repo] = url.pathname.split('/')
    const key = `${owner}/${repo}`
    const calls = authByRepo.get(key) ?? []
    calls.push(route.request().headers().authorization ?? '')
    authByRepo.set(key, calls)

    if (url.pathname === `/repos/${key}`) {
      await route.fulfill({ json: { default_branch: 'main' } })
      return
    }
    if (url.pathname.includes('/git/trees/main')) {
      await route.fulfill({
        json: {
          sha: 'root',
          truncated: false,
          tree: [
            { path: 'skills', type: 'tree', sha: 'skills' },
            { path: 'skills/demo', type: 'tree', sha: `${repo}-demo` },
            { path: 'skills/demo/SKILL.md', type: 'blob', sha: `${repo}-skill` },
          ],
        },
      })
      return
    }
    if (url.pathname.includes('/git/blobs/')) {
      const content = Buffer.from(`---\nname: demo\ndescription: ${key}\n---\n`).toString('base64')
      await route.fulfill({ json: { encoding: 'base64', content } })
      return
    }

    await route.abort()
  })

  await page.goto('/')
  await page.locator('summary').filter({ hasText: 'Credentials' }).click()

  await page.getByRole('textbox', { name: 'Credential name' }).fill('Global')
  await page.getByRole('textbox', { name: 'Credential token' }).fill(globalToken)
  await page.getByRole('button', { name: 'Add credential' }).click()
  await page.getByLabel('Global credential').selectOption({ label: 'Global' })

  await page.getByRole('textbox', { name: 'Registry' }).fill('owner/publicish')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('demo', { exact: true })).toBeVisible()

  await page.getByRole('textbox', { name: 'Registry' }).fill('owner/private')
  await page.getByLabel('Registry credential').selectOption({ label: 'Add credential…' })
  await page.getByRole('textbox', { name: 'New credential name' }).fill('Private')
  await page.getByRole('textbox', { name: 'New credential token' }).fill(privateToken)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit owner/private' })).toBeVisible()

  expect(authByRepo.get('owner/publicish')).toEqual([
    `Bearer ${globalToken}`,
    `Bearer ${globalToken}`,
    `Bearer ${globalToken}`,
  ])
  expect(authByRepo.get('owner/private')).toEqual([
    `Bearer ${privateToken}`,
    `Bearer ${privateToken}`,
    `Bearer ${privateToken}`,
  ])

  await page.getByRole('button', { name: 'Edit owner/private' }).click()
  await page.getByRole('textbox', { name: 'Registry URL' }).fill('owner/private-renamed')
  await page.getByLabel('Registry edit credential').selectOption({ label: 'Global' })
  await page.getByRole('form', { name: 'Edit registry' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Edit owner/private-renamed' })).toBeVisible()

  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('skillpack', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const read = (key: string) =>
      new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('credentials').objectStore('credentials').get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

    const key = (await read('github-credentials-key')) as CryptoKey
    const encrypted = (await read('github-credentials')) as { iv: ArrayBuffer; ciphertext: ArrayBuffer }
    db.close()
    return {
      keyExtractable: key.extractable,
      ivLength: encrypted.iv.byteLength,
      ciphertextText: new TextDecoder().decode(encrypted.ciphertext),
    }
  })

  expect(stored.keyExtractable).toBe(false)
  expect(stored.ivLength).toBe(12)
  expect(stored.ciphertextText).not.toContain(globalToken)
  expect(stored.ciphertextText).not.toContain(privateToken)
})
