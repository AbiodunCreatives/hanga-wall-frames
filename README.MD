# Hanga – Custom Wall Frames

Static website for **Hanga**, a Nigerian custom wall-frame shop. Customers pick a print from the gallery (or upload their own photo), choose one of six sizes and a black, white or natural-wood frame, preview it on a real wall, and place an order.

Live: https://hanga-frames.vercel.app

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home: hero, how it works, gallery, sizes & prices, reviews, delivery & FAQs |
| `customize.html` | Frame builder with live room preview (`?image=<id>`, `?size=16x20`, `?tab=upload`) |
| `checkout.html` | Contact + delivery details and payment |
| `confirmation.html` | Order reference + "send us your order" (WhatsApp / email) |
| `about.html` | Brand story and values |
| `404.html` | Not-found page (served automatically by Vercel) |

## Business settings — edit `js/site.js`

All contact and payment details live in one place, `window.HANGA` at the top of `js/site.js`:

- `whatsappNumber` – international format, digits only (e.g. `2348012345678`). Turns on the WhatsApp footer link, "Order on WhatsApp" in the builder and "Send on WhatsApp" on the confirmation page.
- `instagramHandle` – turns on the Instagram footer link.
- `paystackPublicKey` – your Paystack **public** key (`pk_live_…`). Turns on card payment at checkout. Never put the secret key in this repo.
- `bank` – account details for manual transfer; shown only when `confirmed: true`.

Anything left empty is hidden, so the site never shows a dead link or fake payment.

> The site has no backend. Orders reach Hanga when the customer taps **Send on WhatsApp** or **Send by Email** on the confirmation page (or pays through Paystack, which records the order in your Paystack dashboard).

## Images

- `images/` – original prints; `images/collection/` – public-domain museum works (see `CREDITS.md`).
- `images/thumbs/` – small copies used for gallery thumbnails. Re-generate when you add a print, e.g. with ImageMagick:
  `magick images/collection/new-print.jpg -resize 400x560 -quality 76 images/thumbs/new-print.jpg`
- `images/og-image.jpg` – the picture shown when the site is shared on WhatsApp, X, etc.
- `images/hero-bg.jpg` – homepage background. Photo by **Mateusz Pielech** on Pexels, "Stylish Living Room with Red Sofa and Art Prints" (https://www.pexels.com/photo/stylish-living-room-with-red-sofa-and-art-prints-29252569/), used under the Pexels License (free for commercial use, no attribution required — credited here as thanks). Resized to 1920×1280.

## Run locally

Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## License

MIT — see `LICENSE`.
