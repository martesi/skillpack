import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/skillpack/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Skillpack',
        short_name: 'Skillpack',
        display: 'standalone',
        start_url: '/skillpack/',
      },
    }),
  ],
})
