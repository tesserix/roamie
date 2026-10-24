# 0019: Isolated SeamlessM4T CPU trial

Status: implemented locally; deployment and benchmark pending.

The six running e2-standard-8 nodes consume 48 vCPU and 192 GiB. Existing Mumbai
E2 commitments cover 56 vCPU and 184 GiB. One additional e2-standard-8 can use
the eight already-paid CPU units; its 32 GiB is incremental billable RAM.
At the reviewed AUD rates this adds about A$116.74/month for RAM at 730 hours,
plus an 80 GiB node boot disk, a 30 GiB pd-balanced cache and applicable GST.
Existing commitment fees remain A$988.11/month. If the general pool grows to
seven nodes, or the model pool grows to two, CPU above 56 becomes billable;
upgrade surge nodes can also temporarily exceed this baseline.

Use a separate inference service because its 8.6 GiB FP32 weights, estimated
16–24 GiB runtime memory and CPU saturation have a different scaling and failure
profile from the Rust API. Use one e2-standard-8 in asia-south1-a, with total
pool autoscaling min=1/max=2 and a dedicated=models NoSchedule taint. Keep one
replica, six inference threads, 20 GiB memory requested and 24 GiB limited.
The chart follows the estate's memory-only resource rule. No HPA is configured:
node-pool capacity alone does not create another inference replica.

Trial bounds are one active request, no backlog, 1,000 text characters or
30 seconds of 16 kHz mono PCM16 input (960 kB PCM, about 1.28 MB base64). Peak
accepted RPS is therefore 1 / measured inference duration; production demand,
p99 latency and 12/36-month model growth are unknown and must not justify a
three-year purchase yet. No production availability or latency SLO is claimed.
A single zone and Recreate deployment mean maintenance and releases interrupt
this trial. The retained 30 GiB cache stores public model assets only; no user
audio or translations are persisted. RPO is zero user records; recovery time
is the measured cache attach/load or cold download time, presently unmeasured.

Kargo discovers a scanned deploy tag and manually promotes the exact image
digest to the existing Argo project. The chart is initially disabled until
that promotion. Ambient mesh enforces the existing Roamie API workload identity;
there is no public ingress, new end-user identity provider, or application
secret. Hugging Face is required at cold start; failure prevents readiness.
Cached assets permit warm loading, but offline restart must be measured before
claiming independence from the upstream. Inference errors return 503 and busy
requests return 429. The existing talk routing is unaffected by the trial.

A new CUD or GPU pool was rejected for this trial because spare paid CPU exists
and acceptable CPU latency has not been demonstrated. Packing into existing
nodes was rejected because their available requested memory is insufficient.
Future models require their own memory/latency measurements, not an assumption
that this node is suitable for all model sizes. SeamlessM4T's CC-BY-NC-4.0
license remains a constraint on commercial adoption.

Rollout, benchmark and rollback steps are in services/seamless/README.md.
