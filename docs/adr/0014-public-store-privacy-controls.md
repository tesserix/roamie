# ADR 0014: Public-store privacy controls

The email-only initiation flow below is superseded by ADR 0017.

Roamie 0.1.2 lacks discoverable privacy and account-deletion links. Its Android
manifest also requests library-wide media and background playback permissions.
A public release needs a truthful request path and permissions matching the UI.

Use two static, public HTML resources on the existing API: `/privacy` and
`/account-deletion`. Link both from sign-in and Profile & settings. The deletion
page starts a support request rather than claiming that sign-out deletes data.
It remains accessible after uninstall and requires no login. Support verifies
ownership before any deletion; existing shared Tesserix identities must not be
deleted merely because a customer requests deletion of their Roamie account.

These pages have no database writes, credentials, third-party scripts, external
assets or customer-specific data. Planning envelope: under 10 requests/second,
under 20 KB per page, no retained page data and one local read per request.
They use the API's existing availability boundary; no new service or datastore
is warranted. A restrictive CSP and content-type protect the public HTML surface.
If the API is unavailable, support remains reachable through the company site.
Roll back the static routes and mobile links by reverting the release commit.

Android uses the system photo picker rather than scanning the photo library.
iOS retains its explicit, opt-in trip-date suggestions. Speech does not require
background execution. Block unused Android permissions at manifest merge time;
verify the produced artifact, not only app.json.

Public production submission remains gated on the support owner accepting the
deletion process, verified reviewer access, accurate Data safety declarations,
store assets, signed-build testing and Google's review. The selected initial
store target audience is 18+, as authorized by the product owner.
