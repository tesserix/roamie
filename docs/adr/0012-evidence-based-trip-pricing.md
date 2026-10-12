# Evidence-based trip pricing and independent approval

Status: researched proposal; provider activation and production rollout pending.

## Findings

The current specialist receives Google Places locations, not dated hotel rates.
The travel MCP drops monetary claims when no provider amount exists. However,
the planner generates its own accommodation/food/activity/transport allocations,
and the supervisor explicitly permits approximate allocations if the total fits
the ceiling. Its approval therefore does not establish cost feasibility. JEV's
typed review exists in the API's OCR/translation candidate; trip supervision uses
the gateway model through the ADK and does not currently call JEV.

The actual Japan QA result illustrates the gap. Premium transport was AUD 140
for Green Car rail, private transfers and taxis. The official SmartEX table lists
Tokyo–Kyoto Nozomi Green Car regular-season adult one-way fare JPY 18,840.
Two adults alone cost JPY 37,680, about AUD 341.06 at the 9 October 2026 reference
rate of JPY 110.48 per AUD. A child seat, season adjustments and local transfers
are additional. The published table is dated 1 April 2025 and was retrieved on
12 October 2026; it is a reference tariff, not a dated inventory quote. The
premium contingency was AUD 200 on AUD 2,290 base cost, approximately 8.73%.

Other findings: a duplicated Tokyo Tower visit, only three activity candidates
per destination surviving multi-city MCP selection, no museum-specific search
despite the chosen interest, no priced inter-city leg, and ambiguous hotel nights.
A five-day trip from 20–24 October has four overnight stays unless the traveller
explicitly requests an additional night. Day counts must not become hotel nights.

## Source research

