@props(['name', 'size' => 20])

@php
$paths = [
    'plus' => '<path d="M12 5v14M5 12h14"/>',
    'search' => '<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.2-3.2"/>',
    'close' => '<path d="M6 6l12 12M18 6L6 18"/>',
    'home' => '<path d="M4 11.5L12 4l8 7.5" stroke-linejoin="round"/><path d="M6 10v9h12v-9" stroke-linejoin="round"/>',
    'pencil' => '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" stroke-linejoin="round"/>',
    'eye' => '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke-linejoin="round"/><circle cx="12" cy="12" r="3"/>',
    'copy' => '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    'trash' => '<path d="M5 7h14"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M7 7l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" stroke-linejoin="round"/>',
    'lock' => '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    'users' => '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 6-5s6 2 6 5"/><path d="M16 6.5a2.5 2.5 0 010 5"/><path d="M18 14.5c2 .4 3.5 1.8 3.5 4.5"/>',
    'globe' => '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18 14 14 0 010-18z"/>',
    'template' => '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M9 9v11"/>',
    'chart' => '<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/>',
    'chevron-down' => '<path d="M6 9l6 6 6-6"/>',
    'save' => '<path d="M5 5a1 1 0 011-1h9l4 4v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5z" stroke-linejoin="round"/><path d="M8 4v5h6V4"/><path d="M8 14h8"/>',
    'folder' => '<path d="M4 7a1 1 0 011-1h4l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V7z" stroke-linejoin="round"/>',
    'document' => '<path d="M7 3h7l4 4v14H7z" stroke-linejoin="round"/><path d="M14 3v4h4"/>',
    'warning' => '<path d="M12 4l9 16H3L12 4z" stroke-linejoin="round"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    'undo' => '<path d="M9 14L4 9l5-5" stroke-linejoin="round"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
    'redo' => '<path d="M15 14l5-5-5-5" stroke-linejoin="round"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
    'check' => '<path d="M5 12.5l4.5 4.5L19 7"/>',
    'check-circle' => '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
    'x-circle' => '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5l5 5m0-5l-5 5"/>',
    'spinner' => '<path d="M12 3a9 9 0 109 9"/>',
    'zoom-in' => '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.35-4.35"/><path d="M10.5 8v5M8 10.5h5"/>',
    'zoom-out' => '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.35-4.35"/><path d="M8 10.5h5"/>',
    'frame' => '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    'logo' => '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M11 7.5h2M16.5 11v2"/>',
    'code' => '<path d="M9 8l-5 4 5 4"/><path d="M15 8l5 4-5 4"/>',
    'database' => '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
    'send' => '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z" stroke-linejoin="round"/>',
    'mobile' => '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    'bell' => '<path d="M6 9a6 6 0 1112 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9z" stroke-linejoin="round"/><path d="M10 19a2 2 0 004 0"/>',
    'help' => '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.8 2.8 0 015.4.9c0 1.9-2.6 2.1-2.6 3.9" stroke-linejoin="round"/><path d="M12 17.2h.01"/>',
    'arrow-left' => '<path d="M19 12H5" stroke-linejoin="round"/><path d="M11 6l-6 6 6 6" stroke-linejoin="round"/>',
];
$body = $paths[$name] ?? '';
@endphp

<svg {{ $attributes->merge(['class' => 'ui-icon']) }} width="{{ $size }}" height="{{ $size }}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg">
    {!! $body !!}
</svg>
