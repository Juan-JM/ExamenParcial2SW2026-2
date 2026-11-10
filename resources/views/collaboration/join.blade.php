<x-guest-layout>
    <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Invitación a colaborar</h2>
        <p class="text-sm text-gray-600 mt-2">
            Te invitaron a la sesión colaborativa de
            <strong>&laquo;{{ $session->diagram->title }}&raquo;</strong>,
            de {{ $session->owner->name }}.
        </p>
    </div>

    @auth
        @if(isset($token))
            <div class="modal-callout" style="margin-bottom: 16px;">
                <span>No se pudo unir automáticamente a la sesión. El enlace puede haber expirado.</span>
            </div>
        @else
            <div class="modal-callout" style="margin-bottom: 16px;">
                <span>Este enlace no incluye el token de invitación completo. Pide al dueño del diagrama el enlace completo para unirte.</span>
            </div>
        @endif
        <a href="{{ route('diagrams.index') }}" class="btn btn-primary btn-block">Ir a mis diagramas</a>
    @else
        <div class="flex flex-col gap-3">
            <a href="{{ route('login') }}" class="btn btn-primary btn-block">Iniciar sesión para unirme</a>
            <a href="{{ route('register') }}" class="btn btn-secondary btn-block">Crear cuenta para unirme</a>
        </div>
    @endauth
</x-guest-layout>
