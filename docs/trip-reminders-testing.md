# Trip reminders and lifecycle — 1.1.5

## Implemented behavior

Profile settings contains eight independent, opt-in categories: preparation, departure,
daily itinerary, timed visits, packing, trip completion, weather, and shared balances.
Visit notices arrive 30 minutes before a saved timed activity. Daily summaries are at
07:00, departure at 08:00, preparation and packing at 18:00 the preceding day, and
completion at 09:00 the next day. The phone timezone at scheduling applies.

Trips automatically appear as Current, Upcoming, or Past based on their saved dates.
Past trips retain the itinerary, expenses association, and memories; archiving deletes
nothing. Revising dates changes their section and scheduled reminders.

Weather notices use the user's latest explicit trip weather check, identify the provider
and observation time, and expire after 24 hours. No background forecast fetch or severe
weather warning service is included. Balance reminders are personal, generic 18:00
check-ins for seven days after viewing an unsettled group. Open them for current amounts.
Settlements and revoked membership cancel notices when the app next refreshes the group.

## Verification

- Real Expo notification permission and local delivery verified on the dedicated iOS
  26.5 Simulator, including delivery while the app was on the Home screen.
- Real Trips screen displayed Current, Upcoming, and Past sections. Opened a past trip
  and its Memories tab; retained content remained accessible.
- Tests cover date boundaries, invalid dates and times, scheduling limits, Android
  channel-before-permission ordering, denied permissions, idempotent reconciliation,
  cancellation and sign-out races, account-safe tap targets, cold-start routing,
  preference persistence, forecast freshness/source validation and balance arithmetic.
- Forecast persistence regression verifies weather saving preserves balance snapshots.
- QA fixture uses a test account and test trips outside the shipping repository. Native
  iOS scheduling is real; it does not prove Android delivery or remote push behavior.

## TestFlight acceptance

1. Enable desired categories in Profile settings and grant notification permission.
2. Save a trip and a visit more than 30 minutes in the future. Background the app and
   verify the reminder arrives; tap it and confirm the correct itinerary opens once.
3. Edit/delete the activity or switch off its category and verify cancellation.
4. Run the trip's weather check and verify any scheduled notice identifies its source
   and check time. Old forecasts must not become new notifications.
5. View a shared group with a personal balance, enable balance reminders, and verify
   tapping opens the current ledger. Settle then refresh to cancel future check-ins.
6. Verify yesterday's completed trip appears in Past and its memories remain usable.
7. Deny permissions, reopen settings, and confirm the recovery link and error guidance.
8. Sign out and confirm pending notifications are removed before another account signs in.

Android physical-device delivery, battery-saver behavior, and native notification taps
still require device verification. OS Focus settings may suppress or delay presentation.
Only iOS simulators were used; no Android emulator was started. No App Store release.
