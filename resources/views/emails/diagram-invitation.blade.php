<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>Invitación a colaborar</title>
</head>
<body style="margin:0; padding:32px 16px; background:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
        <tr>
            <td style="padding:28px 28px 8px;">
                <p style="margin:0 0 4px; font-size:12px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:#94a3b8;">UML Designer</p>
                <h1 style="margin:0 0 16px; font-size:20px; color:#0f172a;">{{ $invitation->inviter->name }} te invitó a colaborar</h1>
                <p style="margin:0 0 20px; font-size:14px; line-height:1.6; color:#475569;">
                    Te invitaron como <strong>{{ $invitation->role === 'editor' ? 'editor' : 'observador' }}</strong>
                    en el diagrama UML <strong>&laquo;{{ $invitation->diagram->title }}&raquo;</strong>.
                    Para unirte, primero necesitas crear una cuenta con este mismo correo.
                </p>
                <a href="{{ $registerUrl }}" style="display:inline-block; padding:10px 20px; background:#18181b; color:#ffffff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:500;">
                    Crear cuenta y unirme
                </a>
            </td>
        </tr>
        <tr>
            <td style="padding:20px 28px; border-top:1px solid #f1f5f9;">
                <p style="margin:0; font-size:12px; color:#94a3b8;">
                    Si no esperabas esta invitación, puedes ignorar este correo.
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
