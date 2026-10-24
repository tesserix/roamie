# SeamlessM4T CPU service

Internal trial deployment of `facebook/seamless-m4t-v2-large`, pinned to
`5f8cc790b19fc3f67a61c105133b20b34e3dcb76`. The model uses CC-BY-NC-4.0;
this trial does not establish permission for commercial use.

`POST /v1/translate` accepts exactly one input:

```json
{"text":"Hello","source_language":"eng","target_language":"fra","generate_speech":false}
```

```json
{"audio":"<base64 WAV>","target_language":"eng","generate_speech":false}
```

Audio input must be mono PCM16 WAV at 16 kHz, at most 30 seconds. Text is limited
to 1,000 characters. Language identifiers are the model's three-letter codes
(e.g. `eng`, `hin`, `ory`), not ISO two-letter codes. `source_language` is required
for text; speech uses the model's speech encoder without a source-language hint.
Response fields are `text`, `target_language`, `audio` (nullable base64 PCM16 WAV),
and `sample_rate` (nullable). Speech generation is optional and language-limited;
Odia text is supported, Odia speech output is not.

One request runs at a time. Concurrent requests receive 429 with Retry-After: 5;
there is no queue and no automatic retry. An inference failure returns 503.
Invalid inputs return 422, bodies above 1.4 MB return 413. /healthz reports the
HTTP process; /readyz reports model availability. Startup completes only after
loading the pinned model; Kubernetes permits 30 minutes for a cold download.

No public route or application credential is introduced. GKE's ambient mesh
requires mTLS and the `roamie-api` service-account identity on port 8080. Raw
port-forward access bypasses that mesh boundary and requires Kubernetes RBAC.
The existing talk endpoints are not switched to this service by this rollout.

## Verification

Run from this directory (does not download or run model weights):

```sh
uv sync --frozen
uv run pytest tests -q
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv build
```

The image installs the `model` extra, using Linux CPU PyTorch wheels. CI builds
linux/amd64, imports the actual packaged model libraries, scans the image, and
publishes the tested image to GHCR and the existing GAR mirror. `deploy-<sha7>`
is the Kargo discovery tag. CI does not validate real inference or model memory
fit; those checks must run on GKE, not on the developer's Mac.

## Rollout and benchmark

Companion changes are in the `k8s-seamless-model` and `kargo-seamless-model`
worktrees beside the Roamie repository. Terraform owns the node pool; Argo owns
the workload; the existing Kargo project gains an independent `models-prod`
stage and `models` warehouse. No new CUD is needed.

1. Publish the reviewed service changes and wait for image CI to pass.
2. Review/apply the `04-gke` plan through the existing Atlantis process. The
   locally reviewed plan creates only `google_container_node_pool.models`.
3. Publish the Helm/Argo and Kargo definitions. The Argo workload starts disabled.
4. Promote the scanned image freight manually to `kargo-roamie:models-prod`.
   Kargo supplies repository, tag, digest and enabled=true to Argo. No automatic
   promotion policy covers this stage during the trial.
5. Verify one ready node and one ready pod, the pinned image digest, cold-start
   duration, cache reuse after restart, and absence of OOMs. Exercise both text
   and speech input, and speech output for a supported language.
6. Benchmark 5-, 15- and 30-second WAVs, including Odia input, with repeated warm
   requests. Record p50/p95 latency, real-time factor, CPU, peak working-set RAM,
   translation quality, and a concurrent call returning 429. Test that a caller
   with another mesh identity cannot invoke the service. Only then decide
   whether CPU inference is adequate for the interactive product.

For an operator smoke test after rollout:

```sh
kubectl --context gke_tesseracthub-480811_asia-south1_tesseract-prod-in-gke \
  -n roamie port-forward svc/roamie-seamless 18080:8080
curl --fail-with-body --max-time 300 http://127.0.0.1:18080/v1/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello","source_language":"eng","target_language":"fra"}'
```

For later releases, rollback is a manual Kargo promotion of the previous known
healthy image freight. The initial trial has no prior healthy image: disabling
it requires a reviewed GitOps change and explicit approval for scale-to-zero.
The cache PVC has Prune=false and Retain storage; preserve it on rollback.
