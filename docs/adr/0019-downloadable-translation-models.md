# ADR 0019: Downloadable translation model evaluation

Status: proposed evaluation; no new translation runtime or weights shipped.
Evidence checked against publisher model cards and file metadata on 2026-10-22.
This extends ADR 0013; Apple Translation and Android ML Kit remain the defaults.

## Decision

Benchmark Tencent Hy-MT2 1.8B Q4_K_M as an optional multilingual translation
download for capable phones. Its publisher lists Vietnamese, Thai and Korean,
provides an ungated GGUF, and licenses the model under Apache 2.0. This is a
candidate for evaluation, not a claim that it is the most accurate or fastest
model on Roamie's users' phones. Keep the existing platform packs for small
downloads and lower device requirements.

Whisper Base/Small recognise speech; they do not replace the text translation
engine. The proposed path is Whisper → Hy-MT2 → an installed offline system
voice. Camera OCR remains the native OCR path. Speech recognition, translation,
OCR and read-aloud continue to report separate capabilities.

## Verified candidates

Sizes below are decimal MB/GB for the named weight files, excluding tokenizers,
runtime binaries and working memory. File size is not a RAM requirement.

| Candidate | Published files | License | Assessment |
| --- | --- | --- | --- |
| Tencent Hy-MT2 1.8B Q4_K_M | 1,133,080,448 bytes | Apache 2.0 | Primary quality candidate; benchmark native iOS and Android before admission |
| Hy-MT2 1.8B 2-bit | 600,534,880 bytes | Apache 2.0 | Experimental compact candidate; verify the exact quantization and runtime support |
| Hy-MT2 1.8B 1.25-bit | 461,860,800 bytes | Apache 2.0 | Experimental; publisher requires its STQ kernel; upstream PR 22836 is still open and unmerged at inspection |
| Xenova NLLB-200 distilled 600M ONNX | 894,626,254 bytes for quantized encoder plus merged decoder | CC BY-NC 4.0 | Exclude from the commercial release unless separate commercial rights are obtained; conversion does not remove the original restriction |
| Meta SeamlessM4T v2 large | 9,237,277,708 bytes across the two published safetensor shards | CC BY-NC 4.0 | Exclude from the commercial mobile download; large multitask speech/text model, not a small app component |
| Meta M2M100 418M / Xenova ONNX conversion | 631,984,548 bytes for quantized encoder plus merged decoder | Source model MIT; conversion metadata has no license tag | Secondary candidate for broader coverage; verify redistribution notices, runtime and quality before shipping |
| Google MADLAD400 3B MT Q4 | 1,654,597,280 bytes | Apache 2.0 | Broader-language alternative with a separate encoder/decoder integration and larger download |

Hy-MT2 does not list every Roamie language, including Odia. Its supported-language
list must be explicit; never advertise universal offline coverage. Published
vendor benchmark claims are not independent Roamie phone measurements.

The inspected llama.rn source contains the Hunyuan dense architecture and offers
iOS Metal and Android CPU/OpenCL paths. The npm `latest` tag currently resolves
to `0.13.0-rc.8`, a release candidate. Architecture presence alone does not prove
that the exact model/quantization loads, accelerates or passes Expo SDK 57 / RN
0.86 production builds. The smallest STQ file is not a drop-in standard GGUF.
Do not execute model-repository Python or `trust_remote_code` in the app.

## Acceptance budget and rollout

No new server, endpoint, database or cloud translation traffic is required.
The working set is one active translation request and one loaded MT model per
phone. For the pilot, bound context to 2,048 tokens, including an output budget
of 512; reject inputs that cannot fit after tokenization. A generation that hits
the output limit must be reported as incomplete rather than accepted as a full
translation. Roamie's existing 5,000-character UI limit is not a token budget.

Start evaluation on physical 6 GB and 8 GB iPhones and mid-range Android phones,
with a lower-memory phone included to verify graceful refusal and the native
fallback. Initial acceptance targets for short travel phrases are warm text p95
under 3 seconds, cold text p95 under 8 seconds, and end-of-speech to translated
text p95 under 5 seconds. Target total speech-plus-MT peak process memory below
2 GiB on the 6 GB tier; measure actual OS termination and memory pressure limits.
These are proposed gates, not measured performance or eligibility guarantees.
Keep platform engines as the default if the larger model misses these budgets.

Evaluate English ↔ Vietnamese, English ↔ Thai and English ↔ Korean in both
directions, including prices, dates, names, negation, food allergies and travel
instructions. Use at least 100 reviewed examples per direction and bilingual
review of critical errors. Compare Q4 with the compact variants and the native
engine; evaluate ASR errors separately from text translation errors.

Run actual download → SHA-256 verification → airplane mode with Wi-Fi disabled →
translation → force-quit/relaunch → translation → deletion → re-download tests.
Include download interruption, disk full, missing tokenizer/assets, corrupted
weights, cancellation, language changes, backgrounding, memory warnings and
thermal/battery behavior. Offline-only must make zero translation network
requests; automatic mode retains the existing consent and cloud policy.

Ship a new native binary only after the pinned runtime and exact weights pass
these gates. A text model remains optional; no large automatic download or new
minimum requirement for all users. Rollback disables the optional model choice
and retains the platform engine; users can delete the downloaded weights.
There is no new inference API cost. At the Q4 size, 10,000 first downloads move
about 11.33 TB before retries, so hosting limits and distribution costs must be
checked before a public rollout; no paid hosting change is approved here.

## Download integrity and lifecycle

Use a fixed model catalog with publisher revision, file name, expected byte
length, SHA-256, language list and license notice. Download public model weights
without embedding a Hugging Face token. Keep URLs fixed to the catalog and
validate permitted HTTPS redirect destinations. Text and recordings never go
to Hugging Face. Preserve existing Wi-Fi preference and explicit user action.

Show actual byte progress, verify a temporary file before marking it ready,
retain a valid installation during an update, and check free storage for the
old and incoming files plus headroom. Resume/cancel/retry and removal must be
supported. Serialize deletion with inference and release the native context
before unlinking weights; refresh readiness after deletion. Keep ASR and MT
memory budgets separate and release idle contexts.

Inspected publisher revisions:

- Q4 GGUF: `a0c709d9fac510f2c807aa3af52872340dc37a4a`
- 1.25-bit GGUF: `9df5c824a00a744fb0512a29c640466f4d97dfb0`
- 2-bit GGUF: `b630487d19ab7f336664a15b07c638d0d1071471`
- Hy-MT2 base: `9a341cd1b679d3efd23b46e847b01745a71ed792`

## Sources

- https://huggingface.co/tencent/Hy-MT2-1.8B
- https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/tree/a0c709d9fac510f2c807aa3af52872340dc37a4a
- https://huggingface.co/tencent/Hy-MT2-1.8B-1.25bit-GGUF
- https://huggingface.co/tencent/Hy-MT2-1.8B-2bit-GGUF
- https://github.com/ggml-org/llama.cpp/pull/22836
- https://github.com/mybigday/llama.rn
- https://huggingface.co/Xenova/nllb-200-distilled-600M
- https://huggingface.co/facebook/nllb-200-distilled-600M
- https://huggingface.co/facebook/seamless-m4t-v2-large
- https://huggingface.co/docs/transformers/en/model_doc/seamless_m4t_v2
- https://huggingface.co/facebook/m2m100_418M
- https://huggingface.co/Xenova/m2m100_418M
- https://huggingface.co/google/madlad400-3b-mt
