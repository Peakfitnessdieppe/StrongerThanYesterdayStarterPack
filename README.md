# Peak Fitness Dieppe — Stronger Than Yesterday Starter Pack

Production-ready static landing page for the Peak Fitness Dieppe 30-day starter offer. Dark, fast, bilingual, audience-aware.

## Stack
- Vanilla HTML, CSS, JavaScript only.
- Single CSS (`styles.css`) and JS (`app.js`) request.
- Calendly widget (async) for call booking.
- Netlify for routing + deploy.

## Directory
- `index.html` — one-page markup, sticky header, modal, sections.
- `styles.css` — Peak Fitness brand styling, components, focus states.
- `app.js` — language & audience copy, modal, UTMs, tracking, Calendly.
- `assets/` — placeholder SVG hero artwork and wordmark.
- `netlify.toml` — pretty routes and `/buy` redirect.
- `README.md` — this doc.

## Setup
1. Replace TODO constants at top of `app.js`:
   ```js
   const SQUARE_PAYMENT_LINK = "https://square.link/u/REPLACE_ME";
   const CALENDLY_URL        = "https://calendly.com/REPLACE_ME/intro-call";
   const PIXEL_ID            = "REPLACE_ME";
   const GA_MEASUREMENT_ID   = "G-REPLACE";
   ```
2. Swap hero art or photography in `assets/` (keep same filenames, or update `copy` paths in `app.js`).

## Local preview
- Open `index.html` directly or run a lightweight server (`python -m http.server 4173` then open `http://localhost:4173`).
- Test audience routes by adding query params:
  - `/?audience=women`
  - `/?audience=men`
  - `/?audience=youth&variant=parent`
- Toggle language via header (persisted in `localStorage['pf_lang']`).

## Copy & translations
- Audience copy is defined in `app.js` inside `copy.en` and `copy.fr` objects.
- Youth micro-variants (committed, parent, identity, female) shallow-merge overrides for `hero` text.
- Update values there to adjust messaging.

## Tracking & UTMs
- `getUTMs()` reads `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`.
- On load, sets:
  ```js
  window.PF = {
    page: 'offer',
    offer: OFFER_SLUG,
    currency: CURRENCY,
    price_cents: PRICE_CENTS,
    audience,
    variant,
    utm
  };
  localStorage['pf_offer_last_view'] = JSON.stringify(window.PF);
  ```
- Primary CTA opens modal; “Pay” adds UTMs to `SQUARE_PAYMENT_LINK` before redirect.
- `pf_event` custom events emitted for `cta_click` and `calendly_click`; bridged to GA4/Meta when IDs provided.

## Calendly
- Secondary CTA buttons call `Calednly.initPopupWidget({ url: CALENDLY_URL + utms })`.
- If Calendly script unavailable, falls back to `window.open`.

## Netlify deploy
1. Push to GitHub.
2. In Netlify, create site from repo.
3. Configure custom domain `offer.peakfitnessdieppe.ca` (CNAME to Netlify).
4. Enable HTTPS.
5. Pretty routes handled via `netlify.toml`:
   - `/women` → `/?audience=women`
   - `/men` → `/?audience=men`
   - `/youth` → `/?audience=youth`
   - `/buy` → Square checkout (replace URL in file).

## QA checklist
- Lighthouse 90+ (Performance + A11y) expected with real imagery optimized.
- Keyboard-only navigation (header toggle, FAQ, modal) works.
- `prefers-reduced-motion` respected.
- Language persists across reloads.
- UTMs appended to checkout and Calendly.
- Modal focus trap + ESC close confirmed.
