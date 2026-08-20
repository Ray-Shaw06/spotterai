# SpotterAI: setup and deployment

Setup, configuration, and optional Firebase sync for running or self-hosting SpotterAI. See the [main README](../README.md) for what the app is and how it works.

## Core setup & Vercel deploy (step by step)

The entire app runs on no-cost tiers. There is no paid notification path, reminders
are in-browser calendar files and local on-device alerts.

### 1. Get a free Gemini API key

1. Go to **[Google AI Studio → API keys](https://aistudio.google.com/app/apikey)**.
2. Sign in with a Google account and click **Create API key**. No billing, no card.
3. Copy the key.

### 2. Run it locally

```bash
# clone your repo, then:
cp .env.example .env          # create your local env file
# open .env and paste your key:  GEMINI_API_KEY=your_key_here

# run with the Vercel dev server (serves the static site AND the function)
npx vercel dev
# → open the printed local URL (e.g. http://localhost:3000)
```

> `npx vercel dev` is the easiest way to run the serverless function locally. If
> you just open `index.html` directly without a server, the live API call won't be
> available, but SpotterAI will automatically fall back to a saved example plan
> and the evaluator still runs, so you can demo the audit immediately.

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "SpotterAI: AI workout coach with a code-based safety audit"
git branch -M main
git remote add origin https://github.com/<you>/spotterai.git
git push -u origin main
```

### 4. Deploy free on Vercel

1. Go to **[vercel.com](https://vercel.com)** and sign in with GitHub (free Hobby
   plan).
2. **Add New → Project** and import your `spotterai` repo. No build settings to
   change, it's a static site with a serverless function.
3. Open **Project → Settings → Environment Variables** and add:
   - **Name:** `GEMINI_API_KEY`  **Value:** *your key from step 1*
   - Optional: `GROQ_API_KEY` and `GROQ_MODEL` for the text-model fallback.
   - Optional: `FIREBASE_SERVICE_ACCOUNT` — a Firebase service account JSON
     (pasted as one line) that lets `api/audit-telemetry.js` write aggregate
     Safety Lab counters. Leave it unset and that endpoint just accepts
     requests and writes nothing; see `.env.example` for how to generate one.
     **If you set this, also add a TTL policy**: Firestore console →
     **Firestore Database → TTL** → create a policy on collection group
     `audit_telemetry_throttle`, field `expiresAt`. That collection exists
     only to rate-limit one IP for an hour; every document it writes already
     carries an `expiresAt` a Firestore-managed TTL deletes, but the deletion
     itself is a per-field policy configured outside this repo and is not on
     by default. Skip it and the collection grows forever instead of expiring.
4. Click **Deploy**. Your live URL is ready in seconds.

---

## Configuration

- **Model:** the Gemini model name is a single constant, `GEMINI_MODEL` at the
  top of [`lib/gemini.js`](lib/gemini.js), shared by both serverless functions.
  Free Flash models change over time; update it in that one place.
- **Plan rubric:** all evaluator thresholds and penalties are in the `THRESHOLDS`
  and `PENALTY` constants at the top of [`evaluator.js`](evaluator.js).
- **Form rubric:** all form-check angle thresholds are in the `FORM_THRESHOLDS`
  constant in [`form-evaluator.js`](form-evaluator.js).

### Measurement behavior

Onboarding stores a temporary draft under `spotterai_onboarding` so a refresh does
not erase in-progress answers. Metric mode renders height in centimetres and weight
in kilograms; Imperial renders separate feet/inches fields and pounds. Switching
systems converts entered values. Both measurements are optional. Completing setup
removes the draft; height is not sent to the AI plan endpoint, while weight may be
converted to kilograms locally to seed conservative nutrition targets. If rounding
could make an invalid source value look valid in the other system, onboarding keeps
it marked for correction until the user edits that field. Valid published boundary
values remain valid after conversion.

### Vercel funnel analytics

Enable **Web Analytics** in the Vercel project dashboard, deploy, then open
**Analytics → Page Views**. Release 1 records allow-listed activation actions as
virtual paths under `/funnel/<event>` so they work with the existing pageview
transport. Examples include `/funnel/landing_cta_clicked/hero`,
`/funnel/plan_generation_succeeded/false`, and
`/funnel/meal_photo_failed/timeout`.

The full event allow-list is in [`analytics.js`](analytics.js). Unknown events and
properties are dropped. Never add measurements, injuries, meal text/photos, plan or
workout contents, AI prompts/responses, account identifiers, push endpoints, tokens,
or raw errors to funnel paths. See Vercel's [Web Analytics
guide](https://vercel.com/docs/analytics) for dashboard behavior.

### Reminders (zero-cost, no operator setup)

Reminders need **no environment variables, no Firebase Blaze plan, no VAPID keys,
and no server**, they were deliberately built to keep the operator bill at $0.

- **Calendar export.** After a plan is generated, **Add workouts to calendar**
  builds a standards-based `.ics` file in the browser
  ([`calendar-export.js`](calendar-export.js)): each training day becomes a
  weekly-recurring event with an optional native reminder (none / 10 / 30 / 60 min).
  The user's calendar app owns everything after import. SpotterAI never learns
  whether an event was imported and stores no calendar data.
- **Local rest-timer alerts.** In **Account → Workout alerts**, the user can opt
  into a local notification when a rest timer ends
  ([`workout-alerts.js`](workout-alerts.js)). Permission is requested only on a
  deliberate tap; the enabled flag is stored on that device only. The alert is shown
  by the already-installed service worker's `showNotification()` and its click
  routes to a **fixed** same-origin Today URL.

**Honest limits.** A closed or suspended PWA cannot run timers, and SpotterAI makes
**no promise of any notification after the app is closed**, there is no background
or scheduled push. Vibration, sound, and the on-screen timer are the universal
fallback and always work, including when notifications are unsupported or blocked.

---

## Cross-device sync (Google + Firebase), optional

By default SpotterAI is local-only. To sync across devices with a real **"Sign in
with Google"**, connect a **free Firebase** project (Spark plan, **no credit
card**). The app stays local-first: sign-in is hidden until you configure this,
and nothing breaks if you skip it.

> This Spark guidance applies to optional user-data sync only, the only
> server-side data SpotterAI stores. There is no paid notification path.

**It's $0, and the config is not a secret**, a Firebase web `apiKey` is a public
project identifier, not a credential. Your data is protected by the Firestore
security rules below (each user can read/write only their own document), so
[`firebase-config.js`](firebase-config.js) is safe to commit.

**1. Create the project**
1. [Firebase console](https://console.firebase.google.com) → **Add project** (any
   name; Analytics optional).
2. Click the **Web** icon (`</>`) to **register a web app**, then copy the
   `firebaseConfig` values it shows.

**2. Turn on Google sign-in**
3. **Build → Authentication → Get started → Sign-in method → Google → Enable →
   Save.**
4. **Authentication → Settings → Authorized domains → Add domain**, add your
   Vercel domain (e.g. `spotterai-xxxx.vercel.app`); `localhost` is already there.

**3. Create the database + rules**
5. **Build → Firestore Database → Create database → Production mode →** pick a
   location.
6. Open the **Rules** tab, paste this, and **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

**4. Paste your config**
7. Replace the placeholders in [`firebase-config.js`](firebase-config.js) with your
   web app's values (`apiKey`, `authDomain`, `projectId`, `appId`).
8. Commit + push (or run locally). The account modal now shows **Sign in with
   Google**, and your data syncs to `users/<your-uid>` in Firestore, sign in with
   the same Google account on any device to see the same data.

> Sync is **last-write-wins** by a timestamp on the whole document, ideal for one
> person across their own devices, not designed for simultaneous multi-user edits.
> The Firebase SDK is lazy-loaded from Google's CDN only when sync is configured.

---
