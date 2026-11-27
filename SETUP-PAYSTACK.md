# Switching on Paystack payments + owner order emails

The site works without any of this: customers get a receipt and send their
order on WhatsApp or email. Follow these steps to turn on **Pay with Paystack**
and the automatic **"New paid order" email to hello@hanga.ng**.

## 1. Add environment variables in Vercel

Vercel → project **hanga-frames** → Settings → Environment Variables
(Environment: **Production**, and Preview if you want to test there):

| Name | Value | Required |
|---|---|---|
| `PAYSTACK_PUBLIC_KEY` | `pk_live_…` from Paystack → Settings → API Keys & Webhooks | Yes (shows the Pay button) |
| `PAYSTACK_SECRET_KEY` | `sk_live_…` from the same page. **Never put this in the code.** | Yes (verifies payments + webhooks) |
| `RESEND_API_KEY` | API key from https://resend.com → API Keys | Yes, for the owner email |
| `OWNER_EMAIL` | `hello@hanga.ng` (default if not set) | Optional |
| `RESEND_FROM` | e.g. `Hanga Orders <orders@hanga.ng>` (after verifying the domain, step 2) | Optional |
| `SEND_CUSTOMER_COPY` | `true` to also email the receipt to the customer (needs a verified domain) | Optional |

Then **redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the values.

## 2. Resend sender

- Quickest: leave `RESEND_FROM` unset. Emails come from `onboarding@resend.dev`.
  On Resend's free test sender, mail can only go to the email address that owns
  the Resend account, so sign up to Resend **with hello@hanga.ng** (or set
  `OWNER_EMAIL` to the address you signed up with).
- Proper: Resend → Domains → add `hanga.ng`, add the DNS records it shows
  (SPF/DKIM) at your domain registrar, wait for "Verified", then set
  `RESEND_FROM=Hanga Orders <orders@hanga.ng>`. This also allows customer copies.

## 3. Webhook in Paystack

Paystack → Settings → API Keys & Webhooks → **Live Webhook URL**:

```
https://www.hangaframes.art/api/paystack-webhook
```

Save.

## How it works

1. Checkout collects name, phone, **email** (Paystack requires it) and address,
   then shows the receipt (`confirmation.html`).
2. **Pay with Paystack** opens Paystack's popup for the receipt total (in kobo,
   NGN). The order reference is used as the Paystack reference, and the full
   order (items, size, style, set, quantities, unit prices, discounts, subtotal,
   total, customer details) travels as Paystack metadata — no database needed.
3. When the payment succeeds Paystack calls `/api/paystack-webhook`. The function
   checks the `x-paystack-signature` (HMAC-SHA512 with your secret key),
   re-verifies the transaction with Paystack, re-prices the order from the price
   list, and emails the full receipt to `OWNER_EMAIL`:
   subject **"New paid order HNG-… — ₦total"**. If the amount doesn't match the
   price list the subject starts with **⚠ CHECK AMOUNT**.
   The email includes a **WhatsApp button** to message the customer.
   It is sent from **both** the webhook and `/api/verify` (whichever runs first),
   with the same Resend idempotency key per Paystack reference (`owner-<ref>`),
   so you get exactly one email per order — even if the webhook URL isn't set
   yet, or the customer closes the page before verify runs.
   (WhatsApp auto-send would need the WhatsApp Business API, so it isn't used.)
4. The customer's page calls `/api/verify` and switches to a **Payment
   successful** screen (animated checkmark, order reference, summary) with
   **Download receipt (PDF)** and **Save as image (PNG)**, drawn in the browser
   from the real order data. If they close the popup, the receipt stays
   "Payment pending" with **Retry payment** and **Order via WhatsApp instead**.
5. Paystack also sends its own "successful transaction" email to the merchant
   account, and every payment is in the Paystack dashboard.

Delivery is not charged online: "We will confirm your delivery fee after your order."

## Prices

The server keeps its own copy of the price list in `api/_lib.js` (`PRICES`,
`SET_DISCOUNTS`). If you change prices in `customize.html` / `js/site.js`,
change them there too, or paid orders will be flagged ⚠ CHECK AMOUNT.

## Quick checks after setup

- `https://www.hangaframes.art/api/config` → shows your `pk_…` key.
- `https://www.hangaframes.art/api/verify?reference=test123` → JSON
  (not a 404).
- Place a small real order and confirm the email arrives.
