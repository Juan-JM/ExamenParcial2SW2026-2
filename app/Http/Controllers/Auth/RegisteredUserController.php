<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\CollaborationInvitation;
use App\Models\User;
use App\Notifications\DiagramCollaborationInvite;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules;
use Illuminate\View\View;

class RegisteredUserController extends Controller
{
    /**
     * Display the registration view.
     */
    public function create(Request $request): View
    {
        $invitedEmail = null;

        if ($token = $request->query('invite_token')) {
            $invitedEmail = CollaborationInvitation::where('token', $token)
                ->where('status', 'pending')
                ->value('invitee_email');
        }

        return view('auth.register', ['invitedEmail' => $invitedEmail]);
    }

    /**
     * Handle an incoming registration request.
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:'.User::class],
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
        ]);

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
        ]);

        event(new Registered($user));

        // Vincular invitaciones a colaborar que llegaron a este email antes de
        // que el usuario existiera, y notificarlas ahora que sí puede recibirlas.
        CollaborationInvitation::where('invitee_email', $user->email)
            ->whereNull('invitee_user_id')
            ->where('status', 'pending')
            ->get()
            ->each(function (CollaborationInvitation $invitation) use ($user) {
                $invitation->update(['invitee_user_id' => $user->id]);
                $user->notify(new DiagramCollaborationInvite($invitation));
            });

        Auth::login($user);

        return redirect()->intended(route('dashboard', absolute: false));
    }
}
