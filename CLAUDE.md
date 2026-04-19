# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server (proxies /api to localhost:3000)
npm run build    # Production build to dist/
npm run lint     # ESLint (React hooks, React refresh)
```

No test framework is configured.

## Versioning

Every time a PR is created, increment the minor version in package.json by 0.1 (e.g., 2.4.0 → 2.5.0).

## Architecture

Gmail Cleaner is a Vercel-deployed React SPA that automates email cleanup across multiple Gmail accounts (OAuth2) and one IMAP account (Hostinger). It uses Claude Haiku for AI classification, Telegram for notifications, and Upstash Redis for caching.

**Frontend:** Single React 19 component (`src/App.jsx`, ~1085 lines) — all UI and state in one file. No external state manager; uses hooks + localStorage for preferences (safe senders, trash counts, spam list).

**Backend:** 12 Vercel Serverless Functions in `api/` (at Vercel's limit — do not add new files). Shared libraries live in `api/_lib/` which does not count toward the limit.

### Data Flow

```
Scan (Gmail API + IMAP) → Categorize (listing/trauma/inbox)
  → AI classify unknown senders (Claude Haiku, cached in Redis 30d)
  → Review UI: user cycles trash/spam/keep
  → Process listings: Claude extracts property details → evaluate vs ZIP criteria → Telegram if match → trash
  → Process trauma: extract Excel attachment → forward to Telegram → trash
  → Execute batch actions → Telegram summary
```

Two entry points trigger this flow:
1. **Web UI** — user-driven, step-by-step through `App.jsx`
2. **Telegram `/clean` command** — fully automated via `telegram-webhook.js`

### Listing Sources

Emails from these senders are treated as real estate listings and processed through Claude extraction + ZIP criteria evaluation:
- Zillow (subject contains "new listing" or "price cut")
- New Western (`newwestern.com`)
- Carly Stone

### Key Modules

| File | Role |
|------|------|
| `api/_lib/imap.js` | `withImap(fn)` — opens IMAP connection, locks INBOX, runs callback, cleans up. Each call is a fresh connection. |
| `api/_lib/listings.js` | Claude prompt for property extraction, ZIP criteria evaluation (`criteria.js`), Telegram formatting |
| `api/_lib/telegram.js` | `sendTelegram(text)` and `sendTelegramDocument(buffer, filename, caption)` |
| `api/_lib/gmail.js` | Gmail API wrappers: search, trash, mark read, labels, message retrieval, token refresh |
| `api/claude.js` | Multi-action endpoint: `action:"classify"` (AI batch classification, Redis-cached), `action:"notify"` (Telegram proxy), or raw Claude API proxy |
| `api/telegram-webhook.js` | Telegram bot `/clean` handler — scans all accounts, processes everything, sends single summary |

### Redis Keys (Upstash)

- `gmail_accounts` — `[{email, refreshToken}]` for bot automation
- `classifier:{accountId}:{senderEmail}` — AI classification cache (30-day TTL)
- `seen_senders:{accountId}` — set of classified sender emails

### Environment Variables

```
VITE_GOOGLE_CLIENT_ID    GOOGLE_CLIENT_SECRET
KV_REST_API_URL          KV_REST_API_TOKEN
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN       TELEGRAM_CHAT_ID
HOSTINGER_EMAIL          HOSTINGER_PASSWORD       HOSTINGER_IMAP_HOST
```

### Deployment

Vercel with custom function durations in `vercel.json`: `telegram-webhook.js` and `process-trauma.js` get 60s; `process-listings.js` and `claude.js` get 30s.
