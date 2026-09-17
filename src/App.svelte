<script lang="ts">
import { z } from 'zod'
import { buildIndividualSkillZips, buildSkillZip, type SkillSource } from './lib/export'
import { discoverRegistrySkills, normalizeRegistry } from './lib/registry'

const cacheMaxAge = 60 * 60 * 1000
const registriesKey = 'skillpack:registries'
const stringArray = z.array(z.string())

interface Skill {
  registry: string
  name: string
  path: string
}

const cachedRegistry = z.object({
  savedAt: z.number(),
  skills: z.array(z.object({ name: z.string(), path: z.string() })),
})

type CachedRegistry = z.infer<typeof cachedRegistry>

let registry = $state('')
let registries = $state(readStringArray(registriesKey))
let skills = $state<Skill[]>([])
let selected = $state<string[]>([])
let exportMode = $state<'pack' | 'individual'>('pack')
let error = $state<string | null>(null)
let loading = $state(false)
let exporting = $state(false)

const allSelected = $derived(skills.length > 0 && selected.length === skills.length)

$effect(() => {
  void loadSavedRegistries()
})

async function loadSavedRegistries() {
  loading = true
  error = null
  try {
    const loaded = await Promise.all(registries.map((value) => fetchRegistry(value)))
    skills = loaded.flat()
    pruneSelection()
  } catch (cause) {
    console.error('registry:load-saved', cause)
    error = 'Could not load the saved registries.'
  } finally {
    loading = false
  }
}

async function addRegistry() {
  const nextRegistry = normalizeRegistry(registry)
  error = null

  if (!nextRegistry) {
    error = 'Registry must be owner/repo or a GitHub repository URL.'
    return
  }
  if (registries.includes(nextRegistry)) {
    registry = ''
    return
  }

  loading = true
  try {
    const nextSkills = await fetchRegistry(nextRegistry)
    registries = [...registries, nextRegistry]
    skills = [...skills, ...nextSkills]
    localStorage.setItem(registriesKey, JSON.stringify(registries))
    registry = ''
    pruneSelection()
  } catch (cause) {
    console.error('registry:add', cause)
    error = 'GitHub could not load this registry.'
  } finally {
    loading = false
  }
}

async function fetchRegistry(value: string): Promise<Skill[]> {
  const cached = readCache(value)
  if (cached && Date.now() - cached.savedAt < cacheMaxAge) return withRegistry(value, cached.skills)

  let nextSkills: CachedRegistry['skills']
  try {
    nextSkills = await discoverRegistrySkills(value)
  } catch (cause) {
    if (cached) return withRegistry(value, cached.skills)
    throw cause
  }

  localStorage.setItem(cacheKey(value), JSON.stringify({ savedAt: Date.now(), skills: nextSkills }))
  return withRegistry(value, nextSkills)
}

async function exportSelected() {
  if (selected.length === 0) return

  error = null
  exporting = true
  try {
    const contents =
      exportMode === 'pack'
        ? await buildSkillZip(selectedSources())
        : await buildIndividualSkillZips(selectedSkills())
    downloadZip(contents, exportMode === 'pack' ? 'skillpack.zip' : 'skillpack-individual.zip')
  } catch (cause) {
    console.error('export:zip', cause)
    error = exportError(cause)
  } finally {
    exporting = false
  }
}

function selectedSkills() {
  return skills.filter((skill) => selected.includes(skillId(skill)))
}

function selectedSources(): SkillSource[] {
  return registries
    .map((source) => ({
      registry: source,
      paths: skills
        .filter((skill) => skill.registry === source && selected.includes(skillId(skill)))
        .map((skill) => skill.path),
    }))
    .filter(({ paths }) => paths.length > 0)
}

function downloadZip(contents: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(contents)], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportError(cause: unknown) {
  if (cause instanceof Error && cause.message.startsWith('Duplicate skill file path:')) return cause.message
  return 'Could not export the selected skills.'
}

