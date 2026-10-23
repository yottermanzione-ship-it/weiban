# Voice: remaining work (single list)

Status: TTS (MiMo system voice) and browser-recording ASR duration fix are LIVE (026ddfa). Composite call model groundwork committed (d017aa8). Everything below is NOT done.

## A. Composite voice-call model
- Store pipeline setting (asr/text/tts keys) in model_access.settings as voice_call_pipeline.
- Add catalog entry voice/cascade-call (display "Voice Cascade"), tag pipeline:voice_call, no upstream model.
- Runtime: when voice_call resolves to composite, use the three components instead of one upstream.
- Display multiplier from minute blend (ASR 1.08 + ~68 TTS chars + text tokens; old data: 202s/session, 22 turns, 68 char/min).

## B. Speech recognition (3 entries, English names/vendors)
- SenseVoice (siliconflow), TeleSpeech (siliconflow): already supported protocol.
- MiMo ASR: implement old protocol (chat/completions + input_audio data URL + asr_options). Currently rejected.

## C. Speech synthesis (4 entries)
- MiMo TTS (live), MiMo voice clone (per-request reference audio; needs sample storage + consent record).
- Qwen 3.1 TTS Flash and Qwen TTS Pro (3.1 has no Pro; Pro is 3.0 Plus).
- Import 753 character_voice_bindings / 56 user_character_voice_styles from old SQLite.

## D. Bailian + private workspace migration
- CMS export/import of public dashscope provider and enabled private workspace realtime provider (8d1b5e3b).
- Do NOT use the other private workspace (156).

## E. Billing/points
- 1 point = 0.01 CNY; sell = cost x 1.3.
- Search 0.65 pts/call for deepseek/deepseek-search; select as internal web_search.
- JEV: use jev/latest, token price, set internal planner.
- Multipliers: every user-selectable model shows a multiplier (auto from base openai/gpt-6.1-sol unless fixed).

## F. Realtime / Omni
- qwen-audio-3.0-realtime-plus over WebSocket (currently enabled endpoint), plus Qwen Omni 3.1: new transport, barge-in, per-token billing. Not started.

## G. Old-server data migration plan (characters + users)
- Deferred by owner: agree detailed mapping first. No writes yet.

## Verification still missing
- Real Chrome webm recording end-to-end on production.
- Bailian synthesis + browser playback on production.
- Realtime call smoke.
