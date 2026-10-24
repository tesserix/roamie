# Device trip reminders

Roamie stores at most 20 trips per account on each phone. Keep the earliest 40 trip notices and at most 60 total scheduled requests, including personal balance check-ins and existing notifications, below the iOS limit of 64. Scheduling is local: no backend RPS, push tokens, new services or recurring cloud cost. Payloads contain only a bounded trip title, kind and opaque trip/account identifiers; no contacts or financial data. Notification delivery time is best effort and controlled by permissions, Focus and battery settings, not a guaranteed alarm.

Use Expo Notifications, as Kora does, with explicit opt-in and an Android channel created before requesting permission. Start reminders are at 08:00 on the start date; packing reminders are at 18:00 the day before the end date. Times use the phone timezone; reconcile when the app becomes active after travel. Skip past reminders. Reconcile saved changes, removal, permission changes and account transitions. Serialize schedule/cancel operations; stable identifiers and a generation fence prevent stale passes from rearming after sign-out. OS failures surface in settings and can be retried. A failed preference save must not claim success.

Only the active signed-in account may schedule or open a reminder. Ignore unknown kinds and identifiers; notification data is untrusted. Sign-out cancels the queue and delivered notifications. Preferences are account-scoped. The schedule is bounded and recreated from saved trips; no database migration is required. Disabling reminders removes pending notices. Rollback must cancel pending notices before removing this integration.

Personal balance reminders are opt-in local check-ins at 18:00 for seven days after viewing an unsettled group. They contain no amounts or participant names; tapping opens the current server-authorized ledger. A settled ledger or revoked group access cancels notices on the next refresh. No other group member is messaged. Changes made by another member while this app remains closed cannot cancel a previously scheduled local check-in. Remote push with live ledger events would require a separate server integration.

## Notification inventory and reference review

Compared with Kora `apps/mobile/src/reminders/notificationAccess.ts` and `schedule.ts`: retain explicit opt-in, recoverable permission denial, serialized scheduling/cancellation, and an OS-cap-aware queue. Roamie reconciles stable IDs rather than cancelling unrelated notices on every refresh.

Supported local categories: preparation (18:00 before departure), start (08:00), one daily agenda (07:00 on days with saved stops), packing (18:00 before the last day), and return review (09:00 the following day). Keep the earliest 40 trip notices, leaving space for other notifications, and refresh on saved changes and app activation. A saved trip remains Current through its full final local-calendar day, then appears in Past automatically; no data is deleted or migrated. Existing budget-threshold alerts remain event-driven. Lock-screen financial details and automated group-member push delivery require a separate decision; no stale local amount is presented as a live balance.

Do not invent flight delays, weather emergencies or safety alerts without an authoritative subscribed source. Offline-download progress and foreground translation results stay in their existing UI rather than generating duplicate notification spam.

References reviewed:
- https://docs.expo.dev/versions/v57.0.0/sdk/notifications/ — permission flow, Android channels, pending schedules, delivery and tap responses.
- https://docs.expo.dev/router/reference/url-parameters/ — typed trip navigation and clearing consumed parameters.
- Installed Expo Notifications `ExpoSchedulingDelegate.kt`: Android uses `setAndAllowWhileIdle` when exact-alarm access is unavailable; exact-alarm permission is not required for these approximate reminders.

Visit notifications are optional, 30 minutes before each valid saved activity. They are itinerary reminders, not live travel-time estimates. Weather notifications reuse the existing, consented trip-weather check; no extra third-party data transmission or silent AI request is introduced. They include provider attribution, measured temperature/rain chance and the observation time. They are scheduled at 07:30 on the forecast date (or once, a minute after a same-day check), only when the forecast will be at most 24 hours old. Changes to destinations or dates invalidate cached forecasts. Refreshing forecasts while the app remains closed would require server push or best-effort background refresh; this local implementation does not claim that capability.
