@props(['type' => 'success', 'message'])

<div
    class="toast toast-{{ $type }}"
    x-data="{ show: true }"
    x-show="show"
    x-init="setTimeout(() => show = false, {{ $type === 'error' ? 6000 : 4500 }})"
    x-transition:enter="transition ease-out duration-300"
    x-transition:enter-start="translate-y-2 opacity-0"
    x-transition:enter-end="translate-y-0 opacity-100"
    x-transition:leave="transition ease-in duration-200"
    x-transition:leave-start="translate-y-0 opacity-100"
    x-transition:leave-end="translate-y-2 opacity-0"
>
    <x-icon :name="$type === 'error' ? 'x-circle' : 'check-circle'" :size="18" class="toast-icon" />
    <span>{{ $message }}</span>
    <button type="button" class="toast-close" @click="show = false" aria-label="Cerrar">
        <x-icon name="close" :size="14" />
    </button>
</div>
