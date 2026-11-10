<div class="relative" wire:poll.5s>
    <button id="notification-bell-btn" wire:click="toggle" @click.outside="$wire.open = false" class="icon-btn relative" aria-label="Notificaciones">
        <x-icon name="bell" :size="18" />
        @if($this->notifications->count() > 0)
            <span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style="background: var(--uml-error);"></span>
        @endif
    </button>

    @if($open)
        <div class="absolute top-full right-0 mt-2 w-80 menu z-50" style="padding: 0;">
            <div class="menu-section" style="padding-top: 12px;">Notificaciones</div>

            @forelse($this->notifications as $notification)
                <div style="padding: 10px 14px; border-top: 1px solid var(--uml-gray-100);">
                    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--uml-gray-500); text-transform: uppercase; letter-spacing: 0.03em;">
                        Nueva invitación a colaborar
                    </p>
                    <p style="margin: 0 0 8px; font-size: 13px; color: var(--uml-gray-800);">
                        <strong>{{ $notification->data['inviter_name'] ?? 'Alguien' }}</strong>
                        te invitó a colaborar en
                        <strong>&laquo;{{ $notification->data['diagram_title'] ?? 'un diagrama' }}&raquo;</strong>
                        como {{ ($notification->data['role'] ?? 'editor') === 'editor' ? 'editor' : 'observador' }}.
                    </p>
                    <div class="flex gap-2">
                        <button wire:click="accept('{{ $notification->id }}')" class="btn btn-primary btn-sm">Aceptar</button>
                        <button wire:click="reject('{{ $notification->id }}')" class="btn btn-secondary btn-sm">Rechazar</button>
                    </div>
                </div>
            @empty
                <p style="padding: 14px; margin: 0; font-size: 13px; color: var(--uml-gray-500);">No tenés notificaciones nuevas.</p>
            @endforelse

            <a href="{{ route('diagrams.index') }}#compartidos" class="menu-item" style="border-top: 1px solid var(--uml-gray-100); justify-content: center; color: var(--uml-gray-500);">
                Ver diagramas compartidos conmigo
            </a>
        </div>
    @endif
</div>
