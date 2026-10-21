# Conversation playback when a phone has no matching voice

Keep the recent six turns and last detected partner language on the device and
send them with each turn. The API remains stateless across accounts; no transcript
store, session service or database migration is introduced. A cleared conversation
must discard its remembered partner language, and manual language changes must discard
old reference context. English replies target the last detected Odia language.

Use a matching device voice first. A missing voice must not silently select the
phone's English voice for Odia. Generate WAV audio with Gemini 3.8 Flash TTS through
Roamie's private gateway when no matching voice exists. A live synthetic Odia
thank-you returned WAV audio through Vertex global on 12 October 2026. No cloned
voice or new provider credential is required. Local debug builds retain the
existing Vertex credential path; production always uses gateway Workload Identity.

The existing forecast of 2 model requests/second would yield at most 2 additional
speech requests/second if every device lacks a voice. Keep the existing aggregate
gateway limit and bound speech to 1,000 characters, 45 seconds and 2 MiB decoded
audio. Returned audio is ephemeral: no server storage, and the phone deletes its
cache file after completion/cancellation. Translation remains usable on a speech
failure; automatic listening pauses with a visible error. Stop, background and
navigation cancel speech and discard any late synthesis result. Quiet mode never
requests generated audio. Actual p99 latency and incremental TTS cost have not
been measured; the 99.9% API target is unchanged and not an achieved guarantee.

The existing verified-customer middleware authorizes `/v1/talk/speech`. The gateway
independently validates the delegated customer and API workload, uses a fixed TTS
model/backend, strips identity headers before egress and records only model/token/
service metadata. The endpoint accepts text and a validated language, not a model,
voice, provider URL or customer identity. No retries occur at the application.
Provider privacy and per-user quota gates from production readiness still apply.

Native-only speech was rejected because translation language coverage exceeds
installed device voices. A second speech service or credential store was rejected
because the current API, gateway and Vertex identity already serve this feature.
Roll out Registry route/backend/policy and the application together, retaining
previous image/desired-state revisions. The mobile change needs no native module
or schema migration; audio and file-system modules are already installed. Production
activation still requires the pending gateway rollout approval.


`You: Auto` starts with the profile's preferred language and uses the known pair,
recent conversation and expected alternating turn as hints. A new language in a
clearly responding traveller turn can become the source language; partner turns
can update their language. This is language/context inference, not physical speaker
recognition. Both people speaking the same language or interrupting turn order can
remain ambiguous. JEV reviews fidelity and the proposed role; review/retake results
must not update remembered languages or history or trigger automatic playback.

Choosing a specific `You` language locks the source and persists that preference
in account-scoped device storage. Choosing Auto releases that lock. Clearing drops
recent context, partner and expected turn, cancels pending work and preserves the
explicit source preference. Manual language changes discard old reference context.
Card-number-length runs in JEV evidence are masked before truncation. Transcripts
are never stored on the server or included in gateway telemetry.

The last accepted distinct source/partner pair is saved together in the existing
account-scoped device store. Reopening Translate restores that pair before falling
back to the profile language, without turning Auto into a manual selection.
Explicit selections take precedence; Clear conversation and choosing You: Auto
discard the remembered pair. Review-required, cancelled, and failed turns cannot
replace it. Identical selected languages produce a correction prompt rather than
an echoed utterance presented as a translation. This adds two language codes to
one local storage write, no transcript persistence, API round trip, or migration.

The native speech route exports fixed model identity and provider usage metadata
without audio/text payloads. The existing console ledger stores it under Roamie,
roamie-api and talk/speech. Speech remains explicitly unpriced until a verified
rate card supports its input/output modalities. Captured native gateway exports
are replay-tested through the existing idempotent writer.


Typed input is the authoritative source text. The model cannot rewrite it into a
different script or language: any changed transcript forces review even if JEV
accepts. Current-turn instructions and per-field schema descriptions explicitly
bind both translations to their requested languages/native scripts. A live
Odia/Hindi/French/Hindi sequence reproduced context drift; the typed-text invariant
and clearer translation contract prevent silent acceptance of a rewritten input.
Audio transcripts remain model-derived and require the existing JEV check.

Generative language labels are not authoritative. Live testing found Gemini
2.5 Flash copied a Nepali reply into both Hindi/Nepali outputs while confidently
labelling it Hindi. Shared scripts defeat both a turn-order guess and a
language-specific script guard.

Cloud Translation v3 detects the current exact typed text or current audio
transcript, then translates from that language into the counterpart selected by
the existing pair-routing rules. No language-specific routing rule is used.
`expectedSpeaker`, history and the profile cannot override detection. The
production workload uses ADC and a scoped `roles/cloudtranslate.user` grant;
there is no API key. The service is already enabled in the project. ADC discovery
is lazy and cached, so unavailable credentials cannot prevent unrelated API
routes from starting.

Gemini retains speech transcription, acoustic confidence, voice register and
optional pronunciation guides. A guide is retained only when its associated
translation matches the dedicated service's final text. The lower detection/
transcription confidence, rewritten typed transcripts, unexpected languages and
echoed translations require review. Independent JEV review still runs. An
unavailable or malformed provider fails safely without accepting an echo or
changing memory.

Each dedicated operation has a nine-second total deadline, four seconds per
request, at most one transient retry, and a 64 KiB response limit. Transcription
is bounded at 35 seconds so these operations and review fit inside the 60-second
route deadline. Requests are idempotent; the account-scoped accepted turn cache
and existing client retry remain in place.

Provider preflight covered 35 selectable languages, 70 current utterance
detections and 172 translations. It exposed one low-confidence Indonesian/Malay
ambiguity and two transient network failures. Those observations are retained
in QA evidence rather than treated as passing cases. This architecture prevents
the reported successful same-language echo; it cannot promise perfect detection
for every ambiguous phrase or eliminate upstream outages.

Client regressions cover every ordered distinct pair in the 35-language picker
(1,190 pairs), reopening Translate and replying in the other language. Recording
mode tests cover both alternating turns and repeated turns by the same speaker,
with six distinct payloads and two screen restarts per mode and pattern.
