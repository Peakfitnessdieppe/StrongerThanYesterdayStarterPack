/* =============================
   Peak Fitness Starter Pack App
   ============================= */

let SQUARE_APPLICATION_ID = null;
let SQUARE_LOCATION_ID = null;
let CALENDLY_URL = "https://calendly.com/REPLACE_ME/intro-call";
let SQUARE_ENVIRONMENT = "production";
const PIXEL_ID            = "REPLACE_ME";                           // TODO Meta Pixel ID
const GA_MEASUREMENT_ID   = "G-REPLACE";                            // TODO GA4 Measurement ID
const OFFER_SLUG          = "offer-139-one-time";
let CURRENCY              = "CAD";
let PRICE_CENTS           = 13999;
let TAX_RATE              = 0.15;
const API_BASE = '/.netlify/functions';

// Promo popup configuration
const PROMO_WEBHOOK_PLACEHOLDER = `${API_BASE}/promo-hook`;
let PROMO_WEBHOOK_URL = PROMO_WEBHOOK_PLACEHOLDER;
const PROMO_SUBMITTED_KEY = 'pf_promo_submitted_v1';
const PROMO_DISMISSED_SESSION_KEY = 'pf_promo_dismissed_session_v1';
const PROMO_MOBILE_QUERY = '(max-width: 720px)';

let squarePayments = null;
let squareCard = null;
let configLoaded = false;
let calendlyLoaded = false;
let calendlyVisible = false;
let squareSdkEnvironment = null;

const leadState = {
  leadId: null,
  isSubmitting: false,
  lastError: null
};

window.PF_PIXEL_ID = PIXEL_ID;
window.PF_GA_ID = GA_MEASUREMENT_ID;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const toMoney = (cents, currency = CURRENCY, locale = "en-CA") =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);

const AUDIENCES = ["women", "men", "youth"];
const LANGS = ["en", "fr"];
const YOUTH_VARIANTS = ["committed", "parent", "identity", "female"];

const ROUTE_MAP = {
  "/women": { audience: "women" },
  "/men": { audience: "men" },
  "/youth": { audience: "youth" },
  "/womens": { audience: "women" },
  "/mens": { audience: "men" },
  "/en-women": { audience: "women", lang: "en" },
  "/en-men": { audience: "men", lang: "en" },
  "/en-youth": { audience: "youth", lang: "en" },
  "/en-womens": { audience: "women", lang: "en" },
  "/en-mens": { audience: "men", lang: "en" },
  "/fr-women": { audience: "women", lang: "fr" },
  "/fr-men": { audience: "men", lang: "fr" },
  "/fr-youth": { audience: "youth", lang: "fr" },
  "/fr-womens": { audience: "women", lang: "fr" },
  "/fr-mens": { audience: "men", lang: "fr" }
};

function parseSearch() {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(params.entries());
}

function normalizePath(path) {
  if (!path) return "/";
  if (path !== "/" && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function getRouteDefaults() {
  const raw = window.location.pathname.replace(/\/index\.html$/, "");
  const path = normalizePath(raw);
  return ROUTE_MAP[path] || {};
}

function getAudience(defaultAudience = "women") {
  const routeData = getRouteDefaults();
  if (routeData.audience && AUDIENCES.includes(routeData.audience)) return routeData.audience;
  const { audience } = parseSearch();
  return AUDIENCES.includes((audience || "").toLowerCase()) ? audience.toLowerCase() : defaultAudience;
}

function getVariant() {
  const { variant } = parseSearch();
  const v = (variant || "").toLowerCase();
  return YOUTH_VARIANTS.includes(v) ? v : "";
}

function getLangStored() {
  const { lang } = parseSearch();
  if (lang && LANGS.includes(lang.toLowerCase())) {
    const resolved = lang.toLowerCase();
    setLangStored(resolved);
    return resolved;
  }
  const routeData = getRouteDefaults();
  if (routeData.lang && LANGS.includes(routeData.lang)) {
    setLangStored(routeData.lang);
    return routeData.lang;
  }
  const stored = localStorage.getItem("pf_lang");
  if (LANGS.includes(stored)) return stored;
  const detected = detectBrowserLang();
  if (detected) {
    setLangStored(detected);
    return detected;
  }
  return "en";
}

function detectBrowserLang() {
  if (typeof navigator === "undefined") return null;
  const raw = [];
  if (Array.isArray(navigator.languages)) raw.push(...navigator.languages);
  if (navigator.language) raw.push(navigator.language);
  if (navigator.userLanguage) raw.push(navigator.userLanguage);
  const normalized = raw
    .map((entry) => (entry || "").toLowerCase())
    .filter(Boolean);
  const match = normalized.find((code) => code.startsWith("fr"))
    || normalized.find((code) => code.startsWith("en"));
  if (match?.startsWith("fr")) return "fr";
  if (match?.startsWith("en")) return "en";
  return null;
}

function setLangStored(lang) {
  if (LANGS.includes(lang)) {
    localStorage.setItem("pf_lang", lang);
  }
}

function getUTMs() {
  const params = parseSearch();
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
  return keys.reduce((acc, key) => {
    if (params[key]) acc[key] = params[key];
    return acc;
  }, {});
}

function appendUTMs(url, utm) {
  try {
    const target = new URL(url);
    Object.entries(utm || {}).forEach(([k, v]) => target.searchParams.set(k, v));
    return target.toString();
  } catch (_) {
    const query = new URLSearchParams(utm || {}).toString();
    if (!query) return url;
    return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
  }
}

let configPromise = null;
let squareSdkPromise = null;
let squareCardAttached = false;
const dialogRegistry = new WeakMap();
let dialogFocusReturn = null;

// --- Promo helpers ---
function isValidEmail(value = '') {
  return /^[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+$/.test((value || '').trim().toLowerCase());
}

function setLocalStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}
function getLocalStorage(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function handleDialogKeydown(event, dialog, closeFn) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (typeof closeFn === "function") closeFn();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = focusables(dialog);
  if (!nodes.length) return;
  const [first, last] = [nodes[0], nodes[nodes.length - 1]];
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

function showDialog(dialog, closeFn) {
  if (!dialog) return;
  dialogFocusReturn = document.activeElement;
  if (modalOverlay) modalOverlay.hidden = false;
  dialog.hidden = false;
  const trap = (event) => handleDialogKeydown(event, dialog, closeFn);
  dialogRegistry.set(dialog, { trap, closeFn });
  dialog.addEventListener("keydown", trap);
  const nodes = focusables(dialog);
  if (nodes[0]) nodes[0].focus();
  document.body.classList.add("modal-open");
}

function hideDialog(dialog) {
  if (!dialog) return;
  const entry = dialogRegistry.get(dialog);
  if (entry?.trap) dialog.removeEventListener("keydown", entry.trap);
  dialogRegistry.delete(dialog);
  dialog.hidden = true;
  const anyOpen = [modal, calendlyModal].some((node) => node && !node.hidden);
  if (modalOverlay) modalOverlay.hidden = !anyOpen;
  if (!anyOpen) {
    document.body.classList.remove("modal-open");
    if (dialogFocusReturn && typeof dialogFocusReturn.focus === "function") dialogFocusReturn.focus();
    dialogFocusReturn = null;
  }
}

// --- Promo popup controls ---
function showPromoOverlay() {
  const ov = document.getElementById('promo-overlay');
  if (ov) ov.hidden = false;
  document.body.classList.add('promo-open');
}

function hidePromoOverlay() {
  const ov = document.getElementById('promo-overlay');
  if (ov) ov.hidden = true;
  document.body.classList.remove('promo-open');
}

let promoShown = false;
let promoObserver = null;
let promoFocusReturn = null;
const promoMediaQuery = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia(PROMO_MOBILE_QUERY)
  : null;

function openPromoPopup() {
  if (promoShown) return;
  const popup = document.getElementById('promo-popup');
  if (!popup) return;
  promoShown = true;
  promoFocusReturn = document.activeElement;
  showPromoOverlay();
  popup.hidden = false;
  const nodes = focusables(popup);
  if (nodes[0]) nodes[0].focus();
  popup.addEventListener('keydown', (event) => handleDialogKeydown(event, popup, () => closePromoPopup({ dismissed: true })));
}

function isPromoSuccessVisible() {
  const successNode = document.getElementById('promo-success');
  return Boolean(successNode && successNode.hidden === false);
}

function closePromoPopup({ dismissed = false, submitted = false } = {}) {
  const popup = document.getElementById('promo-popup');
  if (!popup) return;
  popup.hidden = true;
  hidePromoOverlay();
  if (promoFocusReturn && typeof promoFocusReturn.focus === 'function') {
    try { promoFocusReturn.focus(); } catch (_) {}
    promoFocusReturn = null;
  }
  if (dismissed) {
    try { sessionStorage.setItem(PROMO_DISMISSED_SESSION_KEY, '1'); } catch (_) {}
  }
  if (submitted) setLocalStorage(PROMO_SUBMITTED_KEY, '1');
}

function shouldShowPromo() {
  const popup = document.getElementById('promo-popup');
  if (!popup) return false;
  if (getLocalStorage(PROMO_SUBMITTED_KEY)) return false;
  try { if (sessionStorage.getItem(PROMO_DISMISSED_SESSION_KEY)) return false; } catch (_) {}
  return true;
}

function handlePromoIntersect(entries) {
  if (!shouldShowPromo()) return;
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      if (promoObserver) { promoObserver.disconnect(); promoObserver = null; }
      openPromoPopup();
    }
  });
}

function setupPromoObserver() {
  if (!shouldShowPromo()) return;
  const triggerDesktop = document.getElementById('promo-trigger-desktop');
  const triggerMobile = document.getElementById('promo-trigger-mobile');
  if (!triggerDesktop && !triggerMobile) return;
  if (promoObserver) return;
  const target = (promoMediaQuery && promoMediaQuery.matches) ? triggerMobile : triggerDesktop;
  if (!target) return;
  const opts = { root: null, threshold: 0.4 };
  promoObserver = new IntersectionObserver(handlePromoIntersect, opts);
  promoObserver.observe(target);
}

function teardownPromoObserver() {
  if (promoObserver) { promoObserver.disconnect(); promoObserver = null; }
}

function handlePromoResize() {
  if (!promoMediaQuery) return;
  teardownPromoObserver();
  if (!promoShown) setupPromoObserver();
}

function showCardError(message = "") {
  if (cardErrors) {
    cardErrors.textContent = message;
    cardErrors.hidden = !message;
  }
}

function resetCheckoutForm() {
  if (checkoutForm) checkoutForm.reset();
  leadState.leadId = null;
  leadState.isSubmitting = false;
  leadState.lastError = null;
  showCardError("");
  if (successPanel) successPanel.hidden = true;
  if (receiptLink) {
    receiptLink.href = "#";
    receiptLink.hidden = true;
  }
  if (squareCard && typeof squareCard.clear === "function") {
    try { squareCard.clear(); } catch (_) {}
  }
  setPayButtonLoading(false);
}

function getPayLabel() {
  const locale = state.lang === "fr" ? "fr-CA" : "en-CA";
  const verb = state.lang === "fr" ? "Payer" : "Pay";
  const subtotalCents = PRICE_CENTS || 0;
  const taxCents = Math.round(subtotalCents * getTaxRate());
  const totalCents = subtotalCents + taxCents;
  return `${verb} ${toMoney(totalCents, CURRENCY, locale)}`;
}

// --- Summary totals ---
function getTaxRate() {
  return typeof TAX_RATE === 'number' && Number.isFinite(TAX_RATE) ? TAX_RATE : 0;
}

function updateSummaryTotals() {
  const locale = state.lang === 'fr' ? 'fr-CA' : 'en-CA';
  const subtotalCents = PRICE_CENTS || 0;
  const rate = getTaxRate();
  const taxCents = Math.round(subtotalCents * rate);
  const totalCents = subtotalCents + taxCents;

  const elSubtotal = document.getElementById('summary-subtotal');
  const elTax = document.getElementById('summary-tax');
  const elTotal = document.getElementById('summary-total');
  if (elSubtotal) elSubtotal.textContent = toMoney(subtotalCents, CURRENCY, locale);
  if (elTax) elTax.textContent = toMoney(taxCents, CURRENCY, locale);
  if (elTotal) elTotal.textContent = toMoney(totalCents, CURRENCY, locale);
}

