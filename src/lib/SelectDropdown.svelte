<script lang="ts">
export interface DropdownOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: DropdownOption[]
  ariaLabel: string
  name: string
  onValueChange: (value: string) => void
}

let {
  value,
  options,
  ariaLabel,
  name,
  onValueChange,
}: Props = $props()

function choose(value: string, event: Event) {
  onValueChange(value)
  if (event.currentTarget instanceof HTMLInputElement) {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }
}
</script>

<details class="dropdown">
  <summary>{options.find((option) => option.value === value)?.label ?? ''}</summary>
  <ul aria-label={ariaLabel}>
    {#each options as option (option.value)}
      <li>
        <label>
          <input
            type="radio"
            {name}
            value={option.value}
            checked={option.value === value}
            onchange={(event) => choose(option.value, event)}
          />
          {option.label}
        </label>
      </li>
    {/each}
  </ul>
</details>
