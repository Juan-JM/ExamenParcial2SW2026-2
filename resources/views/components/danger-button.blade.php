<button {{ $attributes->merge(['type' => 'submit', 'class' => 'btn btn-danger-solid']) }}>
    {{ $slot }}
</button>