function attachSummaryListeners() {
  const country = document.getElementById('country');
  const state = document.getElementById('state');
  [country, state].forEach((el) => {
    if (!el || el.dataset.summaryBound === 'true') return;
    const handler = () => updateSummaryTotals();
    el.addEventListener('change', handler);
    el.addEventListener('input', handler);
    el.dataset.summaryBound = 'true';
  });
}

async function loadRemoteConfig() {
  if (configLoaded) return;
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/get-config`, { headers: { Accept: "application/json" } });
        if (response.ok) {
          const json = await response.json();
          if (json.squareApplicationId) SQUARE_APPLICATION_ID = json.squareApplicationId;
          if (json.squareLocationId) SQUARE_LOCATION_ID = json.squareLocationId;
          if (json.calendlyUrl) CALENDLY_URL = json.calendlyUrl;
          if (json.squareEnvironment) SQUARE_ENVIRONMENT = json.squareEnvironment;
          if (Number.isFinite(json.priceCents)) PRICE_CENTS = json.priceCents;
          if (json.currency) CURRENCY = json.currency;
          if (!Number.isNaN(json.taxRate)) TAX_RATE = Number(json.taxRate);
        } else {
          console.warn("get-config failed", response.status);
        }
      } catch (error) {
        console.error("Unable to load config", error);
      }
      configLoaded = true;
    })();
  }
  await configPromise;
}

async function loadSquareSdk() {
  const desiredEnv = SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production';

  if (squareSdkEnvironment && squareSdkEnvironment !== desiredEnv) {
    const existing = document.querySelector('script[data-square-sdk="true"]');
    if (existing) existing.remove();
    try { delete window.Square; } catch (_) { window.Square = undefined; }
    squareSdkPromise = null;
    squareCardAttached = false;
    squareCard = null;
    squarePayments = null;
  }

  if (!squareSdkPromise) {
    const scriptSrc = desiredEnv === 'sandbox'
      ? 'https://sandbox.web.squarecdn.com/v1/square.js'
      : 'https://web.squarecdn.com/v1/square.js';

    squareSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      script.dataset.squareSdk = 'true';
      script.onload = () => resolve(window.Square);
      script.onerror = () => reject(new Error('Square SDK failed to load'));
      document.head.appendChild(script);
    });
    squareSdkEnvironment = desiredEnv;
  }

  await squareSdkPromise;
  if (!window.Square?.payments) {
    throw new Error("Square Payments SDK unavailable");
  }
  return window.Square;
}

async function ensureSquareCard() {
  if (squareCard && squareCardAttached) return;
  if (!cardContainer) throw new Error("Payment form not ready");
  if (!SQUARE_APPLICATION_ID || !SQUARE_LOCATION_ID) {
    throw new Error(state.lang === "fr" ? "Configuration de paiement manquante. Réessayez." : "Payment configuration unavailable. Please try again.");
  }
  await loadSquareSdk();
  const envOption = { environment: SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production' };
  squarePayments = window.Square.payments(SQUARE_APPLICATION_ID, SQUARE_LOCATION_ID, envOption);
  if (!squarePayments) {
    throw new Error("Square payments unavailable");
  }
  squareCard = await squarePayments.card();
  await squareCard.attach(cardContainer);
  squareCardAttached = true;
}

function getLeadFormValues() {
  if (!checkoutForm) return {};
  const form = new FormData(checkoutForm);
  const normalise = (value) => (value || "").toString().trim();
  return {
    firstName: normalise(form.get("firstName")),
    lastName: normalise(form.get("lastName")),
    email: normalise(form.get("email")),
    phone: normalise(form.get("phone"))
  };
}

async function captureLead(values) {
  const payload = {
    email: values.email,
    firstName: values.firstName,
    lastName: values.lastName,
    phone: values.phone,
    audience: state.audience,
    language: state.lang,
    utm: state.utm,
    consentEmail: Boolean(values.consentEmail),
    consentSms: Boolean(values.consentSms)
  };

  const response = await fetch(`${API_BASE}/capture-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || (state.lang === "fr" ? "Impossible d’enregistrer vos informations." : "Unable to save your info."));
  }
  return json.leadId;
}

