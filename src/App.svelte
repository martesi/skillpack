<script lang="ts">
import { z } from 'zod'
import SelectDropdown from './lib/SelectDropdown.svelte'
import {
  buildIndividualSkillZips,
  buildSkillZip,
  type IndividualSkillSource,
  type SkillSource,
} from './lib/export'
import {
  loadCredentialSettings,
  saveCredentialSettings,
  type CredentialSettings,
} from './lib/credentials'
import {
  discoverRegistry,
  normalizeRegistry,
  refreshRegistrySkills,
  type RegistrySkill,
} from './lib/registry'

const cacheMaxAge = 60 * 60 * 1000
const registriesKey = 'skillpack:registries'
const lastExportKey = 'skillpack:last-export'
const globalCredential = '__global__'
const newCredential = '__new__'

const savedRegistrySchema = z.object({
  url: z.string(),
  credentialId: z.string().nullable().default(null),
})
const savedRegistriesSchema = z.array(z.union([z.string(), savedRegistrySchema]))
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

type SavedRegistry = z.infer<typeof savedRegistrySchema>
type CachedRegistry = z.infer<typeof cachedRegistry>
type ExportSnapshot = z.infer<typeof exportSnapshot>
type ExportMode = 'pack' | 'individual'
type StatusFilter = 'all' | 'updates'

interface Skill extends RegistrySkill {
  registry: string
}

let registry = $state('')
let registries = $state<SavedRegistry[]>(readSavedRegistries())
let credentialSettings = $state<CredentialSettings>({ credentials: [], globalCredentialId: null })
let addCredentialChoice = $state(globalCredential)
let addCredentialName = $state('')
let addCredentialToken = $state('')
let editingRegistry = $state<string | null>(null)
let editRegistryUrl = $state('')
let editRegistryCredential = $state(globalCredential)
let editingCredentialId = $state<string | null>(null)
let credentialName = $state('')
let credentialTokenInput = $state('')
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
  void initialize()
})

async function initialize() {
  try {
    credentialSettings = await loadCredentialSettings()
  } catch (cause) {
    console.error('credentials:load', cause)
    error = 'Could not load saved credentials.'
  }
  await loadSavedRegistries()
}

async function loadSavedRegistries() {
  loading = true
  try {
    const loaded = await Promise.all(registries.map((source) => fetchRegistry(source)))
    skills = loaded.flat()
    pruneSelection()
  } catch (cause) {
    console.error('registry:load-saved', cause)
    error = githubError(cause, 'Could not load the saved registries.')
  } finally {
    loading = false
  }
}

async function addRegistry() {
  const url = registry.trim()
  const name = normalizeRegistry(url)
  error = null

  if (!name) {
    error = 'Registry must be owner/repo or a GitHub repository URL.'
    return
  }
  if (registries.some((source) => registryName(source) === name)) {
    registry = ''
    activeRegistry = name
    return
  }

  loading = true
  try {
    const credentialId = await resolveAddCredential()
    if (credentialId === undefined) return

    const source: SavedRegistry = { url, credentialId }
    const nextSkills = await fetchRegistry(source, true)
    registries = [...registries, source]
    persistRegistries()
    skills = [...skills, ...nextSkills]
    registry = ''
    addCredentialChoice = globalCredential
    addCredentialName = ''
    addCredentialToken = ''
    activeRegistry = name
  } catch (cause) {
    console.error('registry:add', cause)
    error = githubError(cause, 'GitHub could not load this registry.')
  } finally {
    loading = false
  }
}

async function resolveAddCredential() {
  if (addCredentialChoice === globalCredential) return null
  if (addCredentialChoice !== newCredential) return addCredentialChoice

  const name = addCredentialName.trim()
  const token = addCredentialToken.trim()
  if (!name || !token) {
    error = 'Credential name and token are required.'
    return undefined
  }
  return addCredential(name, token)
}

