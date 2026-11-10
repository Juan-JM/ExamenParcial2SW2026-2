<?php

namespace App\Http\Controllers;

use App\Jobs\AnswerHelpRequest;
use App\Models\HelpRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Asistente de ayuda personal: pregunta + lo que la persona tiene en pantalla. */
class HelpController extends Controller
{
    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => ['required', 'string', 'max:500'],
            'page' => ['required', 'array'],
            'page.screen' => ['nullable', 'string', 'max:40'],
            'page.title' => ['nullable', 'string', 'max:200'],
            'page.path' => ['nullable', 'string', 'max:300'],
            'page.headings' => ['nullable', 'array', 'max:10'],
            'page.headings.*' => ['string', 'max:120'],
            'page.notices' => ['nullable', 'array', 'max:5'],
            'page.notices.*' => ['string', 'max:200'],
            'page.modal' => ['nullable', 'string', 'max:300'],
            'page.editor' => ['nullable', 'array'],
            'page.editor.*' => ['nullable'],
            'page.targets' => ['nullable', 'array', 'max:100'],
            'page.targets.*.key' => ['required', 'string', 'max:80'],
            'page.targets.*.label' => ['required', 'string', 'max:120'],
            'page.targets.*.kind' => ['nullable', 'string', 'max:40'],
            'history' => ['nullable', 'array', 'max:6'],
            'history.*.q' => ['required', 'string', 'max:500'],
            'history.*.a' => ['nullable', 'string', 'max:1500'],
        ]);

        $user = $request->user();

        $help = HelpRequest::create([
            'user_id' => $user->id,
            'user_name' => $user->name,
            'question' => $validated['question'],
            'page' => $validated['page'],
            'history' => $validated['history'] ?? [],
            'status' => 'pending',
        ]);

        AnswerHelpRequest::dispatch($help->id);

        return response()->json(['help' => $help->toClientArray()], 202);
    }

    /** Respaldo si la respuesta en vivo no llegó (por ejemplo, con Reverb caído). */
    public function show(Request $request, HelpRequest $help): JsonResponse
    {
        abort_unless($help->user_id === $request->user()->id, 404);

        return response()->json(['help' => $help->toClientArray()]);
    }
}