async function submitPayment(values, leadId, sourceId) {
  const payload = {
    leadId,
    sourceId,
    buyerEmail: values.email,
    buyerName: `${values.firstName} ${values.lastName}`.trim() || values.firstName || values.email,
    buyerPhone: values.phone,
    audience: state.audience,
    language: state.lang,
    utm: state.utm
  };

  const response = await fetch(`${API_BASE}/create-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || (state.lang === "fr" ? "Le paiement a échoué." : "Payment failed."));
  }
  return json;
}

function setPayButtonLoading(isLoading) {
  if (!modalPay) return;
  modalPay.disabled = Boolean(isLoading);
  modalPay.classList.toggle("is-loading", Boolean(isLoading));
  const label = modalPay.querySelector("span");
  if (!label) return;
  if (isLoading) {
    label.textContent = state.lang === "fr" ? "Traitement…" : "Processing…";
  } else if (successPanel?.hidden !== false) {
    label.textContent = getPayLabel();
  }
}

async function handleCheckoutSubmit() {
  if (!squareCard || leadState.isSubmitting) return;
  const values = getLeadFormValues();
  if (!values.email) {
    showCardError(state.lang === "fr" ? "Courriel requis." : "Email is required.");
    return;
  }
  showCardError("");
  leadState.isSubmitting = true;
  setPayButtonLoading(true);

  try {
    if (!leadState.leadId) {
      leadState.leadId = await captureLead(values);
    }
    const tokenResult = await squareCard.tokenize();
    if (tokenResult.status !== "OK") {
      throw new Error(tokenResult.errors?.[0]?.message || "Card tokenization failed");
    }
    const payment = await submitPayment(values, leadState.leadId, tokenResult.token);
    successPanel.hidden = false;
    if (receiptLink) {
      if (payment.receiptUrl) {
        receiptLink.href = payment.receiptUrl;
        receiptLink.hidden = false;
      } else {
        receiptLink.hidden = true;
      }
    }
    const label = modalPay.querySelector("span");
    if (label) label.textContent = state.lang === "fr" ? "Complété" : "Completed";
    modalPay.disabled = true;
    pfTrack("purchase", { lead_id: leadState.leadId, payment_id: payment.paymentId });
  } catch (error) {
    console.error("checkout error", error);
    leadState.lastError = error;
    showCardError(error.message || "Payment failed");
    setPayButtonLoading(false);
  } finally {
    leadState.isSubmitting = false;
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(target = {}, source = {}) {
  Object.keys(source).forEach((key) => {
    const srcVal = source[key];
    if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal)) {
      target[key] = deepMerge(target[key] || {}, srcVal);
    } else {
      target[key] = srcVal;
    }
  });
  return target;
}

function setText(el, text) {
  if (el && typeof text === "string") el.textContent = text;
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

const uiCopy = {
  en: {
    nav: { scheduleCall: "Schedule a call", buyNow: "Buy now" },
    modal: {
      title: "Starter Pack — Pre‑Checkout",
      subtitle: "Secure checkout — confirm your Starter Pack details.",
      paymentTitle: "Payment info",
      billingTitle: "Contact info",
      cardNumber: "Card number",
      cardExpiry: "Expiration date",
      cardCvv: "CVV",
      priceCaption: "One-time payment, taxes where applicable.",
      secureCopy: "Payments processed securely via Square.",
      cancel: "Cancel"
    },
    footer: { terms: "Terms", privacy: "Privacy" },
    noscript: "This site works best with JavaScript enabled for language and audience switching."
  },
  fr: {
    nav: { scheduleCall: "Planifier un appel", buyNow: "Acheter maintenant" },
    modal: {
      title: "Forfait de départ — Pré‑paiement",
      subtitle: "Paiement sécurisé — confirmez votre Starter Pack.",
      paymentTitle: "Informations de paiement",
      billingTitle: "Coordonnées",
      cardNumber: "Numéro de carte",
      cardExpiry: "Date d’expiration",
      cardCvv: "CVV",
      priceCaption: "Paiement unique, taxes en sus.",
      secureCopy: "Paiements traités en toute sécurité via Square.",
      cancel: "Annuler"
    },
    footer: { terms: "Conditions", privacy: "Confidentialité" },
    noscript: "Ce site fonctionne mieux avec JavaScript activé pour le changement de langue et d’audience."
  }
};

const copy = {
  en: {
    women: {
      meta: { offerName: "Stronger Than Yesterday Starter", heroImg: "assets/hero-women-stronger2.png" },
      hero: {
        headline: "<span class=\"hero-line-one\">Become <span class=\"hero-highlight\">Fitter</span>, <span class=\"hero-highlight\">Stronger</span></span><br>& More <span class=\"hero-highlight\">Confident</span><br><span class=\"hero-line-three\">In just <span class=\"hero-highlight\">60</span> minutes</span>",
        subhead: "Sign up today for guided classes from day one.\nFeel stronger by week four.\nBacked by a 100% money-back guarantee.",
        includes: [
          "1-on-1 welcome session to kick off with confidence",
          "Coach-led Glutes & Abs, Muscle Building, and recovery yoga",
          "2 Buddy Class Passes — bring a friend for motivation",
          "$75 Foundational Stack from Shop Santé + 10% anytime discount"
        ],
        primaryCTA: "<span class=\"hero-cta-line hero-cta-line--primary\">Start Today</span><span class=\"hero-cta-line hero-cta-line--secondary\">Become Stronger Than Yesterday</span>",
        secondaryCTA: "Chat with Rick"
      },
      problemFit: {
        title: "Why Most Workouts Don't Stick!",
        tiles: [
          "Meetings run late, dinners pop up, kids need rides → workouts skipped.",
          "No plan at the gym → wandering between machines, wasting time.",
          "Life gets busy → motivation fades → another month without results.",
          "You want to feel strong, but don't know where to start."
        ],
        conclusion: "Coffee helps mornings. Coaching helps momentum. Use both."
      },
      riskfreeSecondary: {
        title: "Try it completely risk-free!",
        lead: "Our promise to you. If after...",
        list: [
          "Completing your personal onboarding session",
          "Attending 10 classes in 30 days",
          "A quick 5-minute exit chat with Rick"
        ],
        guarantee: "👉 …you’re not 100% satisfied, we’ll refund every penny. No pushy retention tactics. No guilt trips. Just results — or your money back.",
        quote: "→ “We’re so confident you’ll love it, we’re taking all the risk off your shoulders.”",
        primaryCTA: "Try Us Risk Free",
        secondaryCTA: "Chat with Rick",
        media: {
          mobileVideo: "assets/Sophie-Rogan.mp4"
        }
      },
      valueSplit: {
        coreTitle: "Core Offer",
        coreValue: "$243 Value",
        core: [
          "Unlimited access to 40+ coached classes/week <span class=\"value-tag\">$139.99 value</span>",
          "1 Personal Training Onboarding (60 min) — dial in your plan fast <span class=\"value-tag\">$85 value</span>",
          "1 InBody scan at onboarding — know your baseline <span class=\"value-tag\">$18 value</span>",
          "7 formats — Glutes & Abs, Muscle Building, Bootcamp, Yoga and more",
          "Purposeful 60-minute sessions — warm-up, strength, finisher, done",
          "No overcrowding — space to move, equipment always ready",
          "Kid Zone access — bring the kids, lose the excuse. We got free WiFi."
        ],
        bonusTitle: "Built-In Bonuses",
        bonusValue: "$286 Value",
        bonuses: [
          "Coach Strategy Session — clarify goals & map your schedule",
          "2 Buddy Class Passes — bring a friend for motivation <span class=\"value-tag\">$36 value</span>",
          "1 InBody scan at Day 30 — measure the progress <span class=\"value-tag\">$18 value</span>",
          "Nutrition Toolkit — 3 guides (75 pages) + 3 recipe bundles with 9 meals each <span class=\"value-tag\">$118 value</span>",
          "Shop Santé $75 Foundational Stack — coach-approved fuel <span class=\"value-tag\">$75 value</span>",
          "Shop Santé 10% member perk — anytime savings on fuel <span class=\"value-tag\">Est. $40 value</span>"
        ],
        dealBubble: "",
        dealCTA: ""
      },
      guarantee: {
        title: "Try it completely risk-free",
        bullets: [
          "Cancel anytime within the first 30 days for a full refund.",
          "Friendly staff meets you where you’re at.",
          "Attend at least 10 classes during the 30 days to stay eligible."
        ],
        promise: "Show up, lean on our coaches, and you’ll feel stronger and more confident in 30 days.",
        quote: "",
        media: {
          type: "video",
          sources: {
            desktop: "assets/monic-oct-promo.mp4",
            mobile: "assets/monic-oct-promo.mp4"
          },
          poster: "assets/monic-oct-promo-poster.jpg",
          alt: "Monic sharing the Peak Fitness guarantee"
        }
      },
      testimonials: {
        title: "What members say",
        video: {
          mobile: "assets/Testimonial-With-Subs-compressed.mp4",
          desktop: "assets/Testimonial-Desktop-compressed.mp4"
        },
        items: []
      },
      timeline: {
        title: "Your First 12 Weeks at Peak Fitness",
        rows: [
          { title: "Day 1 (Welcome Session + InBody)", text: "Quick movement screen to gauge comfort, mobility, and any red flags—so you feel prepared for class. InBody gives a clear starting point. Coach suggests a simple mix (e.g., Muscle Building, Glutes & Abs, Recovery Yoga) that fits your week." },
          { title: "Days 2–3", text: "First two guided 60-minute classes. You get clear cues, safe ranges, and pace guidance—no wandering or guesswork. Soreness is normal; coach gives a quick recover-well recipe (walk + mobility + protein + sleep). You try a Buddy Pass for motivation and fun." },
          { title: "Days 4–7", text: "You find your “home” class times and feel less guilt about taking the hour—you’ve blocked it. Energy is steadier; sleep starts improving; soreness stays manageable." },
          { title: "Week 2", text: "Foundational patterns click (hinge, squat, push, pull, carry). You’re more confident choosing the right scale at each station." },
          { title: "Week 3", text: "You move through the room without overthinking. Coach nudges a small load or tempo change; work feels challenging but controlled." },
          { title: "Week 4", text: "Mornings run smoother; jeans fit a touch easier. Family notices you’re calmer and more present after class days." },
          { title: "Week 6", text: "Waist feels trimmer; stiffness eases. You notice you’re picking up slightly heavier weights or lasting longer on intervals—without joint drama." },
          { title: "Week 8", text: "Clothes sit better through the hips and shoulders; glutes look more defined. Compliments pop up at drop-off and in meetings. Confidence grows." },
          { title: "Week 10", text: "What used to feel like a “long day” is now doable. You’re lifting more than Week 1 and finishing with energy to spare." },
          { title: "Week 12", text: "The routine feels like part of your week instead of something you debate. You know the coaches, the cues, and the versions that work for your body—Stronger Than Yesterday is your new normal." }
        ],
        media: {
          src: "assets/timeline-womens.png",
          alt: "Woman celebrating her Week 12 progress at Peak Fitness"
        }
      },
      faq: {
        title: "Frequently asked questions",
        items: [
          { q: "I haven't worked out in years. Will I be able to keep up?", a: "Absolutely. Your 60-minute onboarding session ensures you start at YOUR level. You'll never feel lost or left behind." },
          { q: "How many times per week should I come?", a: "Sweet spot is 3× weekly, but you get unlimited access to all 40+ classes, so come as often as you like." },
          { q: "What if I need to cancel?", a: "After your 30-day Starter Pack, it's month-to-month. Cancel anytime. No contracts, no drama." },
          { q: "Can I bring a friend?", a: "Yes—ask about a buddy pass during onboarding." },
          { q: "When will I actually see results?", a: "Energy boost and better sleep within 14 days. Visible changes (clothes fitting better) by week 6. Friends asking ‘what are you doing differently?’ by week 8." },
          { q: "Where are you located?", a: "We are located at 688 Babin St, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Need directions?</a>" }
        ]
      }
    },
    men: {
      meta: { offerName: "Stronger Than Yesterday Starter", heroImg: "assets/hero-men-stronger.png" },
      hero: {
        headline: "Train smart. Move well. Get strong — again.",
        subhead: "Sign up today for guided classes from day one.\nFeel stronger by week four.\nBacked by a 100% money-back guarantee.",
        includes: [
          "Structured strength blocks — not random circuits",
          "Joint‑friendly coaching and injury‑aware scaling",
          "Lifts designed to boost your next game, match, or round"
        ],
        primaryCTA: "Train Smarter Today",
        secondaryCTA: "Connect with Rick, Peak Fitness Owner"
      },
      riskfreeSecondary: {
        title: "Try it completely risk-free!",
        lead: "Our promise to you. If after...",
        list: [
          "Completing your personal onboarding session",
          "Attending 10 classes in 30 days",
          "A quick 5-minute exit chat with Rick"
        ],
        guarantee: "👉 …you’re not 100% satisfied, we’ll refund every penny. No pushy retention tactics. No guilt trips. Just results — or your money back.",
        quote: "→ “We’re so confident you’ll love it, we’re taking all the risk off your shoulders.”",
        primaryCTA: "Try Us Risk Free",
        media: {
          image: "assets/timeline-mens-desktop.png",
          mobileVideo: "assets/Sophie-Rogan.mp4"
        }
      },
      problemFit: {
        title: "Why most programs stall out:",
        tiles: [
          "Random maxing → chronic tweaks.",
          "No plan → lose steam by week three.",
          "Bro-splits ignore mobility + conditioning.",
          "Solo training? Accountability fades fast."
        ],
        conclusion: "It's not about working harder. It's about working smarter with a plan that evolves as you do."
      },
      valueSplit: {
        coreTitle: "Core Offer",
        coreValue: "$407.94 Value",
        core: [
          "Unlimited access to 40+ coached classes/week",
          "7 formats — Glutes & Abs, Muscle Building, Bootcamp, Yoga and more",
          "Purposeful 60-minute sessions — warm-up, strength, finisher, done",
          "No overcrowding — space to move, equipment always ready",
          "Kid Zone access — bring the kids, lose the excuse. We got free WiFi."
        ],
        bonusTitle: "Built-In Bonuses (Included Free)",
        bonuses: [
          "1 Personal Training Onboarding (60 min) — perfect your form & create your plan",
          "2 Buddy Class Passes — bring a friend for motivation",
          "2 InBody scans — one at onboarding, another at Day 30",
          "Nutrition Toolkit — Meal Guide, 27 macro recipes, 22p Calorie Guide + cheat sheet, 46p Eat Well Anywhere Guide."
        ],
        dealBubble: "",
        dealCTA: ""
      },
      guarantee: {
        title: "Try it risk-free",
        bullets: [
          "Full refund in the first 30 days if it’s not for you.",
          "Coach-led environment keeps you safe.",
          "Attend at least 10 classes during the 30 days to stay eligible." ],
        promise: "You’ll feel stronger, move better, and train smarter in 30 days or your money back.",
        quote: "“Stronger than Day 1 or your money back.”",
        media: {
          src: "assets/riskfree-mens.png",
          alt: "Man training with coach risk-free"
        }
      },
      testimonials: {
        title: "What members say",
        video: {
          mobile: "assets/Testimonial-With-Subs-compressed.mp4",
          desktop: "assets/Testimonial-Desktop-compressed.mp4"
        },
        items: []
      },
      timeline: {
        title: "Your first 12 weeks",
        rows: [
          { title: "Day 1–3", text: "Baseline testing shows what slipped; joints already feel better with dialed warm-ups." },
          { title: "Day 4–7", text: "Bar path smooths out, nagging shoulder/hip tightness eases, confidence returns." },
          { title: "Week 2", text: "5–10% strength bump, conditioning finishers no longer gas you out at work." },
          { title: "Week 4", text: "Mobility carries into sport—swings, shots, and lifts feel crisp with zero flare-ups." },
          { title: "Week 6", text: "Waistline down, belt notches tighten, InBody shows lean muscle climbing." },
          { title: "Week 8", text: "Game speed improves—pickup runs, golf rounds, or matches feel explosive again." },
          { title: "Week 10", text: "Busy weeks stay on track; recovery score better, no missed sessions, stress stays low." },
          { title: "Week 12", text: "Numbers jump ~20 lb across big lifts, confident to attack the next strength block." }
        ],
        media: {
          src: "assets/timeline-mens.png",
          alt: "Male athlete hitting Week 12 performance strides at Peak Fitness"
        }
      },
      faq: {
        title: "Frequently asked questions",
        items: [
          { q: "Will I lose strength doing conditioning?", a: "No. We build strength-first sessions with conditioning that supports it." },
          { q: "I’ve been lifting for years—will this be challenging?", a: "Yes. You’ll get progressions that push you without wrecking your joints." },
          { q: "Do I have to track macros?", a: "Only if you want. We focus on simple habits to fuel performance." },
          { q: "Can I train open gym?", a: "Yes. Starter Pack includes open gym access." },
          { q: "What does the refund cover?", a: "Attend, follow the plan. If you’re not happy inside 30 days, you get a refund." },
          { q: "Is this just CrossFit?", a: "It’s coach-led functional training with strength bias, built for longevity." },
          { q: "Where are you located?", a: "We are located at 688 Babin St, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Need directions?</a>" }
        ]
      }
    },
    youth: {
      meta: { offerName: "Stronger Than Yesterday Starter", heroImg: "assets/hero-youth-stronger.png" },
      hero: {
        headline: "Stand out at tryouts. Build speed, strength, and confidence.",
        subhead: "Sign up today for guided classes from day one.\nFeel stronger by week four.\nBacked by a 100% money-back guarantee.",
        includes: [
          "Performance testing and benchmark reports",
          "Coach‑led strength + speed sessions",
          "Parent updates and a clear development plan"
        ],
        primaryCTA: "Start Your 30‑Day Prep",
        secondaryCTA: "Connect with Rick, Peak Fitness Owner"
      },
      riskfreeSecondary: {
        title: "Try it completely risk-free!",
        lead: "Our promise to you. If after...",
        list: [
          "Completing your personal onboarding session",
          "Attending 10 classes in 30 days",
          "A quick 5-minute exit chat with Rick"
        ],
        guarantee: "👉 …you’re not 100% satisfied, we’ll refund every penny. No pushy retention tactics. No guilt trips. Just results — or your money back.",
        quote: "→ “We’re so confident you’ll love it, we’re taking all the risk off your shoulders.”",
        primaryCTA: "Try Us Risk Free",
        media: {
          image: "assets/timeline-youth-desktop.png",
          mobileVideo: "assets/Peak-Fitness-Athletics.mp4"
        }
      },
      problemFit: {
        title: "Why most youth plans fall short:",
        tiles: [
          "Random drills → no measurable progress.",
          "Too much, too soon → burnout.",
          "No strength base → limited speed gains.",
          "Generic apps ignore real coaching."
        ],
        conclusion: "It's not about training harder than everyone else. It's about training smarter with a plan that grows with you."
      },
      valueSplit: {
        coreTitle: "Core Offer",
        coreValue: "$407.94 Value",
        core: [
          "Coach-led athletic development sessions (2-3x / week)",
          "Baseline testing + video feedback",
          "Strength, power, and speed programming",
          "Coach check-ins with athlete + parent"
        ],
        bonusTitle: "Built-In Bonuses (Included Free)",
        bonuses: [
          "Game-day warm-up blueprint",
          "Mobility homework filmed for at-home use",
          "Confidence + leadership micro-huddles",
          "End-of-month progress debrief"
        ],
        dealBubble: "65.7% Off!",
        dealCTA: "Reserve a spot"
      },
      guarantee: {
        title: "Risk-free for athletes & parents",
        bullets: [
          "Full refund inside 30 days if expectations aren’t met.",
          "Keep testing data + action plan even if you cancel.",
          "Safe, coached environment with small ratios." ],
        promise: "We build stronger, faster, more confident athletes in 30 days or you don’t pay.",
        quote: "“Confidence shows up when structure meets effort.”",
        media: {
          src: "assets/riskfree-youth.png",
          alt: "Smiling youth athlete in Risk-Free guarantee"
        }
      },
      testimonials: {
        title: "What parents + athletes say",
        items: [
          { quote: "Coach accountability and fun. My son can’t wait to go.", name: "Parent — K. Martin" },
          { quote: "Faster on the ice and more confident in games.", name: "U15 Athlete" },
          { quote: "Safe environment with real coaching.", name: "Parent — S. LeBlanc" }
        ]
      },
      timeline: {
        title: "Your first 12 weeks",
        rows: [
          { title: "Day 1–3", text: "Performance testing and welcome lift show exactly where you stand; big relief that the plan fits school and sport." },
          { title: "Day 4–7", text: "Speed drills + strength sessions boost confidence; soreness stays light thanks to coaching." },
          { title: "Week 2", text: "Acceleration and change-of-direction times drop; parents see posture and focus improve." },
          { title: "Week 4", text: "Game-day warm-ups feel automatic; power numbers climb with no burnout." },
          { title: "Week 6", text: "Stronger plays and quicker shifts; testing shows clear strength and speed gains." },
          { title: "Week 8", text: "Confidence shows up in school and sport; coaches notice hustle and form." },
          { title: "Week 10", text: "Stay consistent through exams and travel; recovery and sleep stay dialed." },
          { title: "Week 12", text: "Athlete hits new PRs, parents get clear next steps, and the season has a plan." }
        ],
        media: {
          src: "assets/timeline-youth.png",
          alt: "Youth athlete celebrating Week 12 gains with coaches"
        }
      },
      faq: {
        title: "Frequently asked questions",
        items: [
          { q: "What ages do you coach?", a: "We group athletes roughly 11–17 and keep ratios low for quality coaching." },
          { q: "Is this sport-specific?", a: "We tailor drills toward hockey, field, court and adjust based on the athlete." },
          { q: "Do parents need to stay?", a: "No, but we love having you watch first sessions." },
          { q: "How do you handle injuries?", a: "We scale movements, communicate with parents, and progress safely." },
          { q: "Will this conflict with team practices?", a: "We plan around in-season schedules so athletes stay fresh." },
          { q: "Do girls train separately?", a: "We offer mixed and girls-only times—ask about the best fit." },
          { q: "Where are you located?", a: "We are located at 688 Babin St, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Need directions?</a>" }
        ]
      }
    },
    neutral: {
      meta: { offerName: "30-Day Starter Pack", heroImg: "assets/hero-neutral.svg" },
      hero: {
        headline: "Get 65% OFF Your First Month — Start strong in 30 days",
        subhead: "Coached sessions, clear plan, steady progress.",
        totalLabel: "Total Value",
        priceLabel: "YOUR PRICE:",
        saveLabel: "You Save",
        value: { total: "$407.94", price: "$139.99", save: "$267.95" },
        includesTitle: "Starter Pack Includes",
        includes: [
          "All-access for 30 days",
          "1-on-1 onboarding (60 min)",
          "InBody scan + nutrition checklist",
          "Open gym access"
        ],
        primaryCTA: "Join Now — $139.99",
        secondaryCTA: "Schedule a call"
      },
      problemFit: {
        title: "Why most plans fail:",
        tiles: ["No structure", "No coaching", "Random circuits", "No tracking"],
        conclusion: "It's not that you don't care. It's that you don't have a clear, coached plan that fits your busy life."
      },
      valueSplit: {
        coreTitle: "Core Offer",
        coreValue: "$407.94 Value",
        core: [
          "Coach-led sessions up to 5x per week",
          "Personalized plan after onboarding",
          "InBody scan + progress tracking",
          "Weekly accountability check-ins"
        ],
        bonusTitle: "Built-In Bonuses (Included Free)",
        bonuses: [
          "Nutrition checklist",
          "Form feedback",
          "Recovery tools access",
          "Goal reset at Day 21"
        ],
        dealBubble: "65.7% Off!",
        dealCTA: "Claim your spot"
      },
      guarantee: {
        title: "Try it risk-free",
        bullets: [
          "Cancel within 30 days for a full refund.",
          "Keep your plan and checklists even if you cancel.",
          "Supportive staff, zero judgment." ],
        promise: "You’ll feel stronger, clearer, and more confident in 30 days or your money back.",
        quote: "“Structure creates results. We bring both.”",
        primaryCTA: "Start risk-free today",
        secondaryCTA: "Talk with Rick"
      },
      testimonials: {
        title: "What members say",
        items: [
          { quote: "Finally consistent after years of stopping and starting.", name: "Chris P." },
          { quote: "The plan is simple but powerful. Love the community.", name: "Taylor H." },
          { quote: "Accountability made the difference for me.", name: "Jordan L." }
        ]
      },
      timeline: {
        title: "Your first 30 days",
        rows: [
          { title: "Day 1–7", text: "Onboarding, personalized plan, first wins." },
          { title: "Day 14", text: "Confidence, strength and habits stacking." },
          { title: "Day 30", text: "Momentum locked in with a plan to continue." }
        ]
      },
      faq: {
        title: "Frequently asked questions",
        items: [
          { q: "Do I need experience?", a: "No experience needed—every session is coached." },
          { q: "Can I cancel anytime?", a: "Yes—full refund in the first 30 days." },
          { q: "Is there nutrition help?", a: "Yes—simple checklist and coaching." },
          { q: "What happens after 30 days?", a: "You can continue with a membership that fits you." },
          { q: "Do you offer different class times?", a: "Yes—morning, lunch, evening, and weekend options." },
          { q: "Is this accessible if I’m injured?", a: "Coaches scale everything to your abilities." }
        ]
      }
    }
  },
  fr: {
    women: {
      meta: { offerName: "Starter Stronger Than Yesterday", heroImg: "assets/hero-women-stronger2.png" },
      hero: {
        headline: "<span class=\"hero-line-one\">Deviens <span class=\"hero-highlight\">plus en forme</span>, <span class=\"hero-highlight\">plus forte</span></span><br>et plus <span class=\"hero-highlight\">confiante</span><br><span class=\"hero-line-three\">En seulement <span class=\"hero-highlight\">60</span> minutes</span>",
        subhead: "Inscris-toi aujourd’hui à des cours coachés dès le jour 1.\nSens-toi plus forte dès la quatrième semaine.\nGarantie de remboursement 100 %.",
        includes: [
          "Séance d’accueil 1:1 pour partir confiante",
          "Cours coachés Glutes & Abs, Musculation et yoga de récupération",
          "2 laissez-passer Buddy — amène une amie pour la motivation"
        ],
        primaryCTA: "<span class=\"hero-cta-line hero-cta-line--primary\">Commencer aujourd’hui</span><span class=\"hero-cta-line hero-cta-line--secondary\">Deviens plus forte qu’hier</span>",
        secondaryCTA: "Jaser avec Rick"
      },
      problemFit: {
        title: "Pourquoi la plupart des entraînements ne collent pas !",
        tiles: [
          "Les rencontres s’étirent, un souper de dernière minute, taxi pour les kids → l’entraînement saute.",
          "Pas de plan au gym → on erre entre les machines pis on perd notre heure.",
          "La vie roule vite → la motivation descend → un autre mois sans progrès.",
          "Tu veux te sentir forte, mais tu ne sais pas trop par où commencer."
        ],
        conclusion: "Le café part la journée. Le coaching garde l’élan. Prends les deux."
      },
      riskfreeSecondary: {
        title: "Essaie-le complètement sans risque !",
        lead: "Notre promesse pour toi. Si après…",
        list: [
          "Avoir complété ta séance d’accueil personnalisée",
          "Avoir assisté à 10 cours en 30 jours",
          "Avoir pris 5 minutes pour jasette de sortie avec Rick"
        ],
        guarantee: "👉 …t’es pas 100 % satisfaite, on te rembourse chaque sou. Pas de tactiques plates. Pas de culpabilité. Juste des résultats — ou ton argent revient.",
        quote: "→ « On est tellement certaines que tu vas aimer ça qu’on prend tout le risque pour toi. »",
        primaryCTA: "Essaie-nous sans risque",
        secondaryCTA: "Jaser avec Rick",
        media: {
          mobileVideo: "assets/Sophie-Rogan.mp4"
        }
      },
      valueSplit: {
        coreTitle: "Offre principale",
        coreValue: "Valeur de 407,94 $",
        core: [
          "Accès illimité à 40+ cours coachés par semaine",
          "7 formats — Glutes & Abs, Musculation, Bootcamp, Yoga et plus encore",
          "Séances de 60 minutes bien structurées — warm-up, force, finisher, c’est réglé",
          "Aucun encombrement — de l’espace pour bouger, équipement prêt quand t’arrives",
          "Zone Kid — amène les enfants, finis les excuses. Wi-Fi gratuit."
        ],
        bonusTitle: "Bonus (inclus gratuits)",
        bonuses: [
          "1 séance d’onboarding privée (60 min) — ajuste ta technique et bâtis ton plan",
          "2 laissez-passer Buddy — amène une amie pour la motivation",
          "2 analyses InBody — une à l’accueil, une au jour 30",
          "Nutrition Toolkit — Guide repas, 27 recettes macro, guide calories 22 p + aide-mémoire, guide Manger bien partout 46 p."
        ],
        dealBubble: "",
        dealCTA: ""
      },
      guarantee: {
        title: "Essaie-nous complètement sans risque",
        bullets: [
          "Annule n’importe quand dans les 30 premiers jours pour un remboursement complet.",
          "L’équipe t’accueille où tu es, sans jugement.",
          "Fais au moins 10 cours dans les 30 jours pour rester admissible."
        ],
        promise: "Présente-toi, appuie-toi sur nos coachs et, en 30 jours, tu te sens plus forte et plus confiante.",
        quote: "« On gère la structure, tu amènes l’effort. »",
        media: {
          type: "video",
          sources: {
            desktop: "assets/monic-oct-promo.mp4",
            mobile: "assets/monic-oct-promo.mp4"
          },
          poster: "assets/monic-oct-promo-poster.jpg",
          alt: "Monic qui explique la garantie Peak Fitness"
        }
      },
      testimonials: {
        title: "Ce que les membres racontent",
        video: {
          mobile: "assets/Testimonial-With-Subs-compressed.mp4",
          desktop: "assets/Testimonial-Desktop-compressed.mp4"
        },
        items: []
      },
      timeline: {
        title: "Tes 12 premières semaines chez Peak Fitness",
        rows: [
          { title: "Jour 1 (Séance d’accueil + InBody)", text: "Mini bilan de mouvements pour voir comment tu te sens, la mobilité et les zones sensibles — tu arrives prête en classe. InBody te donne un point de départ clair. Le coach te propose un mix simple (p. ex. Musculation, Glutes & Abs, Yoga récup) qui fitte dans ta semaine." },
          { title: "Jours 2–3", text: "Deux premiers cours guidés de 60 minutes. Cues clairs, amplitudes sécuritaires, rythme coaché — fini l’impro. Les courbatures sont normales; le coach te donne sa recette récup (marche + mobilité + protéine + sommeil). Tu profites d’un laissez-passer Buddy pour la motivation." },
          { title: "Jours 4–7", text: "Tu bloques tes plages horaires “maison” sans culpabilité. L’énergie se stabilise, le sommeil s’améliore, les courbatures restent gérables." },
          { title: "Semaine 2", text: "Les patrons de base collent (hinge, squat, push, pull, carry). Tu choisis mieux ton niveau à chaque station." },
          { title: "Semaine 3", text: "Tu circules dans la salle sans suranalyser. Le coach suggère une petite charge ou un tempo différent; l’effort est challengeant mais contrôlé." },
          { title: "Semaine 4", text: "Les matins roulent mieux; les jeans glissent un brin plus facile. La famille remarque que t’es plus calme et présente après les cours." },
          { title: "Semaine 6", text: "La taille s’affine; les raideurs lâchent prise. Tu lèves un peu plus lourd ou tu tiens plus longtemps les intervalles — sans drame articulaire." },
          { title: "Semaine 8", text: "Les vêtements tombent mieux aux hanches et aux épaules; les fessiers se dessinent. Les compliments partent à l’école et au bureau. Confiance en hausse." },
          { title: "Semaine 10", text: "Ce qui était une “longue journée” devient faisable. Tu lèves plus qu’en semaine 1 et tu finis avec de l’énergie en réserve." },
          { title: "Semaine 12", text: "La routine fait partie de ta semaine au lieu d’un débat. Tu connais les coachs, les cues et les variantes qui fittent pour ton corps — Stronger Than Yesterday devient ton nouveau normal." }
        ],
        media: {
          src: "assets/timeline-womens.png",
          alt: "Membre qui célèbre ses progrès à la semaine 12 chez Peak Fitness"
        }
      },
      faq: {
        title: "Questions posées souvent",
        items: [
          { q: "Ça fait des années que je ne me suis pas entraînée. Est-ce que je vais suivre?", a: "Oui. Ta séance d’intégration de 60 minutes t’amène exactement à ton niveau. Jamais perdue, jamais laissée derrière." },
          { q: "Combien de fois par semaine devrais-je venir?", a: "L’idéal c’est 3 fois semaine, mais t’as accès illimité à nos 40+ cours — viens aussi souvent que tu veux." },
          { q: "Qu’est-ce qui arrive si je dois annuler?", a: "Après ton Starter de 30 jours, c’est du mois à mois. Tu annules quand tu veux, sans contrat ni chicane." },
          { q: "Puis-je amener une amie?", a: "Oui ! On te remet un laissez-passer Buddy pendant l’intégration." },
          { q: "Quand est-ce que je vais voir des résultats pour vrai?", a: "Boost d’énergie et meilleur sommeil en 14 jours. À la semaine 6, tes vêtements tombent mieux. À la semaine 8, le monde te demande ce que tu fais de différent." },
          { q: "Où êtes-vous situés?", a: "On est au 688 rue Babin, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Besoin d’itinéraire?</a>" }
        ]
      }
    },
    men: {
      meta: { offerName: "Starter Stronger Than Yesterday", heroImg: "assets/hero-men-stronger.png" },
      hero: {
        headline: "Entraînez intelligent. Bougez bien. Redevenez fort.",
        subhead: "Un coaching qui remplace les routines aléatoires par une force fiable — au travail, à la maison, dans votre sport. Des blocs structurés, des progressions respectueuses des articulations et un coaching approuvé par des athlètes de haut niveau.",
        includes: [
          "Blocs de force structurés — pas de circuits aléatoires",
          "Coaching respectueux des articulations et ajustements selon blessures",
          "Des levées pensées pour hausser votre prochain match, partie ou ronde"
        ],
        primaryCTA: "M’entraîner plus intelligemment aujourd’hui",
        secondaryCTA: "Parler à Rick, propriétaire de Peak Fitness"
      },
      problemFit: {
        title: "Pourquoi les programmes stagnent :",
        tiles: [
          "Max aléatoires → blessures qui reviennent.",
          "Pas de plan → l’élan disparaît à la 3e semaine.",
          "Programmes bros ignorent mobilité + cardio.",
          "Seul? L’accountability disparaît vite."
        ],
        conclusion: "Il ne s'agit pas de travailler plus fort, mais de travailler plus intelligemment avec un plan qui évolue avec vous."
      },
      valueSplit: {
        coreTitle: "Offre principale",
        coreValue: "Valeur de 407,94 $",
        core: [
          "Accès illimité à 40+ cours coachés/semaine",
          "7 formats — Glutes & Abs, Musculation, Bootcamp, Yoga et plus encore",
          "Sessions de 60 minutes bien dosées — échauffement, force, finisher, c’est fait",
          "Zéro encombrement — de l’espace pour bouger, équipement toujours prêt",
          "Accès Kid Zone — amène les enfants, finis les excuses. Wi-Fi gratuit inclus."
        ],
        bonusTitle: "Bonis inclus (gratuits)",
        bonuses: [
          "1 séance d’onboarding privée (60 min) — perfectionne ta forme et bâtis ton plan",
          "2 laissez-passer Buddy — amène une amie pour la motivation",
          "2 analyses InBody — une à l’onboarding, une au jour 30"
        ],
        dealBubble: "",
        dealCTA: ""
      },
      guarantee: {
        title: "Essayez sans risque",
        bullets: [
          "Remboursement si vous n’êtes pas satisfait dans les 30 jours.",
          "Coach présent pour garder vos articulations heureuses.",
          "Participez à au moins 10 cours durant les 30 jours pour rester admissible." ],
        promise: "Plus fort, mieux bouger, plus intelligent en 30 jours ou remboursé.",
        quote: "« Plus fort qu’au Jour 1 ou remboursé. »",
        media: {
          src: "assets/riskfree-mens.png",
          alt: "Athlète masculin profitant de la garantie sans risque"
        }
      },
      testimonials: {
        title: "Ce que disent nos membres",
        video: {
          mobile: "assets/Testimonial-With-Subs-compressed.mp4",
          desktop: "assets/Testimonial-Desktop-compressed.mp4"
        },
        items: []
      },
      timeline: {
        title: "Vos 12 premières semaines",
        rows: [
          { title: "Jour 1–3", text: "Tests de base révèlent ce qui a glissé; articulations soulagées grâce aux échauffements ciblés." },
          { title: "Jour 4–7", text: "Trajectoire de la barre plus fluide, épaules/hanches moins raides, confiance retrouvée." },
          { title: "Semaine 2", text: "+5 à 10 % de force, finisseurs cardio ne t’épuisent plus au travail." },
          { title: "Semaine 4", text: "Mobilité qui suit; swings, frappes et levées plus nettes sans flare-ups." },
          { title: "Semaine 6", text: "Tour de taille réduit, ceinture resserrée, InBody confirme la masse maigre en hausse." },
          { title: "Semaine 8", text: "Vitesse de jeu améliorée — hockey pick-up, golf ou matchs explosifs de nouveau." },
          { title: "Semaine 10", text: "Semaines chargées maîtrisées : récupération stable, aucune séance manquée, stress mieux géré." },
          { title: "Semaine 12", text: "+9 kg (~20 lb) sur les gros lifts, prêt pour le prochain bloc de force." }
        ]
      },
      faq: {
        title: "Questions fréquentes",
        items: [
          { q: "Vais-je perdre de la force en faisant du conditionnement?", a: "Non. Nous construisons la force d’abord et gardons le cardio au service de vos gains." },
          { q: "C’est assez difficile pour un lifter expérimenté?", a: "Oui. Vous aurez des progressions qui vous poussent sans vous blesser." },
          { q: "Dois-je suivre mes macros?", a: "Seulement si vous le souhaitez. On mise sur des habitudes simples." },
          { q: "Puis-je utiliser le gym libre?", a: "Oui. L’accès gym libre est inclus." },
          { q: "Comment fonctionne le remboursement?", a: "Présentez-vous, suivez le plan. Si vous n’êtes pas satisfait avant 30 jours, on vous rembourse." },
          { q: "Est-ce juste du CrossFit?", a: "C’est un entraînement fonctionnel coaché, centré sur la force et la longévité." },
          { q: "Où êtes-vous situés?", a: "Nous sommes situés au 688 rue Babin, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Besoin d’itinéraire?</a>" }
        ]
      }
    },
    youth: {
      meta: { offerName: "Starter Stronger Than Yesterday", heroImg: "assets/hero-youth-stronger.png" },
      hero: {
        headline: "Démarque‑toi aux sélections. Plus de vitesse, de force et de confiance.",
        subhead: "Phase de 30 jours avec tests de performance, coaching force + vitesse et rapports clairs pour les parents — sécuritaire, structuré et pertinent pour le hockey.",
        includes: [
          "Tests de performance + rapports de repères",
          "Séances coachées force + vitesse",
          "Mises à jour parent et plan de développement clair"
        ],
        primaryCTA: "Commencer ta préparation 30 jours",
        secondaryCTA: "Parler à Rick, propriétaire de Peak Fitness"
      },
      problemFit: {
        title: "Pourquoi les programmes jeunesse échouent :",
        tiles: [
          "Exercices au hasard → aucun progrès mesurable.",
          "Trop, trop vite → surmenage.",
          "Sans base de force → vitesse limitée.",
          "Apps génériques → pas de coaching réel."
        ],
        conclusion: "Il ne s'agit pas de t'entraîner plus fort que les autres, mais de t'entraîner plus intelligemment avec un plan qui grandit avec toi."
      },
      valueSplit: {
        coreTitle: "Offre principale",
        coreValue: "Valeur de 407,94 $",
        core: [
          "Séances de développement athlétique coachées",
          "Tests de base + rétroaction vidéo",
          "Programme force, puissance et vitesse",
          "Suivi hebdo avec parents et athlète"
        ],
        bonusTitle: "Bonis inclus (gratuits)",
        bonuses: [
          "Routine d’échauffement jour de match",
          "Devoirs mobilité avec vidéos",
          "Micro-huddles sur la confiance",
          "Bilan de progression fin de mois"
        ],
        dealBubble: "65,7 % de rabais!",
        dealCTA: "Réserver la place"
      },
      guarantee: {
        title: "Sans risque pour athlètes et parents",
        bullets: [
          "Remboursement complet dans les 30 jours si les attentes ne sont pas atteintes.",
          "Gardez les données de tests et le plan d’action même en annulant.",
          "Environnement sécuritaire avec ratio coach/athlète réduit." ],
        promise: "On construit des athlètes plus rapides, plus forts et confiants en 30 jours ou c’est gratuit.",
        quote: "« La confiance arrive quand la structure rencontre l’effort. »",
        media: {
          src: "assets/riskfree-youth.png",
          alt: "Jeune athlète souriant pour la garantie sans risque"
        }
      },
      testimonials: {
        title: "Témoignages",
        items: [
          { quote: "Encadrement et plaisir. Mon fils a hâte à chaque séance.", name: "Parent — K. Martin" },
          { quote: "Plus rapide sur la glace et plus confiant.", name: "Athlète U15" },
          { quote: "Environnement sécuritaire, coachs excellents.", name: "Parent — S. LeBlanc" }
        ]
      },
      timeline: {
        title: "Vos 30 premiers jours",
        rows: [
          { title: "Jour 1–7", text: "Tests, fondations de mouvement, confiance." },
          { title: "Jour 14", text: "Force + vitesse en progression. Drills adaptés au sport." },
          { title: "Jour 30", text: "Gains visibles + plan pour la suite." }
        ]
      },
      faq: {
        title: "Questions fréquentes",
        items: [
          { q: "Quel âge ciblez-vous?", a: "Nous accueillons principalement les 11–17 ans et gardons de petits groupes." },
          { q: "Est-ce spécifique à un sport?", a: "Oui, on adapte selon hockey, terrain, court et le profil de l’athlète." },
          { q: "Les parents doivent-ils rester?", a: "Pas obligatoire, mais vous êtes les bienvenus pour observer." },
          { q: "Comment gérez-vous les blessures?", a: "On adapte, communique avec les parents et progresse graduellement." },
          { q: "Est-ce que ça entre en conflit avec les pratiques?", a: "On planifie selon l’horaire en saison pour garder l’énergie." },
          { q: "Offrez-vous des groupes filles?", a: "Oui, séances mixtes et groupes filles selon la demande." },
          { q: "Où êtes-vous situés?", a: "Nous sommes situés au 688 rue Babin, Dieppe. <a href=\"https://google.com/maps/place/Peak+Fitness+Dieppe/data=!4m2!3m1!1s0x0:0x4be37514b9988700?sa=X&ved=1t:2428&ictx=111\" target=\"_blank\" rel=\"noopener\">Besoin d’itinéraire?</a>" }
        ]
      }
    },
    neutral: {
      meta: { offerName: "Forfait de 30 jours", heroImg: "assets/hero-neutral.svg" },
      hero: {
        headline: "Obtenez 65 % de rabais sur le premier mois — Démarrez fort en 30 jours",
        subhead: "Séances coachées, plan clair, progrès constants.",
        totalLabel: "Valeur totale",
        priceLabel: "VOTRE PRIX :",
        saveLabel: "Vous économisez",
        value: { total: "407,94 $", price: "139,99 $", save: "267,95 $" },
        includesTitle: "Le forfait comprend",
        includes: [
          "Accès complet 30 jours",
          "Intégration 1‑à‑1 (60 min)",
          "Analyse InBody + liste nutrition",
          "Accès gym libre"
        ],
        primaryCTA: "Je m’inscris — 139,99 $",
        secondaryCTA: "Planifier un appel"
      },
      problemFit: {
        title: "Pourquoi les plans échouent :",
        tiles: ["Pas de structure", "Pas de coaching", "Séances aléatoires", "Aucun suivi"]
      },
      valueSplit: {
        coreTitle: "Offre principale",
        coreValue: "Valeur de 407,94 $",
        core: [
          "Séances coachées jusqu’à 5x semaine",
          "Plan personnalisé après l’intégration",
          "Analyse InBody + suivi",
          "Check-in accountability hebdomadaire"
        ],
        bonusTitle: "Bonis inclus (gratuits)",
        bonuses: [
          "Liste nutrition",
          "Corrections de mouvements",
          "Accès outils récupération",
          "Révision d’objectifs au jour 21"
        ],
        dealBubble: "65,7 % de rabais!",
        dealCTA: "Réserver ma place"
      },
      guarantee: {
        title: "Essayez sans risque",
        bullets: [
          "Annulez dans les 30 jours pour un remboursement complet.",
          "Gardez votre plan même en annulant.",
          "Équipe supportive, aucun jugement." ],
        promise: "Plus de force, de clarté et de confiance en 30 jours ou remboursé.",
        quote: "« La structure crée les résultats. On vous offre les deux. »",
        primaryCTA: "Commencer sans risque aujourd’hui",
        secondaryCTA: "Discuter avec Rick"
      },
      testimonials: {
        title: "Ce que disent nos membres",
        items: [
          { quote: "Enfin constante après des années d’essais.", name: "Chris P." },
          { quote: "Plan simple, puissant. Communauté géniale.", name: "Taylor H." },
          { quote: "L’accountability a fait toute la différence.", name: "Jordan L." }
        ]
      },
      timeline: {
        title: "Vos 30 premiers jours",
        rows: [
          { title: "Jour 1–7", text: "Intégration, plan personnalisé, premières victoires." },
          { title: "Jour 14", text: "Confiance, force et habitudes en montée." },
          { title: "Jour 30", text: "Momentum solide et plan pour continuer." }
        ]
      },
      faq: {
        title: "Questions fréquentes",
        items: [
          { q: "Ai-je besoin d’expérience?", a: "Non, chaque séance est coachée." },
          { q: "Puis-je annuler quand je veux?", a: "Oui, remboursement complet dans les 30 jours." },
          { q: "Offrez-vous du soutien nutritionnel?", a: "Oui, une liste simple et du coaching d’habitudes." },
          { q: "Après 30 jours?", a: "Vous continuez avec le plan qui vous convient." },
          { q: "Horaire flexible?", a: "Oui, matin, midi, soir, weekend." },
          { q: "Et si j’ai une blessure?", a: "On adapte chaque mouvement à votre réalité." }
        ]
      }
    }
  }
};

const youthVariants = {
  en: {
    committed: { hero: { headline: "Serious about the season? Build your edge in 30 days", subhead: "Strength + speed + accountability. Show up—level up." } },
    parent:    { hero: { headline: "Safe, coached training for your athlete", subhead: "Small groups, progress tracking, and a welcoming vibe." } },
    identity:  { hero: { headline: "Stronger body. Stronger identity.", subhead: "Confidence grows when structure meets effort." } },
    female:    { hero: { headline: "Strong girls. Strong futures.", subhead: "Coached training in a supportive, respectful environment." } }
  },
  fr: {
    committed: { hero: { headline: "Sérieux(se) pour la saison? Bâtissez votre avantage en 30 jours", subhead: "Force + vitesse + accountability. Présentez-vous—progressez." } },
    parent:    { hero: { headline: "Entraînement encadré et sécuritaire pour votre jeune", subhead: "Petits groupes, suivi de progrès et ambiance chaleureuse." } },
    identity:  { hero: { headline: "Corps plus fort. Identité plus forte.", subhead: "La confiance grandit quand structure et effort se rencontrent." } },
    female:    { hero: { headline: "Jeunes filles fortes. Avenir solide.", subhead: "Coaching dans un environnement respectueux et soutenant." } }
  }
};

const state = {
  audience: getAudience(),
  variant: getVariant(),
  lang: getLangStored(),
  utm: getUTMs()
};

function getCopy() {
  const langCopy = copy[state.lang] || copy.en;
  const fallback = langCopy.neutral;
  const block = langCopy[state.audience] || fallback;
  const merged = deepMerge(deepClone(fallback || {}), deepClone(block || {}));
  if (state.audience === "youth" && state.variant) {
    const overrides = youthVariants[state.lang]?.[state.variant];
    if (overrides) deepMerge(merged, deepClone(overrides));
  }
  return merged;
}

function replaceText(dict) {
  $$("[data-copy], [data-copy-html], [data-copy-list]").forEach((node) => {
    const textKey = node.getAttribute('data-copy');
    const htmlKey = node.getAttribute('data-copy-html');
    const listKey = node.getAttribute('data-copy-list');

    if (textKey) {
      const value = getPath(dict, textKey);
      setText(node, typeof value === 'string' ? value : '');
      return;
    }

    if (htmlKey) {
      const value = getPath(dict, htmlKey);
      node.innerHTML = typeof value === 'string' ? value : '';
      return;
    }

    if (listKey) {
      const items = getPath(dict, listKey);
      node.innerHTML = '';
      if (Array.isArray(items)) {
        items.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          node.appendChild(li);
        });
      }
    }
  });
}

function renderLists(dict) {
  const heroIncludes = $('#hero-includes');
  if (heroIncludes) {
    heroIncludes.innerHTML = '';
    (dict.hero?.includes || []).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `${checkIcon()}<span>${item}</span>`;
      heroIncludes.appendChild(li);
    });
  }

  const problemTiles = $('#problem-tiles');
  const problemConclusion = $('#problem-conclusion-text');
  
  if (problemTiles) {
    problemTiles.innerHTML = '';
    (dict.problemFit?.tiles || []).forEach((tile) => {
      const div = document.createElement('div');
      div.className = 'tile';
      div.innerHTML = tile;
      problemTiles.appendChild(div);
    });
  }
  
  if (problemConclusion && dict.problemFit?.conclusion) {
    problemConclusion.textContent = dict.problemFit.conclusion;
    const existingCaption = problemConclusion.querySelector('.problem-quote-rick-caption');
    if (existingCaption) existingCaption.remove();
    if (state.audience === 'women') {
      const cap = document.createElement('span');
      cap.className = 'problem-quote-rick-caption';
      const name = document.createElement('span');
      name.className = 'problem-quote-rick-name';
      name.textContent = 'Rick Leger';
      const title = document.createElement('span');
      title.className = 'problem-quote-rick-title';
      title.textContent = 'Peak Fitness Owner';
      cap.appendChild(name);
      cap.appendChild(title);
      problemConclusion.appendChild(cap);
    }
  }

  const coreList = $('#core-offer-list');
  if (coreList) {
    coreList.innerHTML = '';
    (dict.valueSplit?.core || []).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `${bulletDot()}<span>${item}</span>`;
      coreList.appendChild(li);
    });
  }

  const bonusList = $('#bonus-list');
  if (bonusList) {
    bonusList.innerHTML = '';
    (dict.valueSplit?.bonuses || []).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `${bulletDot()}<span>${item}</span>`;
      bonusList.appendChild(li);
    });
  }

  const guarantee = $('#guarantee-bullets');
  if (guarantee) {
    guarantee.innerHTML = '';
    (dict.guarantee?.bullets || []).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `${bulletDot()}<span>${item}</span>`;
      guarantee.appendChild(li);
    });
  }

  const testimonials = $('#testimonials');
  if (testimonials) {
    testimonials.innerHTML = '';
    const testimonialItems = dict.testimonials?.items || [];
    testimonialItems.forEach(({ quote, name }) => {
      const card = document.createElement('div');
      card.className = 'testimonial';
      card.innerHTML = `<p>“${quote}”</p><div class="name">— ${name}</div>`;
      testimonials.appendChild(card);
    });
    testimonials.hidden = testimonialItems.length === 0;
  }

  if (testimonialVideo && testimonialMedia) {
    const videoConfig = dict.testimonials?.video;
    let videoMobile = '';
    let videoDesktop = '';
    if (typeof videoConfig === 'string') {
      videoMobile = videoConfig;
      videoDesktop = videoConfig;
    } else if (videoConfig) {
      videoMobile = videoConfig.mobile || videoConfig.src || '';
      videoDesktop = videoConfig.desktop || videoMobile || '';
    }

    if (videoMobile || videoDesktop) {
      testimonialVideo.hidden = false;
      testimonialMedia.hidden = false;
      if (testimonialObserver) {
        testimonialObserver.disconnect();
        testimonialObserver = null;
      }
      testimonialMedia.pause();
      testimonialMedia.removeAttribute('src');
      testimonialMedia.load();
      if (videoMobile) testimonialMedia.dataset.srcMobile = videoMobile; else delete testimonialMedia.dataset.srcMobile;
      if (videoDesktop) testimonialMedia.dataset.srcDesktop = videoDesktop; else delete testimonialMedia.dataset.srcDesktop;
      setupTestimonialObserver();
    } else {
      testimonialVideo.hidden = true;
      testimonialMedia.hidden = true;
      if (testimonialObserver) {
        testimonialObserver.disconnect();
        testimonialObserver = null;
      }
      testimonialMedia.pause();
      testimonialMedia.removeAttribute('src');
      testimonialMedia.load();
      delete testimonialMedia.dataset.srcMobile;
      delete testimonialMedia.dataset.srcDesktop;
    }
  }

  const timeline = $('#timeline-rows');
  if (timeline) {
    timeline.innerHTML = '';
    (dict.timeline?.rows || []).forEach(({ title, text }) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `<span class="timeline-dot"></span><div><div class="h4">${title}</div><p class="muted">${text}</p></div>`;
      timeline.appendChild(item);
    });
  }

  const riskfreeImg = $('#riskfree-secondary-img');
  if (riskfreeVideoSection && riskfreeImg && riskfreeVideoWrap && riskfreeVideoEl) {
    const media = dict.riskfreeSecondary?.media || {};
    const imageSrc = media.image || 'assets/riskfree-secondary.jpg';
    if (imageSrc) {
      riskfreeImg.src = imageSrc;
      riskfreeVideoSection.style.setProperty('--riskfree-image', `url("${imageSrc}")`);
    } else {
      riskfreeVideoSection.style.removeProperty('--riskfree-image');
    }
    riskfreeImg.hidden = true;
    riskfreeImg.setAttribute('aria-hidden', 'true');

    const mobileVideo = media.mobileVideo;
    if (mobileVideo) {
      if (riskfreeVideoEl.getAttribute('src') !== mobileVideo) {
        riskfreeVideoEl.src = mobileVideo;
        riskfreeVideoEl.load();
      }
      riskfreeVideoEl.muted = true;
      riskfreeVideoEl.setAttribute('muted', '');
      riskfreeVideoEl.loop = true;
      riskfreeVideoEl.setAttribute('loop', '');
      riskfreeVideoEl.playsInline = true;
      riskfreeVideoEl.setAttribute('playsinline', '');
      riskfreeVideoWrap.hidden = false;
      setupRiskfreeObserver();
    } else {
      riskfreeVideoEl.pause();
      riskfreeVideoEl.removeAttribute('src');
      riskfreeVideoEl.load();
      riskfreeVideoWrap.hidden = true;
      teardownRiskfreeObserver();
    }
  }

  const faq = $('#faq-accordion');
  if (faq) {
    faq.innerHTML = '';
    (dict.faq?.items || []).forEach(({ q, a }, idx) => {
      const item = document.createElement('div');
      item.className = 'faq-item';
      item.innerHTML = `
        <h3 class="faq-question">${q}</h3>
        <p class="faq-answer">${a}</p>
      `;
      faq.appendChild(item);
    });
  }

  const modalIncludes = $('#modal-includes');
  if (modalIncludes) {
    modalIncludes.innerHTML = '';
    (dict.hero?.includes || []).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML = `${checkIcon()}<span>${item}</span>`;
      modalIncludes.appendChild(li);
    });
  }
}

function checkIcon() {
  return `<span class="check" aria-hidden="true"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 11.2 3.5 8.5l1.2-1.2 1.5 1.5 5-5 1.2 1.2-6.2 6.2Z"/></svg></span>`;
}

function bulletDot() {
  return `<span class="bullet-dot" aria-hidden="true"></span>`;
}

function setupTestimonialObserver() {
  if (!testimonialVideo || !testimonialMedia) return;
  const prefersDesktop = () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(min-width: 900px)');
      if (typeof query.matches === 'boolean') return query.matches;
    }
    if (typeof window.innerWidth === 'number') return window.innerWidth >= 900;
    return false;
  };
  const getPreferredSrc = () => {
    const mobileSrc = testimonialMedia.dataset.srcMobile || '';
    const desktopSrc = testimonialMedia.dataset.srcDesktop || '';
    if (prefersDesktop() && desktopSrc) {
      return desktopSrc;
    }
    return mobileSrc || desktopSrc || '';
  };

  if (!getPreferredSrc()) return;

  const loadVideo = () => {
    const selectedSrc = getPreferredSrc();
    if (!selectedSrc) return;
    const current = testimonialMedia.getAttribute('src');
    if (current !== selectedSrc) {
      testimonialMedia.src = selectedSrc;
      testimonialMedia.load();
    }
    if (!testimonialMedia.muted) testimonialMedia.muted = true;
    testimonialMedia.play().catch(() => {});
    if (testimonialObserver) {
      testimonialObserver.disconnect();
      testimonialObserver = null;
    }
  };

  if (typeof IntersectionObserver !== 'function') {
    loadVideo();
    return;
  }

  testimonialObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        loadVideo();
      }
    });
  }, { threshold: 0.4 });

  testimonialObserver.observe(testimonialVideo);
}

