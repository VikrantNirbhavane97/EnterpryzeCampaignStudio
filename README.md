# Enterpryze Campaign Studio

Cloud-native ERP outbound-email planning tool for the Enterpryze team.
Hosted on Cloudflare Pages at **https://enterpryzecampaignstudio.pages.dev**.

---

## Root cause of the "AI writing service isn't available" error

The app began life as a Claude Artifact. Email generation called Claude's
**private, in-page AI helper** (`window.claude.complete`), which only exists
inside the Artifact sandbox. Once the app was exported to a plain `index.html`
and hosted on Cloudflare Pages, that helper no longer exists, so every
**Generate email** click failed with *"The AI writing service isn't available
in this environment."*

The fix is to move the AI call **off the browser and onto the server**. The key
must never live in the browser, so we use a Cloudflare Pages Function.

---

## Architecture

```
Campaign Studio (browser)
        │  POST /api/generate  { messages, tools, maxTokens }
        ▼
Cloudflare Pages Function  (functions/api/generate.js)
        │  adds secret ANTHROPIC_API_KEY  (server-only)
        ▼
Anthropic Messages API  →  { text }  back to the browser
```

- The **Anthropic API key never touches the browser**, frontend JS, local/session
  storage, the repo, or backups.
- Frontend and function share the same Cloudflare domain, so there is **no CORS**
  and no permissive cross-origin config.

---

## Project structure

```
EnterpryzeCampaignStudio/
├── index.html               # the app (unchanged except callClaude → /api/generate)
├── functions/
│   └── api/
│       └── generate.js      # Cloudflare Pages Function: talks to Anthropic
└── README.md
```

Cloudflare Pages automatically turns anything under `functions/` into serverless
routes. `functions/api/generate.js` becomes `POST /api/generate`. **No build step
and no extra config file are required.**

---

## Configuration (Cloudflare dashboard)

**Settings → Environment variables** (for the **Production** environment, and
Preview too if you use preview deploys):

| Name | Type | Required | Value |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Secret (encrypted)** | Yes | your Anthropic key (`sk-ant-…`) |
| `ANTHROPIC_MODEL` | Plaintext | No | e.g. `claude-sonnet-4-5-20250929` (defaults to this) |
| `ALLOWED_ORIGINS` | Plaintext | No | extra origins to allow, comma-separated |

---

## Setup — step by step

### 1. Put the files in GitHub

Match the structure above **exactly** — the folder path `functions/api/` is what
makes the route work.

- **GitHub website:** open the `EnterpryzeCampaignStudio` repo → **Add file →
  Upload files**. Drag `index.html` in. To create the nested folders, click
  **Add file → Create new file**, type `functions/api/generate.js` in the name box
  (the slashes create the folders), paste the contents, and commit. Do the same
  for `README.md`.
- **Command line:**
  ```bash
  git add index.html functions/api/generate.js README.md
  git commit -m "Move AI generation to a secure Cloudflare Pages Function"
  git push origin main
  ```

### 2. Add the API key as an encrypted secret

1. Cloudflare dashboard → **Workers & Pages** → your **enterpryzecampaignstudio** project.
2. **Settings → Environment variables → Production → Add variable.**
3. Name: `ANTHROPIC_API_KEY`. Value: your Anthropic key.
4. Click **Encrypt** so it becomes a secret (value hidden after saving). **Save.**

### 3. (Optional) Pin a model

Same screen, add `ANTHROPIC_MODEL` (plaintext) if you want to override the default.

### 4. Trigger a deployment

Pushing to `main` (step 1) auto-deploys. If you added the secret *after* the last
push, redeploy so the function picks it up: **Deployments → latest → ⋯ → Retry
deployment** (or push any small commit).

### 5. Confirm the function deployed

- **Deployments → (latest) → Functions** should list a route for `/api/generate`.
- Quick check from a terminal (should return JSON `{"error":"Method not
  allowed. Use POST."}`, **not** a 404 HTML page):
  ```bash
  curl https://enterpryzecampaignstudio.pages.dev/api/generate
  ```

### 6. Test Generate email

Open the site → open an audience → **Generate email**. You should see the loading
state, then a draft with subject, preview, angle, body, CTA, Emma signature and PS.

### 7. If it fails — inspect logs

Cloudflare dashboard → your Pages project → **Functions → Logs** (Real-time logs),
click **Begin log stream**, then click Generate email again. Full Anthropic errors
are logged here (users only ever see a friendly message).

### 8. Roll back

**Deployments** → pick a previously working deployment → **⋯ → Rollback to this
deployment**. The permanent URL stays the same.

---

## Security notes

- **Origin check** (`Origin` header allow-list) blocks casual cross-site use, but
  it is **not authentication** — an `Origin` header can be forged by a non-browser
  client. It only stops other *websites* from calling your endpoint via a browser.
- **Request validation:** the function rejects non-POST methods, oversized bodies
  (>100 KB), missing/malformed prompts, and clamps `max_tokens` to 4000.
- **For real access control** (so only Enterpryze team members can open and use the
  app), add **Cloudflare Access** in front of the whole project later:
  *Zero Trust → Access → Applications → Add a self-hosted app* pointing at
  `enterpryzecampaignstudio.pages.dev`, with an email/identity policy. Not required
  for this first technical test.

---

## What did NOT change

Everything else is preserved: branding, purple/pink design, audiences, planning
board, follow-ups, history, data page, new-audience form, scheduling, fortnightly
cadence, owners, regions, email history, engaged contacts, contact imports,
download/restore backup, Mailchimp merge tags (`*|FNAME|*`, `*|COMPANY|*`), the
Emma signature, CTA and PS, and all seeded industry descriptions and pain points.
Storage keys, audience IDs and backup format are unchanged, so existing browser
data keeps loading.
