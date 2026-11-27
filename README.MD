# Hanga – Custom Wall Frames

Static website for **Hanga**, a Nigerian custom wall-frame shop. Customers pick a print from the gallery (or upload their own photo), choose one of four sizes (12×16" to 20×24") and a black or white frame, or a borderless finish, preview it on a real wall, and place an order.

Live: https://hangaframes.art

## Pages

| File | What it is |
| --- | --- |
| `index.html` | Home: hero, how it works, gallery, sizes & prices, reviews, delivery & FAQs |
| `customize.html` | Frame builder with live room preview (`?image=<id>`, `?size=16x20`, `?tab=upload`) |
| `checkout.html` | Name, phone and delivery address, then place order |
| `confirmation.html` | Receipt, Pay with Paystack, Send on WhatsApp (`js/receipt.js`, `js/receipt-page.js`) |
| `api/` | Vercel functions: `config` (public key), `verify` (payment check), `paystack-webhook` (owner email) |
| `about.html` | Brand story and values |
| `404.html` | Not-found page (served automatically by Vercel) |

## Business settings — edit `js/site.js`

All contact and payment details live in one place, `window.HANGA` at the top of `js/site.js`:

- `whatsappNumber` – international format, digits only (e.g. `2348012345678`). Turns on the WhatsApp footer link, "Order on WhatsApp" in the builder and "Send on WhatsApp" on the confirmation page.
- `instagramHandle` – turns on the Instagram footer link.
- `paystackPublicKey` – optional Paystack **public** key (`pk_live_…`). Better: set `PAYSTACK_PUBLIC_KEY` in Vercel. See **SETUP-PAYSTACK.md** for payments and the automatic owner email. Never put the secret key in this repo.
- `setDiscounts` – naira off a whole multi-frame set: `{ 2: 200, 3: 500 }` means a Pair is 2 × the per-frame price − ₦200 and a Trio is 3 × − ₦500. Single frames have no discount. Every price on the site is calculated from this.
- `bank` – account details for manual transfer; shown only when `confirmed: true`.

Anything left empty is hidden, so the site never shows a dead link or fake payment.

> The site has no backend. Orders reach Hanga when the customer taps **Send on WhatsApp** or **Send by Email** on the confirmation page .

## Delivery

Nationwide delivery within 3 business days. We will confirm your delivery fee after your order.

## Images

- `images/` – original prints; `images/collection/` – public-domain museum works (see `CREDITS.md`).
- `assets/prints/originals/` – full-resolution owner photos for printing; `images/prints/` – their web copies (WebP + JPG, ≤1600px); `data/prints-manifest.json` – pixel sizes and print DPI per frame size.
- `images/thumbs/` – small copies used for gallery thumbnails. Re-generate when you add a print, e.g. with ImageMagick:
  `magick images/collection/new-print.jpg -resize 400x560 -quality 76 images/thumbs/new-print.jpg`
- `images/og-image.jpg` – the picture shown when the site is shared on WhatsApp, X, etc.
- `images/hero-bg.jpg` – homepage background. Photo by **Mateusz Pielech** on Pexels, "Stylish Living Room with Red Sofa and Art Prints" (https://www.pexels.com/photo/stylish-living-room-with-red-sofa-and-art-prints-29252569/), used under the Pexels License (free for commercial use, no attribution required — credited here as thanks). Resized to 1920×1280.

- `images/room/living-room.jpg` – the builder's wall preview. Photo by **RDNE Stock project** on Pexels, "White Sofa Beside White Wall" (https://www.pexels.com/photo/white-sofa-beside-white-wall-8581013/), used under the Pexels License (free for commercial use, no attribution required — credited here as thanks). Cropped, slightly warmed and resized to 1920×1896. If you swap it, update the sofa coordinates in `ROOM` in `customize.html`.
- `images/sets/dont-give-up-*.jpg` – the three typographic panels of the "Don't Give Up" trio, made for Hanga.

## Multi-frame sets

Customers choose **Single (1)**, **Pair (2)** or **Trio (3)** first. A set is one product: one size and one frame style for every piece, one cart line, and every piece listed at checkout and in the order message. Curated sets live in `CURATED_SETS` in `customize.html` (they point at gallery prints by id); customers can also fill each frame with any print or their own photo.

## Run locally

Any static server works:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## License

MIT — see `LICENSE`.
