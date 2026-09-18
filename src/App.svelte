<script lang="ts">
import { z } from 'zod'
import { buildIndividualSkillZips, buildSkillZip, type SkillSource } from './lib/export'
import {
  discoverRegistry,
  normalizeRegistry,
  refreshRegistrySkills,
  type RegistrySkill,
} from './lib/registry'

const cacheMaxAge = 60 * 60 * 1000
const registriesKey = 'skillpack:registries'
const lastExportKey = 'skillpack:last-export'
const stringArray = z.array(z.string())

interface Skill extends RegistrySkill {
  registry: string
}

const cachedRegistry = z.object({
  savedAt: z.number(),
  branch: z.string().optional(),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      path: z.string(),
      fingerprint: z.string().optional(),
    }),
  ),
})

const exportSnapshot = z.object({
  savedAt: z.number(),
  skills: z.record(
    z.string(),
    z.object({
      registry: z.string(),
      name: z.string(),
      path: z.string(),
      fingerprint: z.string(),
    }),
  ),
})

type CachedRegistry = z.infer<typeof cachedRegistry>
type ExportSnapshot = z.infer<typeof exportSnapshot>
type ExportMode = 'pack' | 'individual'
type StatusFilter = 'all' | 'updates'

let registry = $state('')
let registries = $state(readStringArray(registriesKey))
let skills = $state<Skill[]>([])
let selected = $state<string[]>([])
let exportMode = $state<ExportMode>('pack')
let activeRegistry = $state('all')
let search = $state('')
let statusFilter = $state<StatusFilter>('all')
let lastExport = $state<ExportSnapshot | null>(readExportSnapshot())
let error = $state<string | null>(null)
let loading = $state(false)
let refreshing = $state(false)
let exporting = $state(false)

$effect(() => {
  void loadSavedRegistries()
})

async function loadSavedRegistries() {
  loading = true
  error = null
  try {
    const loaded = await Promise.all(registries.map(fetchRegistry))
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
    activeRegistry = nextRegistry
    return
  }

  loading = true
  try {
    const nextSkills = await fetchRegistry(nextRegistry)
    registries = [...registries, nextRegistry]
    skills = [...skills, ...nextSkills]
    localStorage.setItem(registriesKey, JSON.stringify(registries))
    registry = ''
    activeRegistry = nextRegistry
  } catch (cause) {
    console.error('registry:add', cause)
    error = 'GitHub could not load this registry.'
  } finally {
    loading = false
  }
}

async function checkUpdates() {
  if (registries.length === 0) return

  refreshing = true
  error = null
  try {
    const refreshed = await Promise.all(registries.map(refreshRegistry))
    skills = refreshed.flat()
    pruneSelection()
  } catch (cause) {
    console.error('registry:check-updates', cause)
    error = 'Could not check registry updates.'
  } finally {
    refreshing = false
  }
}

async function fetchRegistry(value: string): Promise<Skill[]> {
  const cached = readCache(value)
  if (cached && cacheReady(cached) && Date.now() - cached.savedAt < cacheMaxAge) {
    return withRegistry(value, normalizeCachedSkills(cached))
  }

  const discovered = await discoverRegistry(value)
  writeCache(value, { savedAt: Date.now(), ...discovered })
  return withRegistry(value, discovered.skills)
}

async function refreshRegistry(value: string): Promise<Skill[]> {
  const cached = readCache(value)
  if (!cached || !cacheReady(cached) || !cached.branch) return fetchRegistry(value)

  const previous = normalizeCachedSkills(cached)
  try {
    const nextSkills = await refreshRegistrySkills(value, cached.branch, previous)
    writeCache(value, { ...cached, skills: nextSkills })
    return withRegistry(value, nextSkills)
  } catch (cause) {
    console.warn('registry:refresh-fallback', { registry: value, cause })
    const discovered = await discoverRegistry(value)
    writeCache(value, { savedAt: Date.now(), ...discovered })
    return withRegistry(value, discovered.skills)
  }
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
    saveExportSnapshot()
  } catch (cause) {
    console.error('export:zip', cause)
    error = exportError(cause)
  } finally {
    exporting = false
  }
}

function visibleSkills() {
  const query = search.trim().toLowerCase()
  return skills.filter((skill) => {
    if (activeRegistry !== 'all' && skill.registry !== activeRegistry) return false
    if (statusFilter === 'updates' && !isUpdate(skill)) return false
    if (!query) return true
    return [skill.name, skill.description, skill.registry, skill.path].some((value) =>
      value.toLowerCase().includes(query),
    )
  })
}

