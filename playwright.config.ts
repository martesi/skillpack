import { defineConfig } from '@playwright/test'

const port = 4173

export default defineConfig({
  testDir: './e2e/playwright',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.BUN_CHROME_PATH,
    },
  },
  webServer: {
    command: `bun run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
})