function setupRiskfreeObserver() {
  if (!riskfreeVideoSection || !riskfreeVideoWrap || !riskfreeVideoEl) return;
  if (riskfreeObserver) return;

  const playVideo = () => {
    if (riskfreeVideoEl.paused) {
      riskfreeVideoEl.play().catch(() => {});
    }
  };

  const pauseVideo = () => {
    if (!riskfreeVideoEl.paused) {
      riskfreeVideoEl.pause();
    }
  };

  const handleIntersect = (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        playVideo();
      } else {
        pauseVideo();
      }
    });
  };

  if (typeof IntersectionObserver === 'function') {
    riskfreeObserver = new IntersectionObserver(handleIntersect, { threshold: 0.35 });
    riskfreeObserver.observe(riskfreeVideoWrap);
  } else {
    // Fallback: autoplay immediately on mobile if observer unsupported
    playVideo();
  }
}

function teardownRiskfreeObserver() {
  if (riskfreeObserver) {
    riskfreeObserver.disconnect();
    riskfreeObserver = null;
  }
}

function setupGuaranteeObserver() {
  if (!guaranteeVideoSection || !guaranteeVideoWrap || !guaranteeVideoEl) return;
  if (guaranteeObserver) return;

  const playVideo = () => {
    if (guaranteeVideoEl.paused) {
      guaranteeVideoEl.muted = true;
      guaranteeVideoEl.setAttribute('muted', '');
      guaranteeVideoEl.play().then(() => {
        guaranteeVideoEl.muted = false;
        guaranteeVideoEl.removeAttribute('muted');
        guaranteeVideoEl.volume = 1;
      }).catch(() => {
        guaranteeVideoEl.muted = true;
      });
    }
  };

  const pauseVideo = () => {
    if (!guaranteeVideoEl.paused) {
      guaranteeVideoEl.pause();
    }
  };

  const handleIntersect = (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        playVideo();
      } else {
        pauseVideo();
      }
    });
  };

  guaranteeVideoEl.autoplay = false;
  guaranteeVideoEl.removeAttribute('autoplay');
  guaranteeVideoEl.muted = true;
  guaranteeVideoEl.setAttribute('muted', '');
  guaranteeVideoEl.playsInline = true;
  guaranteeVideoEl.setAttribute('playsinline', '');
  guaranteeVideoEl.volume = 1;
  pauseVideo();

  if (typeof IntersectionObserver === 'function') {
    guaranteeObserver = new IntersectionObserver(handleIntersect, { threshold: 0.35, rootMargin: '0px 0px -5%' });
    guaranteeObserver.observe(guaranteeVideoWrap);
  } else {
    playVideo();
  }
}

