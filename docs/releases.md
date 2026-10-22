# Release lifecycle

Main branch CI verifies Rust, mobile, MCP, database roles, migrations, media
rendering and containers. MCP checks are reusable across CI and image publishing.
The API image uses the Tesserix Debian runtime; MCP uses the lean Tesserix Python
3.14 runtime. Both are digest-pinned, non-root, exclude environment/signing files
from build contexts and publish immutable commit tags through existing workflows.
API compilation uses BuildKit dependency/target caches and copies only API source.

**Release images** publishes and smoke-tests the API, then tags that exact digest
`deploy-<sha7>` and pulls it through the `ghcr-remote` mirror. Kargo promotes only
`deploy-*` tags, by digest, so every verified API release on `main` reaches prod
without a manual step; an image that fails the smoke test is never tagged. Argo runs
the image's `migrate` Job as a sync hook before the new pods roll.

A `vX.Y.Z` tag must reference a main-branch commit and match the API, app config and
mobile package versions. **Release record** runs full CI, verifies published API
and MCP containers, and creates a draft GitHub release with immutable image digests
and component source commits. It uses each component's last image-triggering
commit, so unrelated mobile changes do not require republishing MCP. Review and
publish the draft separately. Tags, commits, pushes and releases were not created
by this repository review.

Mobile binaries use **Mobile Build**; iOS submission uses **TestFlight**. Their
shared concurrency group prevents overlapping store version operations.
[Mobile build setup](mobile-builds.md) documents required account configuration.
OTA updates are not configured: do not promise that native changes reach an
installed binary without rebuilding it.

Container scanning and smoke tests are evidence, not a waiver of dependency
findings. The current security review still has unresolved upstream advisories;
see [production readiness](production-readiness.md) before promotion.
