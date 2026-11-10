@props(['disabled' => false])

<input @disabled($disabled) {{ $attributes->merge(['class' => 'border-gray-300 focus:border-zinc-800 focus:ring-zinc-800 rounded-md shadow-sm']) }}>
