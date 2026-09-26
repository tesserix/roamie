# Roamie

**Your travel mate that speaks the language, minds the money, and knows who to call.**

Roamie is a simple, calm companion app for people travelling abroad. It fixes three
things travellers juggle across five different apps today:

| Pillar | The pain today | Roamie |
|---|---|---|
| **Talk** | Translation apps make you pick "from" and "to" and tap a switch before every turn. | Set *your* language once. Roamie hears which language is spoken and translates the right way automatically. |
| **Spend & Eat** | Budgets live in a spreadsheet, spending in a banking app, and "where can I eat vegan near me?" in yet another app. | One trip budget, read-only spend tracking with alerts, and nearby places that match your diet and budget. |
| **SOS** | Nobody knows the ambulance number in the country they just landed in. | The right emergency numbers and your embassy for whatever country you're in, one tap, offline. |

AI companion agents that plan and assist throughout the trip come in **MVP 2**, built on
the same Vertex AI foundation that MVP 1 sets up.

**Release priorities:** V1 focuses on Talk, Nearby, SOS and a manual budget with local
alerts. Read-only bank linking and receipt scanning follow in MVP 2. Payments,
bookings, transfers and bill splitting remain lower-priority, uncommitted future work.
See the [historical delivery backlog](docs/archive/2026-09-25/delivery-plan.md) for epics, dependencies
and release gates.

## Principles

1. **Zero-setup by default.** One language setting, one budget, one diet profile. No
   mode switches, no "from/to" pickers.
2. **AI interprets; data decides.** Gemini on Vertex AI translates, reads receipts and
   ranks places. Emergency numbers, balances, FX rates and budget maths come only from
   deterministic, sourced data. Never from a model.
3. **Read-only money.** Roamie can see transactions. It can never move money, and it
   never stores card numbers or bank credentials.
4. **Free, simple social sign-in.** Google on iOS and Android, plus Apple
   on iOS. No password signup, subscriptions or in-app payments. Local wallet data is
   separated by account; connected trip preferences and shared
   trip records are stored by the API. SOS remains available without sign-in.
5. **Works when it matters.** SOS and the phrase book work offline. Everything else fails
   politely.

## Documents

- [Product brief](docs/product-brief.md): the problem, the users, the three pillars, and
  the MVP 1/MVP 2 scope
- [Architecture](docs/architecture.md): the system shape, the Vertex AI integration, and
  the key flows
- [Backlog conventions](docs/backlog.md): issue template, labels, board fields, MVP
  phasing

## Status

Implemented features include translation, trip planning, wallet capture, nearby search
and SOS. Release readiness requires device and connected-service validation. The
historical issue plan is preserved separately from current implementation; project-board
status is not verified. See [docs/backlog.md](docs/backlog.md).