function withRegistry(value: string, nextSkills: CachedRegistry['skills']): Skill[] {
  return nextSkills.map((skill) => ({ registry: value, ...skill }))
}

function readCache(value: string): CachedRegistry | null {
  const raw = localStorage.getItem(cacheKey(value))
  if (!raw) return null
  try {
    return cachedRegistry.safeParse(JSON.parse(raw)).data ?? null
  } catch {
    return null
  }
}

function readStringArray(key: string, fallback: string[] = []) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return stringArray.safeParse(JSON.parse(raw)).data ?? fallback
  } catch {
    return fallback
  }
}

function cacheKey(value: string) {
  return `skillpack:registry:${value}`
}

function skillId(skill: Skill) {
  return `${skill.registry}:${skill.path}`
}

function pruneSelection() {
  const available = new Set(skills.map(skillId))
  selected = selected.filter((id) => available.has(id))
}

function toggleAll(checked: boolean) {
  selected = checked ? skills.map(skillId) : []
}

function toggleSkill(skill: Skill, checked: boolean) {
  const id = skillId(skill)
  selected = checked ? [...selected, id] : selected.filter((item) => item !== id)
}
</script>

<main class="container">
  <header class="hero">
    <small class="eyebrow">Portable agent skills</small>
    <h1>Skillpack</h1>
    <p>Collect skills from GitHub registries, choose exactly what travels, then export the shape ChatGPT needs.</p>
  </header>

  <article class="registry-panel">
    <form aria-label="Add registry" onsubmit={(event) => { event.preventDefault(); void addRegistry() }}>
      <label for="registry-input">
        <strong>Add a registry</strong>
        <small>GitHub repository URL or <code>owner/repo</code></small>
      </label>
      <div class="registry-controls">
        <input id="registry-input" aria-label="Registry" placeholder="github.com/openai/skills" bind:value={registry} autocomplete="off" />
        <button type="submit" aria-busy={loading} disabled={loading}>Add registry</button>
      </div>
    </form>
  </article>

  {#if error}
    <p role="alert">{error}</p>
  {/if}

  {#if skills.length > 0}
    <section class="skills-panel" aria-labelledby="skills-title">
      <div class="section-heading">
        <div>
          <h2 id="skills-title">Skills</h2>
          <small>{registries.length} registries · {skills.length} found</small>
        </div>
        <div class="selection-actions">
          <span class="selection-count"><strong>{selected.length}</strong> selected</span>
          <fieldset class="export-mode" aria-label="Export packaging">
            <label>
              <input type="radio" name="export-mode" value="pack" bind:group={exportMode} />
              <span>One pack</span>
            </label>
            <label>
              <input type="radio" name="export-mode" value="individual" bind:group={exportMode} />
              <span>Per-skill ZIPs</span>
            </label>
          </fieldset>
          <button type="button" onclick={() => void exportSelected()} disabled={selected.length === 0 || exporting} aria-busy={exporting}>Export ZIP</button>
        </div>
      </div>

      <div class="table-wrap" data-empty-selection={selected.length === 0}>
        <table>
          <thead>
            <tr>
              <th class="select-column" scope="col">
                <input
                  aria-label="Select all skills"
                  type="checkbox"
                  checked={allSelected}
                  onchange={(event) => toggleAll(event.currentTarget.checked)}
                />
              </th>
              <th scope="col">Registry</th>
              <th scope="col">Skill</th>
              <th scope="col">Path</th>
            </tr>
          </thead>
          <tbody>
            {#each skills as skill}
              <tr data-registry={skill.registry}>
                <td class="select-column">
                  <input
                    aria-label={`Select ${skill.registry}/${skill.name}`}
                    type="checkbox"
                    checked={selected.includes(skillId(skill))}
                    onchange={(event) => toggleSkill(skill, event.currentTarget.checked)}
                  />
                </td>
                <td><code>{skill.registry}</code></td>
                <th scope="row">{skill.name}</th>
                <td><code>{skill.path}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</main>
