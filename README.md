# Skillpack

Static Svelte PWA for portable agent skill registries.

A registry is a GitHub repository containing one or more `SKILL.md` files. Skillpack follows the same bounded discovery shape as the `skills` CLI, also recognizing APM's `.apm/skills/` layout, then caches successful responses locally and lets the user select skills.

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