function statusOf(skill: Skill) {
  if (!lastExport) return 'baseline'
  const previous = lastExport.skills[skillId(skill)]
  if (!previous) return 'new'
  return previous.fingerprint === skill.fingerprint ? 'unchanged' : 'updated'
}

function isUpdate(skill: Skill) {
  const status = statusOf(skill)
  return status === 'new' || status === 'updated'
}

function selectUpdates() {
  selected = skills.filter(isUpdate).map(skillId)
}

function removedSkills() {
  if (!lastExport) return []
  const current = new Set(skills.map(skillId))
  return Object.entries(lastExport.skills)
    .filter(([id, skill]) => registries.includes(skill.registry) && !current.has(id))
    .map(([, skill]) => skill)
}

function updateCount() {
  return skills.filter(isUpdate).length + removedSkills().length
}

function selectedSourceCount() {
  return new Set(selectedSkills().map((skill) => skill.registry)).size
}

function registryCount(value: string) {
  return skills.filter((skill) => skill.registry === value).length
}

function allVisibleSelected() {
  const visible = visibleSkills()
  return visible.length > 0 && visible.every((skill) => selected.includes(skillId(skill)))
}

function toggleVisible(checked: boolean) {
  const ids = new Set(visibleSkills().map(skillId))
  selected = checked
    ? [...new Set([...selected, ...ids])]
    : selected.filter((id) => !ids.has(id))
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

function toggleSkill(skill: Skill, checked: boolean) {
  const id = skillId(skill)
  selected = checked ? [...selected, id] : selected.filter((item) => item !== id)
}

function saveExportSnapshot() {
  lastExport = {
    savedAt: Date.now(),
    skills: Object.fromEntries(
      skills.map((skill) => [
        skillId(skill),
        {
          registry: skill.registry,
          name: skill.name,
          path: skill.path,
          fingerprint: skill.fingerprint,
        },
      ]),
    ),
  }
  localStorage.setItem(lastExportKey, JSON.stringify(lastExport))
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

function withRegistry(value: string, nextSkills: RegistrySkill[]): Skill[] {
  return nextSkills.map((skill) => ({ registry: value, ...skill }))
}

function normalizeCachedSkills(cache: CachedRegistry): RegistrySkill[] {
  return cache.skills.map((skill) => ({
    name: skill.name,
    description: skill.description ?? '',
    path: skill.path,
    fingerprint: skill.fingerprint ?? '',
  }))
}

function cacheReady(cache: CachedRegistry) {
  return Boolean(cache.branch) && cache.skills.every((skill) => Boolean(skill.fingerprint))
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

function writeCache(value: string, cache: CachedRegistry) {
  localStorage.setItem(cacheKey(value), JSON.stringify(cache))
}

function readExportSnapshot(): ExportSnapshot | null {
  const raw = localStorage.getItem(lastExportKey)
  if (!raw) return null
  try {
    return exportSnapshot.safeParse(JSON.parse(raw)).data ?? null
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

function skillId(skill: Pick<Skill, 'registry' | 'path'>) {
  return `${skill.registry}:${skill.path}`
}

function pruneSelection() {
  const available = new Set(skills.map(skillId))
  selected = selected.filter((id) => available.has(id))
}
</script>

<div class="app-shell">
  <header class="topbar">
    <div class="brand">skillpack</div>
    <div class="crumb">/ builder</div>
    <div class="topbar-spacer"></div>
    <button class="secondary-action" type="button" onclick={() => void checkUpdates()} disabled={refreshing || loading || registries.length === 0} aria-busy={refreshing}>
      Check updates
    </button>
  </header>

  <div class="workspace">
    <aside class="registry-sidebar">
      <div class="panel-label">Registries</div>
      <nav class="registry-list" aria-label="Registries">
        <button class:active={activeRegistry === 'all'} type="button" onclick={() => activeRegistry = 'all'} aria-pressed={activeRegistry === 'all'}>
          <span class="status-dot"></span>
          <span><strong>All registries</strong><small>{skills.length} skills</small></span>
        </button>
        {#each registries as source}
          <button class:active={activeRegistry === source} type="button" onclick={() => activeRegistry = source} aria-pressed={activeRegistry === source}>
            <span class="status-dot"></span>
            <span><strong>{source}</strong><small>{registryCount(source)} skills</small></span>
          </button>
        {/each}
      </nav>

      <form class="add-registry" aria-label="Add registry" onsubmit={(event) => { event.preventDefault(); void addRegistry() }}>
        <input aria-label="Registry" placeholder="owner/repo" bind:value={registry} autocomplete="off" />
        <button type="submit" disabled={loading} aria-busy={loading}>Add</button>
      </form>
    </aside>

    <main class="skills-main">
      <div class="main-head">
        <div class="title-row">
          <div>
            <h1>Choose skills</h1>
            <small>{visibleSkills().length} shown · {selected.length} selected</small>
          </div>
          {#if updateCount() > 0}
            <button class="text-action" type="button" onclick={selectUpdates}>Select updates ({updateCount()})</button>
          {/if}
        </div>
        <div class="search-row">
          <input aria-label="Search skills" placeholder="Search saved registries" bind:value={search} />
          <select aria-label="Filter skills" bind:value={statusFilter}>
            <option value="all">All skills</option>
            <option value="updates">Updates only</option>
          </select>
        </div>
      </div>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <div class="skill-list">
        {#if visibleSkills().length > 0}
          <label class="select-all">
            <input type="checkbox" aria-label="Select visible skills" checked={allVisibleSelected()} onchange={(event) => toggleVisible(event.currentTarget.checked)} />
            <span>Select visible</span>
          </label>

          {#each visibleSkills() as skill}
            <label class="skill-item" data-registry={skill.registry}>
              <input
                aria-label={`Select ${skill.registry}/${skill.name}`}
                type="checkbox"
                checked={selected.includes(skillId(skill))}
                onchange={(event) => toggleSkill(skill, event.currentTarget.checked)}
              />
              <span class="skill-copy">
                <span class="skill-title">
                  <strong>{skill.name}</strong>
                  {#if statusOf(skill) === 'updated'}<span class="badge updated">Updated</span>{/if}
                  {#if statusOf(skill) === 'new'}<span class="badge new">New</span>{/if}
                </span>
                <small>{skill.description || `${skill.registry} · ${skill.path}`}</small>
              </span>
              <code>{skill.path || 'SKILL.md'}</code>
            </label>
          {/each}

          {#each removedSkills() as skill}
            {#if (activeRegistry === 'all' || activeRegistry === skill.registry) && statusFilter === 'updates'}
              <div class="skill-item removed-item">
                <span class="empty-check"></span>
                <span class="skill-copy">
                  <span class="skill-title"><strong>{skill.name}</strong><span class="badge removed">Removed</span></span>
                  <small>{skill.registry}</small>
                </span>
                <code>{skill.path || 'SKILL.md'}</code>
              </div>
            {/if}
          {/each}
        {:else}
          <div class="empty-state">No skills match this view.</div>
        {/if}
      </div>
    </main>

    <aside class="export-panel">
      <div class="panel-label">Export</div>
      <h2>Pack summary</h2>
      <p>A portable archive generated from the selected skills.</p>

      <div class="summary-card">
        <div><span>Selected</span><strong>{selected.length} skills</strong></div>
        <div><span>Sources</span><strong>{selectedSourceCount()} registries</strong></div>
        <div><span>Changes</span><strong>{updateCount()}</strong></div>
      </div>

      <fieldset class="packaging">
        <legend>Packaging</legend>
        <label class:active={exportMode === 'pack'}>
          <input type="radio" name="export-mode" value="pack" bind:group={exportMode} />
          <span><strong>One pack</strong><small>All selected skill folders inside one ZIP.</small></span>
        </label>
        <label class:active={exportMode === 'individual'}>
          <input type="radio" name="export-mode" value="individual" bind:group={exportMode} />
          <span><strong>Per-skill ZIPs</strong><small>ChatGPT-ready ZIPs inside one outer archive.</small></span>
        </label>
      </fieldset>

      <button class="export-button" type="button" onclick={() => void exportSelected()} disabled={selected.length === 0 || exporting} aria-busy={exporting}>
        {exportMode === 'pack' ? 'Export skillpack.zip' : 'Export individual ZIPs'}
      </button>

      <p class="panel-hint">
        Selection is session-only. Registries and the last-export snapshot persist locally.
      </p>
    </aside>
  </div>
</div>