function teardownGuaranteeObserver() {
  if (guaranteeObserver) {
    guaranteeObserver.disconnect();
    guaranteeObserver = null;
  }
  if (guaranteeVideoEl) {
    guaranteeVideoEl.pause?.();
  }
}

function setupGuaranteeMobileObserver() {
  if (!guaranteeMobileVideoSection || !guaranteeMobileVideoEl) return;
  if (guaranteeMobileObserver) return;

  const playVideo = () => {
    guaranteeMobileVideoEl.muted = true;
    guaranteeMobileVideoEl.setAttribute('muted', '');
    guaranteeMobileVideoEl.play().then(() => {
      guaranteeMobileVideoEl.muted = false;
      guaranteeMobileVideoEl.removeAttribute('muted');
      guaranteeMobileVideoEl.volume = 1;
    }).catch(() => {
      guaranteeMobileVideoEl.muted = true;
    });
  };

  const pauseVideo = () => {
    guaranteeMobileVideoEl.pause();
  };

  const handleIntersect = (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        playVideo();
      } else {
        pauseVideo();
      }
    });
  };

  guaranteeMobileVideoEl.autoplay = false;
  guaranteeMobileVideoEl.removeAttribute('autoplay');
  guaranteeMobileVideoEl.muted = true;
  guaranteeMobileVideoEl.setAttribute('muted', '');
  guaranteeMobileVideoEl.playsInline = true;
  guaranteeMobileVideoEl.setAttribute('playsinline', '');
  guaranteeMobileVideoEl.volume = 1;
  pauseVideo();

  if (typeof IntersectionObserver === 'function') {
    guaranteeMobileObserver = new IntersectionObserver(handleIntersect, { threshold: 0.35, rootMargin: '0px 0px -5%' });
    guaranteeMobileObserver.observe(guaranteeMobileVideoSection);
  } else {
    playVideo();
  }
}

