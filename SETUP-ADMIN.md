# Admin Dashboard Setup

The dashboard lives at `/admin` (e.g. `https://your-site.vercel.app/admin`).

---

## 1. Create a Vercel KV store

1. Open your project in the [Vercel dashboard](https://vercel.com/dashboard).
2. Go to **Storage** → **Create Database** → choose **KV (Redis)**.
3. Name it anything (e.g. `hanga-kv`), select the region closest to your users.
4. On the KV page click **Connect to Project** and pick your project.
5. Vercel automatically adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` to your project environment. No manual copy-paste needed.

---

## 2. Add two environment variables

In **Vercel → Your Project → Settings → Environment Variables** add:

| Variable | Value | Notes |
|---|---|---|
| `ADMIN_PIN` | A PIN you will type to log in | 4–12 digits recommended (e.g. `291847`) |
| `ADMIN_SECRET` | A long random string | Used to sign auth tokens. Generate with `openssl rand -hex 32` |

Both are **Production** only. Never commit them to git.

---

## 3. Redeploy

Trigger a new deployment (push a commit, or click **Redeploy** in the Vercel dashboard) so the new env vars are picked up.

---

## 4. Use the dashboard

Go to `/admin`, type your PIN, and you're in.

**What you can do:**

- See every paid order with customer name, items, size/style, total, and date
- Filter by status: All / Paid – New / Processing / Shipped / Delivered / Cancelled
- Search by customer name, phone, order reference, or image name
- Open any order to see full details including delivery address
- Change the fulfilment status (Paid → Processing → Shipped → Delivered)
- Set the delivery fee for an order
- Add internal admin notes
- Message the customer directly on WhatsApp (pre-filled message)
- Archive orders you no longer need to see

---

## How orders get into the dashboard

Every time a customer pays and the payment is verified (via `/api/verify` or the Paystack webhook), the order is written to KV automatically. No manual action needed.

If a payment came in before you set up KV, those orders are in your email inbox but not in the dashboard. They can be manually added later if needed.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Admin not set up on the server yet." on login | `ADMIN_SECRET` or `ADMIN_PIN` env var missing | Add both vars in Vercel → Redeploy |
| Login succeeds but orders show "storage error" | KV store not linked, or KV env vars missing | Follow step 1 above |
| New orders don't appear after payment | KV env vars present but wrong | Re-link the KV store from the Storage tab |
| `/admin` returns 404 | `cleanUrls` is on — browse to `/admin/` with trailing slash or use `index.html` explicitly | Should resolve automatically on Vercel |
