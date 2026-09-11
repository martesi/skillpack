import { expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'

const port = 4173
const cdpPort = Bun.env.CDP_PORT ?? '9223'
const baseUrl = `http://127.0.0.1:${port}`
const browserSession = `skillpack-test-${process.pid}-${Date.now()}`
const browserProfile = `/tmp/${browserSession}`
const chromium = Bun.env.AGENT_BROWSER_EXECUTABLE_PATH ?? Bun.which('chromium') ?? 'chromium'

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

function browser(...args: string[]) {
  const result = Bun.spawnSync(['agent-browser', '--session', browserSession, '--cdp', cdpPort, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString())
  return result.stdout.toString().trim()
}

test('persists multiple registries and selections in one table', async () => {
  const chrome = Bun.spawn(
    [
      chromium,
      '--headless=new',
      '--no-sandbox',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  const server = Bun.spawn(['bun', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdout: 'ignore',
    stderr: 'inherit',
  })

  try {
    await waitForServer()
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
        if (response.ok) break
      } catch {}
      if (attempt === 49) throw new Error(`Chromium CDP did not become ready on port ${cdpPort}`)
      await Bun.sleep(100)
    }

    browser('open', baseUrl)
    browser(
      'eval',
      `
      localStorage.setItem('skillpack:registry:martesi/arca', JSON.stringify({
        savedAt: Date.now(),
        skills: [{ name: 'arca-index', path: 'skills/arca-index' }],
      }));
      localStorage.setItem('skillpack:registry:openai/skills', JSON.stringify({
        savedAt: Date.now(),
        skills: [{ name: 'docs', path: 'skills/docs' }],
      }));
    `,
    )
    browser('reload')
    browser('wait', 'tr[data-registry="martesi/arca"]')
    expect(browser('get', 'count', 'tbody tr')).toBe('1')

    browser('check', 'input[aria-label="Select martesi/arca/arca-index"]')
    browser('fill', 'input[aria-label="Registry"]', 'openai/skills')
    browser('click', 'button[type="submit"]')
    browser('wait', 'tr[data-registry="openai/skills"]')
    expect(browser('get', 'count', 'tbody tr')).toBe('2')
    browser('check', 'input[aria-label="Select openai/skills/docs"]')
    expect(browser('get', 'count', 'tbody input[type=checkbox]:checked')).toBe('2')

    browser('reload')
    browser('wait', 'tr[data-registry="openai/skills"]')
    expect(browser('get', 'count', 'tbody tr')).toBe('2')
    expect(browser('get', 'count', 'tr[data-registry="martesi/arca"]')).toBe('1')
    expect(browser('get', 'count', 'tr[data-registry="openai/skills"]')).toBe('1')
    expect(browser('get', 'count', 'tbody input[type=checkbox]:checked')).toBe('2')
    expect(browser('is', 'enabled', 'button:not([type="submit"])')).toBe('true')
  } finally {
    try {
      browser('close')
    } catch {}
    chrome.kill()
    server.kill()
    await Promise.all([chrome.exited, server.exited])
    await rm(browserProfile, { recursive: true, force: true })
  }
}, 30_000)