function teardownGuaranteeMobileObserver() {
  if (guaranteeMobileObserver) {
    guaranteeMobileObserver.disconnect();
    guaranteeMobileObserver = null;
  }
}

function updateMedia(dict) {
  const src = dict.meta?.heroImg || 'assets/hero-neutral.svg';
  const alt = dict.meta?.offerName || 'Starter Pack';
  const heroImg = $('#hero-img');
  if (heroImg) {
    heroImg.src = src;
    heroImg.alt = alt;
  }
  const bgImg = document.querySelector('.hero-background img');
  if (bgImg) {
    bgImg.src = src;
    bgImg.alt = alt;
  }

  const guaranteeSrc = dict.guarantee?.media?.src || '';
  const guaranteeMedia = dict.guarantee?.media;
  const guaranteeAlt = dict.guarantee?.media?.alt || '';
  const guaranteeSection = $('#guarantee');
  const guaranteeWrap = $('#guarantee-media-area');
  const guaranteeImg = $('#guarantee-media-img');
  const guaranteeVideo = $('#guarantee-media-video');
  const setVideoSources = (videoEl, sources = {}) => {
    if (!videoEl) return;
    while (videoEl.firstChild) videoEl.removeChild(videoEl.firstChild);
    const desktopSrc = sources.desktop || guaranteeMedia?.src;
    const mobileSrc = sources.mobile || desktopSrc;
    videoEl.preload = 'auto';
    videoEl.setAttribute('preload', 'auto');
    if (mobileSrc) {
      const sourceMobile = document.createElement('source');
      sourceMobile.src = mobileSrc;
      sourceMobile.type = 'video/mp4';
      sourceMobile.media = '(max-width: 768px)';
      videoEl.appendChild(sourceMobile);
    }
    if (desktopSrc) {
      const sourceDesktop = document.createElement('source');
      sourceDesktop.src = desktopSrc;
      sourceDesktop.type = 'video/mp4';
      sourceDesktop.media = '(min-width: 769px)';
      videoEl.appendChild(sourceDesktop);
    }
    videoEl.load();
  };
  if (guaranteeSection) {
    if (guaranteeMedia?.type === 'video') {
      guaranteeSection.style.removeProperty('--guarantee-image');
      if (guaranteeWrap) guaranteeWrap.hidden = false;
      if (guaranteeImg) {
        guaranteeImg.hidden = true;
        guaranteeImg.removeAttribute('src');
        guaranteeImg.removeAttribute('alt');
      }
      if (guaranteeVideo) {
        guaranteeVideo.hidden = false;
        guaranteeVideo.poster = guaranteeMedia.poster || '';
        guaranteeVideo.setAttribute('aria-label', guaranteeAlt || alt);
        guaranteeVideo.autoplay = false;
        guaranteeVideo.removeAttribute('autoplay');
        guaranteeVideo.muted = false;
        guaranteeVideo.removeAttribute('muted');
        setVideoSources(guaranteeVideo, guaranteeMedia.sources);
        guaranteeVideo.volume = 1;
        guaranteeVideo.pause?.();
        setupGuaranteeObserver();
      }
    } else if (guaranteeSrc) {
      guaranteeSection.style.setProperty('--guarantee-image', `url("${guaranteeSrc}")`);
      if (guaranteeWrap) guaranteeWrap.hidden = false;
      if (guaranteeImg) {
        guaranteeImg.hidden = false;
        guaranteeImg.src = guaranteeSrc;
        guaranteeImg.alt = guaranteeAlt || alt;
      }
      if (guaranteeVideo) {
        guaranteeVideo.hidden = true;
        guaranteeVideo.pause?.();
        guaranteeVideo.removeAttribute('poster');
        guaranteeVideo.removeAttribute('autoplay');
        guaranteeVideo.removeAttribute('muted');
        while (guaranteeVideo.firstChild) guaranteeVideo.removeChild(guaranteeVideo.firstChild);
      }
      teardownGuaranteeObserver();
    } else {
      guaranteeSection.style.removeProperty('--guarantee-image');
      if (guaranteeWrap) guaranteeWrap.hidden = true;
      if (guaranteeImg) {
        guaranteeImg.hidden = false;
        guaranteeImg.removeAttribute('src');
        guaranteeImg.removeAttribute('alt');
      }
      if (guaranteeVideo) {
        guaranteeVideo.hidden = true;
        guaranteeVideo.pause?.();
        guaranteeVideo.removeAttribute('poster');
        guaranteeVideo.removeAttribute('autoplay');
        guaranteeVideo.removeAttribute('muted');
        while (guaranteeVideo.firstChild) guaranteeVideo.removeChild(guaranteeVideo.firstChild);
      }
      teardownGuaranteeObserver();
    }
  }

  if (guaranteeMobileVideoEl) {
    if (dict.meta?.audience === 'women' || state.audience === 'women') {
      if (state.lang === 'en' || state.lang === 'fr') {
        setupGuaranteeMobileObserver();
      } else {
        teardownGuaranteeMobileObserver();
        guaranteeMobileVideoEl.pause();
      }
    } else {
      teardownGuaranteeMobileObserver();
      guaranteeMobileVideoEl.pause();
    }
  }
}

