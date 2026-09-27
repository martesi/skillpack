<script lang="ts">
export interface DropdownOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: DropdownOption[]
  ariaLabel: string
  size?: 'compact' | 'large'
  onValueChange: (value: string) => void
}

let {
  value,
  options,
  ariaLabel,
  size = 'compact',
  onValueChange,
}: Props = $props()

function choose(option: DropdownOption, event: MouseEvent) {
  event.preventDefault()
  onValueChange(option.value)
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }
}
</script>

<details class={`dropdown select-dropdown ${size}`}>
  <summary aria-haspopup="menu">{options.find((option) => option.value === value)?.label ?? ''}</summary>
  <ul aria-label={ariaLabel}>
    {#each options as option (option.value)}
      <li>
        <button
          type="button"
          aria-label={option.label}
          aria-pressed={option.value === value}
          onclick={(event) => choose(option, event)}
        >
          {option.label}
        </button>
      </li>
    {/each}
  </ul>
</details>
