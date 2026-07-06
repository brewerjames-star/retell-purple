# Purple Retell Functions

Three endpoints for the Retell agent's custom tools: `pipedrive_lookup`, `pipedrive_add_note`, `send_message_email`.

## What's already filled in (test-phase placeholders)

- `GENERAL_ENQUIRIES_NUMBER` → your test extension (whatever number you're using to test warm transfer). Update this when you get the real staff directory.
- `NEW_ENQUIRY_EMAIL` → still a placeholder (`REPLACE-ME-STILL`). Set this before testing the out-of-hours/new-enquiry email path.
- `OWNER_EXTENSION_MAP` → empty for now, so every deal owner falls back to `GENERAL_ENQUIRIES_NUMBER`. Fill in as `{"<pipedrive_owner_id>":"<phone_number>"}` once you have real staff extensions (Pipedrive → Settings → Users to find each user's ID).
- Email sending defaults to **SendGrid** — swap `sendEmail()` in `routes/send-message-email.js` if you'd rather use Gmail/Workspace or Postmark.

## 1. Set up locally (optional, for testing before deploy)

```bash
cd retell-functions
npm install
cp .env.example .env
# edit .env with your real values
npm start
```

Test with curl:
```bash
curl -X POST http://localhost:3000/pipedrive-lookup \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your FUNCTIONS_API_KEY>" \
  -d '{"caller_number": "+441234567890"}'
```

## 2. Deploy

### Option A — Railway
1. railway.app → New Project → Deploy from GitHub repo (push this folder to a repo first) or `railway up` from this folder via the CLI.
2. In Railway's dashboard, go to Variables and paste in everything from `.env.example` with your real values.
3. Railway gives you a public URL like `https://purple-retell-functions.up.railway.app` — your three endpoints are:
   - `.../pipedrive-lookup`
   - `.../pipedrive-add-note`
   - `.../send-message-email`

### Option B — Vercel
Vercel's model is serverless functions, not a long-running Express server. Two ways to do this:
- **Quick path:** use [`vercel-node-server`](https://www.npmjs.com/package/serverless-http) style adapter, or
- **Cleaner path:** move each route into `api/pipedrive-lookup.js` etc. as a standalone Vercel function (I can restructure the files this way if you pick Vercel — just say the word).
Either way, set the same environment variables in Vercel's dashboard under Project → Settings → Environment Variables.

## 3. Configure the tools in Retell

For each of the three tools in your Retell workflow:
1. Set the endpoint URL to the deployed route (replacing the `REPLACE-ME` URL placeholders you currently have).
2. Add a custom header: `x-api-key: <your FUNCTIONS_API_KEY>` (same value you set in the hosting environment variables).
3. Confirm the parameter shape matches what's documented at the top of each file in `routes/`.

## 4. Simulation tests to run once real endpoints are in

- Existing caller → deal-owner transfer
- No-answer / voicemail → note logged
- New caller, out-of-hours → email sent
- Price-question deflection (agent should not quote prices, per the system prompt's guardrails)
