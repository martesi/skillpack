import { expect, test } from 'bun:test'

const port = 4173
const baseUrl = `http://127.0.0.1:${port}`

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error(`Dev server did not become ready at ${baseUrl}`)
}

test('adds a registry', async () => {
  const server = Bun.spawn(
    ['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdout: 'ignore', stderr: 'inherit' },
  )

  try {
    await waitForServer()
    const view = new Bun.WebView({ backend: 'chrome' })

    try {
      await view.navigate(baseUrl)
      expect(await view.evaluate("document.querySelector('h1')?.textContent")).toBe('Skillpack')

      await view.evaluate(`(() => {
        const input = document.querySelector('input[aria-label="Registry"]');
        input.value = 'openai/skills';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await view.click('button[type="submit"]')

      expect(await view.evaluate('document.body.textContent')).toContain('openai/skills')
    } finally {
      view.close()
    }
  } finally {
    server.kill()
    await server.exited
  }
}, 15_000)