function updateUI() {
  document.body.dataset.audience = state.audience;
  document.body.dataset.variant = state.variant;
  document.body.dataset.lang = state.lang;

  const dict = getCopy();
  const ui = uiCopy[state.lang] || uiCopy.en;

  replaceText(dict);
  renderLists(dict);
  updateMedia(dict);

  const priceLabelNodes = $$('[data-copy="hero.value.price"]');
  priceLabelNodes.forEach((node) => {
    const locale = state.lang === 'fr' ? 'fr-CA' : 'en-CA';
    setText(node, toMoney(PRICE_CENTS, CURRENCY, locale));
  });

  setText($('[data-copy="nav.scheduleCall"]'), ui.nav.scheduleCall);
  setText($('[data-copy="nav.buyNow"]'), ui.nav.buyNow);
  setText($('[data-copy="footer.terms"]'), ui.footer.terms);
  setText($('[data-copy="footer.privacy"]'), ui.footer.privacy);
  setText($('#modal-title'), ui.modal.title);
  setText($('#modal-desc'), ui.modal.subtitle);
  setText($('#modal-payment-title'), ui.modal.paymentTitle);
  setText($('#modal-billing-title'), ui.modal.billingTitle);
  setText($('#modal-price-caption'), ui.modal.priceCaption);
  setText($('#modal-card-number-label'), ui.modal.cardNumber);
  setText($('#modal-card-expiry-label'), ui.modal.cardExpiry);
  setText($('#modal-card-cvv-label'), ui.modal.cardCvv);
  setText($('#modal-secure-copy'), ui.modal.secureCopy);
  const payButton = $('#modal-pay');
  const payLabel = payButton?.querySelector('span');
  if (payLabel && (typeof successPanel === 'undefined' || successPanel?.hidden !== false)) {
    setText(payLabel, getPayLabel());
  }
  setText($('#modal-cancel')?.querySelector('span'), ui.modal.cancel);
  const noscript = document.querySelector('noscript .noscript');
  if (noscript) noscript.textContent = ui.noscript;
  // Update summary amounts after copy and price updates
  attachSummaryListeners();
  updateSummaryTotals();

  bindFAQ();

  window.PF = {
    page: 'offer',
    offer: OFFER_SLUG,
    currency: CURRENCY,
    price_cents: PRICE_CENTS,
    audience: state.audience,
    variant: state.variant,
    utm: state.utm
  };
  try {
    localStorage.setItem('pf_offer_last_view', JSON.stringify(window.PF));
  } catch (_) {}
}

