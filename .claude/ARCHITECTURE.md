# Architecture

## Directory Structure
```
api/                        # Vercel Serverless Functions (12 total — at limit)
  auth/exchange.js          # OAuth2 code -> tokens, stores refresh in Redis
  auth/refresh.js           # Refresh access token
  _lib/gmail.js             # Gmail API wrappers (search, trash, mark read, labels)
  _lib/imap.js              # IMAP client factory + withImap() connection wrapper
  _lib/telegram.js          # sendTelegram(text) + sendTelegramDocument(buffer, name, caption)
  _lib/listings.js          # Zillow listing extraction, evaluation, Telegram formatting
  _lib/criteria.js          # Per-ZIP investment criteria (15228, 15243, 15234, 15212)
  scan.js                   # Fetch unread Gmail emails (is:unread newer_than:7d)
  scan-imap.js              # Fetch unread IMAP emails (7d, categorize listing/trauma/inbox)
  trash.js                  # Mark read + trash Gmail emails
  trash-imap.js             # Move IMAP emails to trash
  spam.js                   # Mark Gmail emails as spam
  spam-imap.js              # Move IMAP emails to spam
  process-listings.js       # Extract listing -> Claude evaluation -> Telegram notify -> trash
  process-trauma.js         # Extract Excel attachment -> forward to Telegram -> trash
  claude.js                 # Multi-action: classify (AI sender classification), notify (Telegram), proxy (Claude API)
  telegram-webhook.js       # Telegram /clean bot command — full automated cleanup
src/
  App.jsx                   # Single-file React app (~1050 lines), all UI + state
  main.jsx                  # React entry point
  index.css                 # Dark theme styles
```

## Data Flow
```
User -> Google OAuth -> Multiple Gmail accounts + 1 IMAP (Hostinger)
  -> Scan (is:unread newer_than:7d)
  -> Categorize: listing | trauma | inbox
  -> Auto-spam known spam senders (threshold: trashed >= 3 times)
  -> AI classify unknown senders (Claude Haiku, cached in Redis)
  -> Review UI: user cycles trash/spam/keep per email
  -> Process listings: Claude extracts -> evaluate vs ZIP criteria -> Telegram if match -> trash all
  -> Process trauma: extract Excel attachment -> forward to Telegram -> trash
  -> Execute actions: mark read + trash/spam/keep
  -> Telegram summary notification
```

## Redis Keys (Upstash)
| Key | Type | Purpose |
|-----|------|---------|
| `gmail_accounts` | JSON array | `[{email, refreshToken}]` for Telegram bot automation |
| `classifier:{accountId}:{senderEmail}` | JSON object | AI classification cache (30-day TTL) |
| `seen_senders:{accountId}` | Set | Sender emails that have been classified |

## Email Sources
- **Gmail**: Multiple accounts via OAuth2. API operations: search, trash, modify labels, get full message
- **IMAP**: Single Hostinger account (`andybot@phillyshah.com`). Operations: search, fetch, move, flag

## claude.js Multi-Action Routing
`POST /api/claude` with `action` field:
- `"classify"` — AI sender classification (batched, cached)
- `"notify"` — Send text message to Telegram
- _(no action)_ — Proxy to Anthropic API

## Environment Variables
```
VITE_GOOGLE_CLIENT_ID       GOOGLE_CLIENT_SECRET
KV_REST_API_URL             KV_REST_API_TOKEN
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN          TELEGRAM_CHAT_ID
HOSTINGER_EMAIL             HOSTINGER_PASSWORD          HOSTINGER_IMAP_HOST
```