async function saveRegistryEdit() {
  if (!editingRegistry) return
  const url = editRegistryUrl.trim()
  const nextName = normalizeRegistry(url)
  error = null

  if (!nextName) {
    error = 'Registry must be owner/repo or a GitHub repository URL.'
    return
  }
  if (registries.some((source) => registryName(source) === nextName && registryName(source) !== editingRegistry)) {
    error = 'That registry is already saved.'
    return
  }

  const updated: SavedRegistry = {
    url,
    credentialId: editRegistryCredential === globalCredential ? null : editRegistryCredential,
  }

  loading = true
  try {
    const nextSkills = await fetchRegistry(updated, true)
    const previousName = editingRegistry
    registries = registries.map((source) => registryName(source) === previousName ? updated : source)
    persistRegistries()
    if (previousName !== nextName) localStorage.removeItem(cacheKey(previousName))
    skills = [...skills.filter((skill) => skill.registry !== previousName), ...nextSkills]
    activeRegistry = nextName
    editingRegistry = null
    pruneSelection()
  } catch (cause) {
    console.error('registry:edit', cause)
    error = githubError(cause, 'Could not update this registry.')
  } finally {
    loading = false
  }
}

function startRegistryEdit(source: SavedRegistry) {
  editingRegistry = registryName(source)
  editRegistryUrl = source.url
  editRegistryCredential = source.credentialId ?? globalCredential
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
    error = githubError(cause, 'Could not check registry updates.')
  } finally {
    refreshing = false
  }
}

async function fetchRegistry(source: SavedRegistry, force = false): Promise<Skill[]> {
  const name = registryName(source)
  const cached = readCache(name)
  if (!force && cached && cacheReady(cached) && Date.now() - cached.savedAt < cacheMaxAge) {
    return withRegistry(name, normalizeCachedSkills(cached))
  }

  const discovered = await discoverRegistry(name, credentialToken(source))
  writeCache(name, { savedAt: Date.now(), ...discovered })
  return withRegistry(name, discovered.skills)
}

async function refreshRegistry(source: SavedRegistry): Promise<Skill[]> {
  const name = registryName(source)
  const cached = readCache(name)
  if (!cached || !cacheReady(cached) || !cached.branch) return fetchRegistry(source, true)

  const previous = normalizeCachedSkills(cached)
  try {
    const nextSkills = await refreshRegistrySkills(name, cached.branch, previous, credentialToken(source))
    writeCache(name, { ...cached, skills: nextSkills })
    return withRegistry(name, nextSkills)
  } catch (cause) {
    console.warn('registry:refresh-fallback', { registry: name, cause })
    return fetchRegistry(source, true)
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
        : await buildIndividualSkillZips(selectedIndividualSources())
    downloadZip(contents, exportMode === 'pack' ? 'skillpack.zip' : 'skillpack-individual.zip')
    saveExportSnapshot()
  } catch (cause) {
    console.error('export:zip', cause)
    error = exportError(cause)
  } finally {
    exporting = false
  }
}

async function addCredential(name: string, token: string) {
  const id = crypto.randomUUID()
  await persistCredentialSettings({
    ...credentialSettings,
    credentials: [...credentialSettings.credentials, { id, name, token }],
  })
  return id
}

async function saveManagedCredential() {
  const name = credentialName.trim()
  const token = credentialTokenInput.trim()
  if (!name) return

  if (!editingCredentialId && !token) {
    error = 'Credential token is required.'
    return
  }

  const existing = credentialSettings.credentials.find((credential) => credential.id === editingCredentialId)
  const next = existing
    ? credentialSettings.credentials.map((credential) =>
        credential.id === existing.id
          ? { ...credential, name, token: token || credential.token }
          : credential,
      )
    : [...credentialSettings.credentials, { id: crypto.randomUUID(), name, token }]

  await persistCredentialSettings({ ...credentialSettings, credentials: next })
  editingCredentialId = null
  credentialName = ''
  credentialTokenInput = ''
}

function startCredentialEdit(id: string) {
  const credential = credentialSettings.credentials.find((item) => item.id === id)
  if (!credential) return
  editingCredentialId = id
  credentialName = credential.name
  credentialTokenInput = ''
}

