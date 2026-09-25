# Roamie: product brief

## Who it is for

International leisure travellers, solo or in pairs, spending 3–21 days in a country whose
language they do not speak. They use a phone and are often offline or on roaming data. In
v1 their day-to-day problems are talking to people, keeping track of money, finding food
they can eat, and knowing what to do in an emergency.

## The app in one screen

Four tabs, nothing hidden:

```
[ Talk ]  [ Wallet ]  [ Nearby ]  [ SOS ]
```

The first-run setup takes three questions (under 60 seconds), and every answer can be skipped:

1. **Your language** (pre-filled from the phone locale). This is the only translation
   setting that exists.
2. **Your trip**: destination country or countries, dates, budget, and home currency.
3. **You**: diet and allergies, plus your nationality, which is used to find your embassy.

## Simple by default: the design rules

Roamie is used by tired people on a street corner, so simplicity is a requirement. These
rules are part of the Definition of Done for every UI story.

- **Four tabs, no more.** No hamburger menu, no settings maze. Settings are one screen.
- **The main task in any tab takes at most two taps.** Talk: tap the mic. SOS: tap the
  number. Wallet: tap + to add.
- **One primary action per screen.** Everything else is visually secondary.
- **Infer, don't ask.** The country comes from location, the partner language from the
  country, the currency from the country, and the daily allowance from the budget.
  Anything Roamie infers is shown, and one tap changes it.
- **Plain words.** The UI never shows jargon such as "source/target language",
  "aggregator", "consent token" or "category split". It says "Connect your card
  (read-only)", "You have $42 left today", "Tap and talk".
- **Readable in the sun, usable with one hand.** Large type, touch targets of 48 pt or
  more, primary controls in the thumb zone, full dynamic type and screen-reader support.
- **Errors say what to do next.** Every error says what happened and gives one action to
  take.
- **Proof:** five first-time travellers complete each pillar's core task, unaided and on
  the first try, before MVP 1 ships.

---

## Pillar 1: Talk (conversation translation)

### The problem

In Google Translate conversation mode you pick two languages, tap the matching mic, and
fix things every time the other person answers in a different language or dialect. With
a shopkeeper that is fiddly. At a hospital counter it is stressful.

### How Roamie works

- The user sets **one** language, *mine*. There are no other settings.
- Roamie listens to each utterance and **detects its language automatically**.
  - If it is **not mine**, it translates into mine. That language becomes the
    *partner language*.
  - If it **is mine**, it translates into the **most recent partner language**.
- Before anyone has spoken, the partner language defaults to the main language of the
  country the phone is in. For example, in Japan, speaking English produces Japanese.
- **Face-to-face layout**: the screen is split and the partner's half is rotated 180°, so
  two people can hold the conversation over one phone laid on a table. Each translation
  is shown as large text and spoken aloud.
- There is **one big mic button** (tap to talk, auto-stop on silence), with an optional
  hands-free mode.
- A "Show me" card displays a phrase full screen in the partner language, for noisy
  places.

**v1 scope is a 1:1 conversation** (the user and one partner). Group conversations and
three or more languages are out of scope.

### Rules that keep it trustworthy

- Low-confidence detection is shown ("Sounds like Thai?"), and **one tap on the chip
  corrects it**. The correction becomes the partner language for the rest of the
  conversation.
- Both the original text and the translation are always shown. The user can see what
  was heard.
- Conversations stay on the device by default. Cloud history requires opt-in.
- An offline phrase pack covers the destination's top 100 travel phrases, plus the
  user's allergy card.

---

## Pillar 2: Spend and eat (budget, preferences, nearby)

### Budget and spending

- **Trip budget** in home currency, optionally split into categories: food, stay,
  transport, activities, shopping, and other.
- Spending comes from three sources:
  1. **Read-only account link** via a licensed open-banking or account-aggregator
     provider, such as Basiq (Australia CDR), Plaid (US), TrueLayer (UK/EU) or Setu
     (India AA). Roamie receives transactions **read-only**. It **never** sees or stores
     a card number, CVV, or bank password, and it can never initiate a payment.
  2. **Receipt snap**: photograph a receipt and Gemini extracts the merchant, amount,
     currency and category. The user confirms before it is saved.
  3. **Manual entry** in two taps.
- Every amount is converted to home currency using that day's FX rate, and the original
  amount and currency are stored.
- **Alerts** go out at 50%, 80% and 100% of the total budget and of each category, plus a
  daily *pace* nudge: "At this rate you'll run out on day 9 of 12."
- End-of-trip summary.

### Preferences and Nearby

- The **preference profile** covers diet (vegetarian, vegan, halal, kosher, Jain,
  pescatarian), allergies, budget level ($–$$$$), cuisines liked or avoided, and
  interests (culture, nature, nightlife, shopping, and so on).
- **Nearby** shows real places around the user right now (restaurants, cafés, pharmacies,
  ATMs, and attractions) from Google Places. They are **filtered and ranked by the
  profile and the remaining budget**: open now, distance, rating, and diet fit.
- Each card gives *why it matches* in a short line: "Vegan options · $$ · open till 22:00
  · 400 m".
- One tap hands off to Maps for directions. Roamie does not book anything in v1.
- The **allergy card** is the user's allergies translated into the local language, and
  it is available offline.

**Rule:** a diet or allergy match is a *signal*, not a guarantee. Allergy matches always
show "confirm with staff", with the allergy card one tap away.

---

## Pillar 3: SOS (emergency help)

- The SOS tab shows the numbers for the country the phone is in **right now**: police,
  ambulance, fire, the general emergency number, tourist police where one exists, and the
  user's **embassy or consulate** based on their nationality.
- Tapping a number dials it. **"Share my location"** sends a map link, plus the address
  translated into the local language, to the user's emergency contacts.
- A **"Help me say it"** button provides pre-translated emergency phrases, such as "I need
  an ambulance", "I'm allergic to …" and "I've been robbed", in the local language.
- **Offline-first.** The full dataset for every country is bundled with the app and
  refreshed silently.
- **Numbers never come from an LLM.** They come from a versioned dataset with a
  source and a last-verified date for each country, reviewed by a person before release.

---

## MVP phasing

| Phase | Goal | Contents |
|---|---|---|
| **MVP 0: Foundations** | Can ship safely | Architecture decisions, Expo app shell, Go API, auth, Vertex AI gateway, CI, privacy baseline |
| **MVP 1: Travel Mate v1** | The three pillars, end to end | Talk (1:1 auto-detect), Wallet (budget, read-only link in one region, receipts, alerts), Preferences and Nearby, SOS |
| **MVP 2: AI Companion** | Roamie becomes an assistant | Agent runtime on ADK and Vertex AI with tools over the MVP 1 data: trip-aware Q&A, daily brief, budget coach, "find me dinner" agent, and group translation |

### Explicitly out of v1

- Bookings of any kind (flights, hotels, tables)
- Moving money, splitting bills, or payments
- Group conversations (three or more people)
- Itinerary planning (TripBaba covers that; a bridge could come later)

## Success measures for MVP 1

- Time to first translated sentence after install is under 90 seconds.
- Median speech-to-speech translation latency is under 2.5 s on 4G.
- Language auto-detection is correct on 95% or more of utterances longer than two words,
  across the 20 launch languages.
- 60% or more of active trips have a budget, and alerts fire within 5 minutes of the
  transaction arriving.
- SOS numbers are 100% source-verified for launch countries, and SOS renders offline on
  cold start.