function pfTrack(type, extra = {}) {
  const detail = { type, audience: state.audience, variant: state.variant, utm: state.utm, ...extra };
  document.dispatchEvent(new CustomEvent('pf_event', { detail }));
  if (window.gtag) window.gtag('event', type, detail);
  if (window.fbq) window.fbq('trackCustom', type, detail);
}

function bindFAQ() {
  $$('#faq-accordion .faq-item').forEach((item) => {
    const button = item.querySelector('button');
    const panel = item.querySelector('.faq-panel');
    if (!button || !panel) return;

    button.onclick = () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      $$('#faq-accordion .faq-item button[aria-expanded="true"]').forEach((other) => {
        if (other === button) return;
        other.setAttribute('aria-expanded', 'false');
        const otherPanel = document.getElementById(other.getAttribute('aria-controls'));
        if (otherPanel) otherPanel.hidden = true;
      });

      button.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
    };

    button.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
      }
    };
  });
}

const modalOverlay = $('#modal-overlay');
const modal = $('#checkout-modal');
const modalClose = $('#modal-close');
const modalCancel = $('#modal-cancel');
const modalPay = $('#modal-pay');

const checkoutForm = $('#checkout-form');
const cardContainer = $('#card-container');
const cardErrors = $('#card-errors');
const successPanel = $('#checkout-success');
const receiptLink = $('#receipt-link');

const calendlyModal = $('#calendly-modal');
const calendlyClose = $('#calendly-close');
const calendlyContainer = $('#calendly-container');
const testimonialVideo = $('#testimonial-video');
const testimonialMedia = $('#testimonial-video-media');
let testimonialObserver = null;
const riskfreeVideoSection = $('#riskfree-secondary');
const riskfreeVideoWrap = $('#riskfree-secondary-video');
const riskfreeVideoEl = $('#riskfree-secondary-video-el');
const guaranteeVideoSection = $('#guarantee');
const guaranteeVideoWrap = $('#guarantee-media-area');
const guaranteeVideoEl = $('#guarantee-media-video');
const guaranteeMobileVideoSection = $('#guarantee-mobile-video');
const guaranteeMobileVideoEl = $('#guarantee-mobile-video-el');
let guaranteeObserver = null;
let guaranteeMobileObserver = null;
let riskfreeObserver = null;

function focusables(root) {
  return $$('a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter((el) => !el.hasAttribute('disabled') && (el.offsetParent !== null || el === root));
}

async function openModal(event) {
  if (event) event.preventDefault();
  pfTrack('cta_click', { action: 'open_modal' });
  resetCheckoutForm();
  showDialog(modal, closeModal);
  try {
    await loadRemoteConfig();
    updateUI();
    if (modalPay) {
      modalPay.disabled = false;
      const label = modalPay.querySelector('span');
      if (label) label.textContent = getPayLabel();
    }
    await ensureSquareCard();
    showCardError('');
    attachSummaryListeners();
    updateSummaryTotals();
  } catch (error) {
    console.error('modal init error', error);
    showCardError(error.message || 'Unable to initialize payment form.');
  }
}

function closeModal() {
  hideDialog(modal);
  resetCheckoutForm();
}

function bindModal() {
  if (modalOverlay) {
    modalOverlay.addEventListener('click', () => {
      if (calendlyModal && !calendlyModal.hidden) closeCalendly();
      if (modal && !modal.hidden) closeModal();
    });
  }
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
  }
  if (calendlyModal) {
    calendlyModal.addEventListener('click', (event) => {
      if (event.target === calendlyModal) closeCalendly();
    });
  }
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', (event) => {
      event.preventDefault();
      handleCheckoutSubmit();
    });
  }
  if (modalPay) {
    modalPay.addEventListener('click', (event) => {
      event.preventDefault();
      handleCheckoutSubmit();
    });
  }
  $$('[data-cta="open-modal"], [data-cta="buy-top"]').forEach((node) => node.addEventListener('click', openModal));
}

function closeCalendly() {
  hideDialog(calendlyModal);
  calendlyVisible = false;
  if (calendlyContainer) {
    calendlyContainer.innerHTML = '';
  }
}

async function openCalendly(event) {
  if (event) event.preventDefault();
  pfTrack('calendly_click');
  await loadRemoteConfig();
  const url = appendUTMs(CALENDLY_URL, state.utm);
  if (!calendlyModal || !calendlyContainer) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  showDialog(calendlyModal, closeCalendly);
  calendlyVisible = true;
  const values = getLeadFormValues();
  if (window.Calendly && typeof window.Calendly.initInlineWidget === 'function') {
    calendlyContainer.innerHTML = '';
    window.Calendly.initInlineWidget({
      url,
      parentElement: calendlyContainer,
      prefill: {
        name: [values.firstName, values.lastName].filter(Boolean).join(' ') || undefined,
        email: values.email || undefined
      },
      utm: state.utm
    });
    calendlyLoaded = true;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
    closeCalendly();
  }
}

function bindCalendly() {
  if (calendlyClose) calendlyClose.addEventListener('click', closeCalendly);
  $$('[data-cta="calendly"]').forEach((node) => node.addEventListener('click', openCalendly));
}

// --- Promo popup binding & submit ---
function submitPromoForm(event) {
  event?.preventDefault();
  const emailInput = document.getElementById('promo-email');
  const errorNode = document.getElementById('promo-error');
  const submitBtn = document.getElementById('promo-submit');
  const form = document.getElementById('promo-form');
  const success = document.getElementById('promo-success');
  if (!emailInput) return;
  const email = (emailInput.value || '').trim();
  if (!isValidEmail(email)) {
    if (errorNode) {
      errorNode.textContent = state.lang === 'fr' ? 'Entre une adresse courriel valide.' : 'Enter a valid email address.';
      errorNode.hidden = false;
    }
    emailInput.focus();
    return;
  }
  if (errorNode) errorNode.hidden = true;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = state.lang === 'fr' ? 'Envoi…' : 'Sending…'; }
  const atlanticTimestamp = new Date().toLocaleString('sv-SE', {
    timeZone: 'America/Halifax',
    hour12: false
  }).replace(' ', 'T');

  const payload = {
    email,
    locale: state.lang,
    audience: state.audience,
    utm: state.utm,
    timestamp: `${atlanticTimestamp}-03:00`,
    offer: 'stronger_than_yesterday_recipes',
    source: 'recipe_promo_popup'
  };
  const url = PROMO_WEBHOOK_URL;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then((res) => {
    if (!res.ok) throw new Error('promo webhook failed');
    setLocalStorage(PROMO_SUBMITTED_KEY, '1');
    if (form) form.hidden = true;
    if (success) success.hidden = false;
  }).catch((err) => {
    console.error('promo submit error', err);
    if (errorNode) {
      errorNode.textContent = state.lang === 'fr' ? 'Oups! Réessaie dans un instant.' : 'Something went wrong. Please try again in a moment.';
      errorNode.hidden = false;
    }
  }).finally(() => {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = state.lang === 'fr' ? 'Envoyer les recettes' : 'Send the recipes'; }
  });
}

function bindPromoPopup() {
  const overlay = document.getElementById('promo-overlay');
  const popup = document.getElementById('promo-popup');
  const closeBtn = document.getElementById('promo-close');
  const form = document.getElementById('promo-form');
  if (!popup) return;
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const successVisible = isPromoSuccessVisible();
        closePromoPopup({ dismissed: !successVisible, submitted: successVisible });
      }
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const successVisible = isPromoSuccessVisible();
      closePromoPopup({ dismissed: !successVisible, submitted: successVisible });
    });
  }
  if (form) form.addEventListener('submit', submitPromoForm);
  if (promoMediaQuery) promoMediaQuery.addEventListener('change', handlePromoResize);
  setupPromoObserver();
}

function bindLangToggle() {
  const langEN = $('#lang-en');
  const langFR = $('#lang-fr');
  const updatePressed = () => {
    if (langEN) langEN.setAttribute('aria-pressed', String(state.lang === 'en'));
    if (langFR) langFR.setAttribute('aria-pressed', String(state.lang === 'fr'));
  };
  if (langEN) langEN.addEventListener('click', () => { state.lang = 'en'; setLangStored('en'); updatePressed(); updateUI(); });
  if (langFR) langFR.addEventListener('click', () => { state.lang = 'fr'; setLangStored('fr'); updatePressed(); updateUI(); });
  updatePressed();
}

document.addEventListener('DOMContentLoaded', () => {
  bindLangToggle();
  bindModal();
  bindCalendly();
  bindPromoPopup();
  updateUI();
  resetCheckoutForm();

  (async () => {
    try {
      await loadRemoteConfig();
    } catch (error) {
      console.error('init config error', error);
    } finally {
      updateUI();
      resetCheckoutForm();
    }
  })();
});