async function removeCredential(id: string) {
  const nextSettings = {
    credentials: credentialSettings.credentials.filter((credential) => credential.id !== id),
    globalCredentialId: credentialSettings.globalCredentialId === id ? null : credentialSettings.globalCredentialId,
  }
  await persistCredentialSettings(nextSettings)
  registries = registries.map((source) =>
    source.credentialId === id ? { ...source, credentialId: null } : source,
  )
  persistRegistries()
}

async function setGlobalCredential(id: string) {
  await persistCredentialSettings({
    ...credentialSettings,
    globalCredentialId: id || null,
  })
}

async function persistCredentialSettings(settings: CredentialSettings) {
  error = null
  try {
    await saveCredentialSettings(settings)
    credentialSettings = settings
  } catch (cause) {
    console.error('credentials:save', cause)
    error = 'Could not save credentials.'
    throw cause
  }
}

function credentialToken(source: SavedRegistry) {
  const id = source.credentialId ?? credentialSettings.globalCredentialId
  return credentialSettings.credentials.find((credential) => credential.id === id)?.token
}

function credentialLabel(source: SavedRegistry) {
  if (!source.credentialId) {
    const global = credentialSettings.credentials.find(
      (credential) => credential.id === credentialSettings.globalCredentialId,
    )
    return global ? `Global: ${global.name}` : 'No credential'
  }
  return credentialSettings.credentials.find((credential) => credential.id === source.credentialId)?.name ?? 'Missing credential'
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

status filter helperfunction removedSkills() {
  if (!lastExport) return []
  const current = new Set(skills.map(skillId))
  const saved = new Set(registries.map(registryName))
  return Object.entries(lastExport.skills)
    .filter(([id, skill]) => saved.has(skill.registry) && !current.has(id))
    .map(([, skill]) => skill)
}

function updateCount() {
  return skills.filter(isUpdate).length + removedSkills().length
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

function selectedSourceCount() {
  return new Set(selectedSkills().map((skill) => skill.registry)).size
}

function selectedSources(): SkillSource[] {
  return registries
    .map((source) => {
      const name = registryName(source)
      return {
        registry: name,
        token: credentialToken(source),
        paths: skills
          .filter((skill) => skill.registry === name && selected.includes(skillId(skill)))
          .map((skill) => skill.path),
      }
    })
    .filter(({ paths }) => paths.length > 0)
}

function selectedIndividualSources(): IndividualSkillSource[] {
  return selectedSkills().map((skill) => {
    const source = registries.find((candidate) => registryName(candidate) === skill.registry)
    return {
      registry: skill.registry,
      name: skill.name,
      path: skill.path,
      token: source ? credentialToken(source) : undefined,
    }
  })
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
  return githubError(cause, 'Could not export the selected skills.')
}

function githubError(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message.includes('rate limit')) {
    return 'GitHub API rate limit reached. Select a global credential or a registry credential.'
  }
  return fallback
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

function readSavedRegistries(): SavedRegistry[] {
  const raw = localStorage.getItem(registriesKey)
  if (!raw) return []
  try {
    const parsed = savedRegistriesSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    return parsed.data
      .map((source) => typeof source === 'string' ? { url: source, credentialId: null } : source)
      .filter((source) => normalizeRegistry(source.url))
  } catch {
    return []
  }
}

function persistRegistries() {
  localStorage.setItem(registriesKey, JSON.stringify(registries))
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

function registryName(source: SavedRegistry) {
  return normalizeRegistry(source.url) ?? source.url
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
          {@const name = registryName(source)}
          <div class="registry-row" class:active={activeRegistry === name}>
            <button class:active={activeRegistry === name} type="button" onclick={() => activeRegistry = name} aria-pressed={activeRegistry === name}>
              <span class="status-dot"></span>
              <span><strong>{name}</strong><small>{registryCount(name)} skills · {credentialLabel(source)}</small></span>
            </button>
            <button class="row-action icon-action" type="button" aria-label={`Edit ${name}`} title={`Edit ${name}`} onclick={() => startRegistryEdit(source)}>⋯</button>
          </div>
        {/each}
      </nav>

      {#if editingRegistry}
        <form class="settings-form" aria-label="Edit registry" onsubmit={(event) => { event.preventDefault(); void saveRegistryEdit() }}>
          <input aria-label="Registry URL" bind:value={editRegistryUrl} autocomplete="off" />
          <SelectDropdown
            ariaLabel="Registry edit credential"
            value={editRegistryCredential}
            options={[
              { value: globalCredential, label: 'Use global credential' },
              ...credentialSettings.credentials.map((credential) => ({ value: credential.id, label: credential.name })),
            ]}
            onValueChange={(value) => editRegistryCredential = value}
          />
          <div class="form-actions">
            <button type="submit">Save</button>
            <button type="button" class="secondary" onclick={() => editingRegistry = null}>Cancel</button>
          </div>
        </form>
      {/if}

      <form class="settings-form" aria-label="Add registry" onsubmit={(event) => { event.preventDefault(); void addRegistry() }}>
        <input aria-label="Registry" placeholder="owner/repo" bind:value={registry} autocomplete="off" />
        <SelectDropdown
          ariaLabel="Registry credential"
          value={addCredentialChoice}
          options={[
            { value: globalCredential, label: 'Use global credential' },
            ...credentialSettings.credentials.map((credential) => ({ value: credential.id, label: credential.name })),
            { value: newCredential, label: 'Add credential…' },
          ]}
          onValueChange={(value) => addCredentialChoice = value}
        />
        {#if addCredentialChoice === newCredential}
          <input aria-label="New credential name" placeholder="Credential name" bind:value={addCredentialName} autocomplete="off" />
          <input aria-label="New credential token" type="password" placeholder="Fine-grained token" bind:value={addCredentialToken} autocomplete="off" />
        {/if}
        <button type="submit" disabled={loading} aria-busy={loading}>Add</button>
      </form>

      <details class="credentials-manager">
        <summary>Credentials <span>{credentialSettings.credentials.length}</span></summary>
        <label class="field-label">
          Global API credential
          <SelectDropdown
            ariaLabel="Global credential"
            value={credentialSettings.globalCredentialId ?? ''}
            options={[
              { value: '', label: 'None' },
              ...credentialSettings.credentials.map((credential) => ({ value: credential.id, label: credential.name })),
            ]}
            onValueChange={(value) => void setGlobalCredential(value)}
          />
        </label>

        <div class="credential-list">
          {#each credentialSettings.credentials as credential}
            <div class="credential-row">
              <span>{credential.name}</span>
              <div class="row-actions">
                <button type="button" class="row-action" onclick={() => startCredentialEdit(credential.id)}>Edit</button>
                <button type="button" class="row-action" onclick={() => void removeCredential(credential.id)}>Remove</button>
              </div>
            </div>
          {/each}
        </div>

        <form class="settings-form" aria-label="Manage credential" onsubmit={(event) => { event.preventDefault(); void saveManagedCredential() }}>
          <input aria-label="Credential name" placeholder="Credential name" bind:value={credentialName} autocomplete="off" />
          <input
            aria-label="Credential token"
            type="password"
            placeholder={editingCredentialId ? 'Leave blank to keep token' : 'Fine-grained token'}
            bind:value={credentialTokenInput}
            autocomplete="off"
          />
          <div class="form-actions">
            <button type="submit">{editingCredentialId ? 'Update' : 'Add credential'}</button>
            {#if editingCredentialId}
              <button type="button" class="secondary" onclick={() => { editingCredentialId = null; credentialName = ''; credentialTokenInput = '' }}>Cancel</button>
            {/if}
          </div>
        </form>
      </details>
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
          <SelectDropdown
            ariaLabel="Filter skills"
            size="large"
            value={statusFilter}
            options={[
              { value: 'all', label: 'All skills' },
              { value: 'updates', label: 'Updates only' },
            ]}
            onValueChange={(value) => {
              if (value === 'all' || value === 'updates') statusFilter = value
            }}
          />
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
        Export
      </button>

      <p class="panel-hint">
        Registry URLs, credential choices, encrypted credentials, and the last-export snapshot persist locally.
      </p>
    </aside>
  </div>
</div>
