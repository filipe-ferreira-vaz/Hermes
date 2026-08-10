# Hermes Dashboard — Walkthrough

## Overview

The Hermes Dashboard is a local web application that connects to Google Calendar, fetches upcoming events, parses participant data, and manages automated email scheduling via a dark-mode dashboard UI.

**Key architecture decision**: Emails are scheduled through **Google Sheets + Apps Script** so they send even when your PC is off. The local server writes scheduled jobs to a Google Sheet, and a time-driven Apps Script reads the Sheet and sends emails via `GmailApp`.

---

## Project Structure

```
Hermes-Mailer/
├── server.js                  # Express entry point (async init)
├── package.json               # Dependencies (sql.js, no native builds)
├── .env.example               # Configuration template
├── .gitignore                 # Ignores .env, node_modules, *.db
├── src/
│   ├── database.js            # SQLite via sql.js (pure JS, no Python needed)
│   ├── calendar.js            # Google Calendar sync + event cancellation
│   ├── sheets.js              # Google Sheets email job management
│   ├── mailer.js              # Nodemailer SMTP (Send Immediately only)
│   ├── scheduler.js           # Schedule / cancel / send-now orchestration
│   └── routes.js              # All REST API endpoints
└── public/
    ├── index.html             # SPA shell with sidebar, tabs, modals
    ├── css/styles.css         # Full dark design system (~2000 lines)
    └── js/
        ├── api.js             # Fetch-based API client
        ├── app.js             # Tab navigation, event cards, toasts, search
        ├── modal.js           # Event detail modal with live email preview
        ├── templates.js       # Template CRUD management
        └── signatures.js      # Signature CRUD with rich text editor
```

---

## Event Cancellation Flow

> [!IMPORTANT]
> When a Google Calendar event is deleted, and the email was already scheduled, the email is automatically canceled on the Google Sheet.

The flow works as follows:

```mermaid
graph TD
    A["Calendar Sync Runs<br>(every 5 min)"] --> B["Fetch upcoming events<br>from Google Calendar"]
    B --> C{"Event in DB but NOT<br>in fetched results?"}
    C -->|No| D["Update or insert events"]
    C -->|Yes| E{"Was status<br>'scheduled'?"}
    E -->|No| F["Mark as 'canceled' in DB"]
    E -->|Yes| G["Call sheets.cancelEmailJob()"]
    G --> H["Update Sheet row status<br>to 'canceled'"]
    H --> F
```

**Code locations**:
- [calendar.js](./src/calendar.js) — Detects deleted events and cancels Sheet jobs
- [sheets.js](./src/sheets.js) — `cancelEmailJob()` finds and updates the Sheet row
- [scheduler.js](./src/scheduler.js) — Manual cancel from dashboard UI

---

## Bugs Fixed During Review

| Bug | File | Fix |
|-----|------|-----|
| API responses wrapped in `{events}`, `{templates}` etc. but JS accessed bare arrays | app.js, modal.js, templates.js, signatures.js | Added `data.events \|\| data` destructuring |
| Google Calendar IDs are strings, not numbers — `onclick="handleFastSchedule(${id})"` broke | app.js | Switched to `addEventListener` with closure |
| Badge polling used `stats.new_canceled_count` but API returns `stats.newCanceledCount` | app.js | Fixed key name |
| Signature field name: DB uses `content`, JS used `body` | modal.js, signatures.js | Changed to `content` |
| Apps Script called `UrlFetchApp.fetch(localhost)` — unreachable from Google servers | index.html | Rewrote to use `SpreadsheetApp` + `GmailApp` directly |
| Email preview API: client sent POST, server expected GET | api.js | Changed to GET with URLSearchParams |
| `better-sqlite3` requires Python/C++ for native compilation | package.json, database.js | Replaced with `sql.js` (pure JavaScript SQLite) |
| `initDatabase()` became async (sql.js) but server called it synchronously | server.js | Wrapped in `async startServer()` |
| Rich text toolbar buttons had `data-command` but no event handlers | signatures.js | Added click handlers for all toolbar commands |
| Setup guide toggle replaced button `textContent`, losing the icon span | signatures.js | Fixed to toggle `hidden`/`active` and update icon only |

---

## Verification Results

| Test | Result |
|------|--------|
| `npm install` | ✅ 107 packages, no native build errors |
| Server starts on port 3000 | ✅ `To open the dashboard, press CTRL + this link: http://localhost:3000` |
| `GET /api/stats` | ✅ `{newCanceledCount: 0, totalPending: 0, ...}` |
| `GET /api/templates` | ✅ Default template with `is_active: 1` |
| `GET /api/signatures` | ✅ Default signature with `content` field |
| `GET /api/events?status=pending` | ✅ `{events: []}` |
| Google API errors (expected with placeholder .env) | ✅ Gracefully handled, server continues running |

---

## Setup Instructions

### 1. Configure `.env`

Edit the `.env` file with your real credentials:

```env
# Google Service Account (from Google Cloud Console)
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Your Google Calendar ID
GOOGLE_CALENDAR_ID=your-calendar@group.calendar.google.com

# Google Sheet ID (create a blank Sheet, share it with the service account)
GOOGLE_SHEET_ID=1abc...xyz

# SMTP for "Send Immediately" (Gmail App Password recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password

# Sender display name
EMAIL_FROM_NAME=Your Name
```

### 2. Google Cloud Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Calendar API** and **Google Sheets API**
3. Create a **Service Account** → download JSON key
4. Copy the `client_email` and `private_key` to your `.env`
5. **Share your Google Calendar** with the service account email (Reader access)
6. **Share your Google Sheet** with the service account email (Editor access)

### 3. Apps Script Setup (for offline email sending)

1. Open your Google Sheet → **Extensions → Apps Script**
2. Paste the code from the **Setup Guide** section in the dashboard's Settings tab
3. Run it once to authorize, then set a **1-minute time-driven trigger**

### 4. Run

```bash
npm start
```

The dashboard opens automatically at `http://localhost:3000`.

### 5. Calendar Event Format

Events should have descriptions in the format:
```
Participant: FirstName LastName (email@example.com)
```

The event title can use `Event Name - Extra Info` format (only the part before ` - ` is used as the event name).
