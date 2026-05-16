/**
 * POST /api/tts
 *
 * Server-side proxy for ElevenLabs TTS. Keeps the API key off the client
 * bundle, adds proper error handling, and returns diagnostic headers so
 * the frontend knows exactly why voice failed.
 *
 * Request body:
 *   { text: string, voiceId?: string }
 *
 * Success: audio/mpeg stream  (pass-through from ElevenLabs)
 * Failure: JSON { error, code }  with appropriate HTTP status
 *   code values: "no_key" | "quota_exceeded" | "invalid_key" | "voice_error" | "disabled"
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

const VOICE_ID_DEFAULT = 'CwhRBWXzGAHq8TQ4Fs17';
const MODEL_ID         = 'eleven_multilingual_v2';
const VOICE_SETTINGS   = {
  stability:        0.45,
  similarity_boost: 0.85,
  style:            0.6,
  use_speaker_boost: true,
};

export async function POST(req: NextRequest) {
  // Auth required — voice is per-user
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.startsWith('YOUR_')) {
    console.warn('[TTS] ELEVENLABS_API_KEY not set — voice disabled');
    return NextResponse.json(
      { error: 'Voice is not configured on this server. Add ELEVENLABS_API_KEY to env vars.', code: 'no_key' },
      { status: 503 }
    );
  }

  let body: { text?: string; voiceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'bad_request' }, { status: 400 });
  }

  const rawText = typeof body.text === 'string' ? body.text.trim() : '';
  if (!rawText) {
    return NextResponse.json({ error: 'text is required', code: 'bad_request' }, { status: 400 });
  }

  // Strip markdown, limit to 500 chars (ElevenLabs free tier limit)
  const clean = rawText
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[*_`#]/g, '')
    .substring(0, 500);

  const voiceId = (typeof body.voiceId === 'string' && body.voiceId.trim())
    ? body.voiceId.trim()
    : VOICE_ID_DEFAULT;

  console.info('[SOLARDOG VOICE] tts start', { chars: clean.length, voiceId });

  try {
    const xiRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text:           clean,
          model_id:       MODEL_ID,
          voice_settings: VOICE_SETTINGS,
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!xiRes.ok) {
      let errBody: Record<string, unknown> = {};
      try { errBody = await xiRes.json(); } catch { /* ignore */ }

      const detail = (errBody?.detail as any) ?? {};
      const status = detail?.status ?? '';
      const msg    = detail?.message ?? '';

      console.error('[TTS] ElevenLabs error', xiRes.status, status, msg);

      if (xiRes.status === 401) {
        return NextResponse.json(
          { error: 'ElevenLabs API key is invalid.', code: 'invalid_key' },
          { status: 503 }
        );
      }
      if (status === 'quota_exceeded' || xiRes.status === 429) {
        return NextResponse.json(
          {
            error: 'ElevenLabs account has no credits remaining. Add credits at elevenlabs.io to restore voice.',
            code:  'quota_exceeded',
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Voice API error: ${msg || xiRes.statusText}`, code: 'voice_error' },
        { status: 503 }
      );
    }

    // Stream audio back to browser
    const audioBuffer = await xiRes.arrayBuffer();
    console.info('[SOLARDOG VOICE] tts complete', { bytes: audioBuffer.byteLength });

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type':  'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Voice-Id':    voiceId,
      },
    });

  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error('[TTS] fetch error:', msg);
    if (msg.includes('timeout') || msg.includes('abort')) {
      return NextResponse.json(
        { error: 'Voice request timed out.', code: 'timeout' },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: 'Voice service unavailable.', code: 'voice_error' },
      { status: 503 }
    );
  }
}