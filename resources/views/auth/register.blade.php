<x-guest-layout>
    <!-- Título de registro -->
    <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900">¡Únete a nosotros!</h2>
        <p class="text-sm text-gray-600 mt-2">Crea tu cuenta y comienza a diseñar diagramas UML</p>
    </div>

    <form method="POST" action="{{ route('register') }}">
        @csrf

        <!-- Name -->
        <div>
            <x-input-label for="name" :value="__('Nombre Completo')" />
            <x-text-input id="name" class="block mt-1 w-full" type="text" name="name" :value="old('name')" required autofocus autocomplete="name" placeholder="Tu nombre completo" />
            <x-input-error :messages="$errors->get('name')" class="mt-2" />
        </div>

        <!-- Email Address -->
        <div class="mt-4">
            <x-input-label for="email" :value="__('Correo Electrónico')" />
            <x-text-input id="email" class="block mt-1 w-full" type="email" name="email" :value="old('email', $invitedEmail ?? '')" required autocomplete="username" placeholder="tu@email.com" />
            <x-input-error :messages="$errors->get('email')" class="mt-2" />
        </div>

        <!-- Password -->
        <div class="mt-4">
            <x-input-label for="password" :value="__('Contraseña')" />

            <x-text-input id="password" class="block mt-1 w-full"
                            type="password"
                            name="password"
                            required autocomplete="new-password"
                            placeholder="••••••••" />

            <x-input-error :messages="$errors->get('password')" class="mt-2" />
            <p class="text-xs text-gray-500 mt-1">Mínimo 8 caracteres</p>
        </div>

        <!-- Confirm Password -->
        <div class="mt-4">
            <x-input-label for="password_confirmation" :value="__('Confirmar Contraseña')" />

            <x-text-input id="password_confirmation" class="block mt-1 w-full"
                            type="password"
                            name="password_confirmation" required autocomplete="new-password"
                            placeholder="••••••••" />

            <x-input-error :messages="$errors->get('password_confirmation')" class="mt-2" />
        </div>

        <!-- Términos de servicio (opcional) -->
        <div class="mt-4">
            <label class="inline-flex items-start">
                <input type="checkbox" class="rounded border-gray-300 text-zinc-900 shadow-sm focus:ring-zinc-800 mt-0.5" required>
                <span class="ms-2 text-xs text-gray-600">
                    Acepto los términos de servicio y política de privacidad del Diagramador UML Colaborativo
                </span>
            </label>
        </div>

        <div class="flex items-center justify-between mt-6">
            <a class="underline text-sm text-gray-600 hover:text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-800" href="{{ route('login') }}">
                {{ __('¿Ya tienes cuenta?') }}
            </a>

            <x-primary-button class="ms-4">
                {{ __('Crear Cuenta') }}
            </x-primary-button>
        </div>

        <!-- Información adicional -->
        <div class="mt-6 p-3 bg-gray-50 rounded-lg">
            <p class="text-xs text-gray-600 text-center">
                <strong>Acceso completo:</strong> Editor UML, colaboración en tiempo real, generación de código Spring Boot
            </p>
        </div>
    </form>
</x-guest-layout>
