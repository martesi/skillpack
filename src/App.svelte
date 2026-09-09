<script lang="ts">
  let registries = $state(['martesi/arca'])
  let registry = $state('')

  function addRegistry() {
    const value = registry.trim()
    if (!value || registries.includes(value)) return

    registries = [...registries, value]
    registry = ''
  }
</script>

<main class="container">
  <header>
    <h1>Skillpack</h1>
    <p>Collect skills from registries and export one ChatGPT-ready ZIP.</p>
  </header>

  <form onsubmit={(event) => { event.preventDefault(); addRegistry() }}>
    <fieldset>
      <input
        aria-label="Registry"
        placeholder="owner/repo"
        bind:value={registry}
      />
      <button type="submit">Add registry</button>
    </fieldset>
  </form>

  <section aria-labelledby="registries-title">
    <h2 id="registries-title">Registries</h2>
    <ul>
      {#each registries as item}
        <li>{item}</li>
      {/each}
    </ul>
  </section>
</main>
