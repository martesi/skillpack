# Skillpack

Static Svelte PWA for portable agent skill registries.

A registry is a GitHub repository with skills under `skills/<name>/`. Skillpack loads registries directly from GitHub in the browser, caches successful responses locally, and lets the user select skills.

## Development

```sh
bun install
bun run dev
```

Checks:

```sh
bun run check
bun run build
bun run test:integration
bun run test:e2e
```
