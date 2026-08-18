# Publishing the Chrome extension

Uploading and submitting a new version is automated via the [Chrome Web Store
Publish API](https://developer.chrome.com/docs/webstore/using-api) —
`scripts/publish-extension.mjs` builds, zips, uploads, and submits for review
with no browser interaction. What Google does **not** let you automate is the
human review itself, and the one-time credential setup below, which has to be
done once, by hand, by whoever owns the Web Store listing.

## One-time setup

1. **Create a Google Cloud project** (or reuse one) at
   [console.cloud.google.com](https://console.cloud.google.com/).
2. **Enable the Chrome Web Store API**: APIs & Services → Library → search
   "Chrome Web Store API" → Enable.
3. **Create OAuth credentials**: APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Application type **Desktop app**. This
   gives you a **client ID** and **client secret**.
4. **Get a refresh token**, authorized as the account that owns the
   extension's Web Store listing. The simplest way is
   [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - Gear icon (top right) → check "Use your own OAuth credentials" → paste
     the client ID and secret from step 3.
   - In the scope box on the left, enter
     `https://www.googleapis.com/auth/chromewebstore` → Authorize APIs.
   - Sign in as the Web Store account, approve.
   - Click "Exchange authorization code for tokens" → copy the **refresh
     token**. This value doesn't expire on its own (only if revoked or
     unused for 6 months), which is why it's the one worth storing.
5. **Find the extension ID**: it's in the listing's dashboard URL —
   `chromewebstore.google.com/detail/.../<this-part>` — or on the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Wiring it into GitHub Actions

Add four repository secrets (Settings → Secrets and variables → Actions):

| Secret | From |
| --- | --- |
| `CHROME_EXTENSION_ID` | step 5 |
| `CHROME_CLIENT_ID` | step 3 |
| `CHROME_CLIENT_SECRET` | step 3 |
| `CHROME_REFRESH_TOKEN` | step 4 |

That's everything [.github/workflows/publish-extension.yml](../.github/workflows/publish-extension.yml)
needs. It runs on:

- **pushing a tag** like `extension-v0.1.2` — must match the version in
  `extension/manifest.json`, or the workflow fails before touching the API
- **manual dispatch** (Actions tab → publish-extension → Run workflow), with
  an "upload only" checkbox to leave the new version as a draft instead of
  submitting it for review

To gate publishing behind manual approval, add required reviewers to the
`chrome-web-store` environment (Settings → Environments) — no workflow change
needed.

## Releasing a new version

1. Bump `"version"` in `extension/manifest.json`.
2. Commit, then tag: `git tag extension-v0.1.3 && git push origin extension-v0.1.3`.
3. Watch the Actions run. It builds, zips, uploads, and submits for review.
4. Review turnaround is Google's, not ours — typically fast for
   narrowly-scoped permission changes, up to a few weeks otherwise. The
   listing goes live automatically once approved (that's the "publish
   automatically after it has passed review" behavior).

## Running it locally

```
CHROME_EXTENSION_ID=... CHROME_CLIENT_ID=... CHROME_CLIENT_SECRET=... CHROME_REFRESH_TOKEN=... \
  npm run publish:extension
```

Flags (pass after `--`, e.g. `npm run publish:extension -- --upload-only`):

- `--upload-only` — upload but don't submit for review
- `--skip-build` — zip the existing `dist-extension/` instead of rebuilding
- `--target=trustedTesters` — publish to trusted testers instead of everyone
- `--zip-only=out.zip` — just build and zip; no credentials needed, doesn't
  touch the API at all. Useful for producing a package to inspect or upload
  by hand.