- [Booking.com prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites): managed-affiliate agreement, API token and affiliate ID required.
- [Accommodation search](https://developers.booking.com/demand/docs/accommodations/about-accommodation): `/accommodations/search` and `/accommodations/availability` match destination, dates and guests.
- [Booking.com pricing](https://developers.booking.com/demand/docs/accommodations/prices-accommodations): distinguish base, displayed book price, total, included/excluded/conditional charges and online-payment portion. Availability is an estimate; final pricing can differ and must be refreshed.
- [Expedia launch requirements](https://developers.expediagroup.com/rapid/setup/launch-requirements/lodging-launch-reqs): collect each child's age at check-in; show occupancy restrictions, extra-person/crib charges, room/bed details, refundable status and mandatory property fees.
- [SmartEX fares](https://smart-ex.jp/en/product/plan/service/): official ordinary/Green Car tables and seasonal adjustments; local conventional rail is separate.
- [Reference FX](https://api.frankfurter.dev/v1/latest?base=AUD&symbols=JPY): rate date must accompany conversion; reference FX is not a guaranteed settlement rate.

Google Places cannot substantiate a room price. Yatra, MakeMyTrip, Booking.com and
Expedia links may help a traveller compare, but a consumer search page or an
undated “from” price cannot be treated as a whole-party quote. Approved supplier
access is required for a dependable automated rate feed. Current Roamie ESO key
metadata contains no Booking.com/Expedia/Yatra/MakeMyTrip price credential.

## Proposed behavior

Collect room occupancy, each child's age, dates/check-in/check-out, departure
city, flight inclusion, luggage, currency, flexibility and refund preferences.
Keep optional itinerary creation available when pricing inputs are incomplete,
but make the missing information visible. Never infer child age or room capacity.

Use the existing travel MCP boundary for priced evidence; a separate service is
not justified. Start with one approved lodging provider. Each rate must retain
supplier/property/product IDs, room/bed configuration, occupancy, dates, original
currency, whole-stay total, tax/fee inclusion, mandatory local charges, meal plan,
cancellation conditions, observation/expiry times and a safe source link. Keep
supplier keys in namespace-scoped Roamie OpenBao paths, not the app or AI prompt.
Search comparison needs no booking/payment capability.

Price transport by leg and traveller category, including inter-city journeys,
airport/local transfers, luggage and ticket restrictions. Price attraction entry
for the party. Keep food as an explicitly labelled per-person/per-day estimate
unless a provider supplies an applicable meal quote. An unknown amount is not zero.

Calculate totals using integer minor units and explicit rounding. Preserve quote
currency and rate date alongside converted totals. Do not add taxes twice when
the supplier total already includes them. Include a default 15% miscellaneous
buffer on the base, separately from known taxes and fees, and explain what it
covers. Any user customization must remain explicit. If supported costs exceed
the ceiling, report infeasibility and offer fewer days/lower comfort/a revised
budget; do not shrink amounts to manufacture three options. A genuine premium
discount can cost less than a budget option: price order is not quality order.

The planner chooses evidence IDs and explains each cost/quantity, why that room
or route suits the party, and each tier's tradeoffs. Application code reconstructs
prices from the evidence and rejects invented IDs, mismatched dates/occupancy,
stale rates, omitted mandatory fees and unsupported totals before AI review.

JEV then classifies evidence completeness and narrative consistency through the
gateway using a pinned typed decision. A separate supervisor receives the same
evidence and the deterministic audit. It must identify concrete issues, not merely
restate the planner. Only passing arithmetic/coverage, a valid confident JEV
acceptance and supervisor approval produce a cost-reviewed plan. Unavailable,
malformed or low-confidence judgments leave an editable **unverified draft**.
No AI verdict may override a deterministic failure. Retain review IDs, model
versions and evidence freshness in the console; never log private prompts or keys.

## Bounds and delivery

Working assumptions, not measured traffic: up to one priced-plan request/sec,
the existing eight worker slots, four destinations, twelve travellers, fourteen
days, at most six concurrent quote reads and 256 KiB normalized evidence. Target
99.9% availability for the manual itinerary and a bounded 90-second planning
response. Quotes receive a six-second deadline, no nested retries and short
supplier-approved caching. Fit generation and independent checks inside the
manager's 80-second outer deadline; cancel downstream calls when the user cancels.
If measurements cannot meet that budget, switch generation to an observable job
before increasing public timeouts again. Peak load, provider quotas and p99 must
be measured before activation. Model/supplier charges remain unknown until the
partner contract and pricing are supplied; no new cluster workload is proposed.

When a supplier is unavailable, show a draft with missing sources. When FX is
unavailable, preserve original currencies without declaring a converted total.
When a rate expires, refresh it and rerun both reviews before reusing approval.
Keep existing saved plans editable, marked unverified until re-reviewed. Use
additive contracts and generated mobile types. No database migration is required
for the initial read-only comparison; deployment stays behind a product-scoped
configuration gate and can revert without deleting trips.

Acceptance must cover child/room/date matching, sold-out/changed rates, currency
exponents and rounding, taxes included/excluded, all transport legs, unknown
prices, buffer arithmetic, over-budget outcomes, JEV failures, supervisor rejection,
duplicate/repeated sights and real signed-customer iOS/Android use. Fixture tests
cannot establish that partner production access works.

## Required activation inputs

The test child's age, departure city and flight inclusion are still requested.
Partner API access is also requested. Research and local validation may proceed,
but live priced comparisons and final production approval cannot be certified
without those inputs, applicable supplier access and the named rollout approval.

## Independent supervisor review

The running Roamie trip manager's supervisor was invoked through its existing
gateway provider with the synthetic premium plan and the official tariff/FX
evidence. Run `48e48ba8306e490fa0a3c00874493b49` returned **reject**, confidence
1.0: AUD 140 transport was below the two-adult rail reference, AUD 200 did not
meet the proposed 15% buffer, sources were absent from the plan, and occupancy,
dated hotel rates, transfers and entry fees were missing. This was an additional
QA review with sourced context, not a change to the production approval loop.

The researched correction design was then reviewed separately as a proposal,
explicitly excluding deployed readiness. Run `cc5df045203443d38c67570194957083`
returned **approve**, confidence 1.0, no issues. Its approval covers the design's
occupancy/date matching, taxes, transport coverage, FX dates, buffer, over-budget
outcomes, deterministic checks, independent JEV/supervisor gates and supplier
prerequisites. It does not certify implementation, price availability, JEV
activation or a production release. The existing supervisor is model-based;
neither of these two QA review calls is a JEV decision.
