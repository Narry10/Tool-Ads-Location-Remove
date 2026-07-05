# ADS-FOX Action Reminder

The repository contains three deployable parts:

- `gg-ads-extension/`: Chrome Manifest V3 extension.
- `web/`: React/Vite personal reminder dashboard and extension auth bridge.
- `functions/`: scheduled digest generator for Firebase Functions.

## Local verification

```sh
npm run build:extension
npm --prefix web install
npm --prefix functions install
npm run build
npm test
```

Before building a fresh clone, copy each example configuration and fill in the
target Firebase project values:

```sh
cp gg-ads-extension/.env.example gg-ads-extension/.env
cp web/.env.example web/.env
cp functions/.env.example functions/.env
```

`npm run build:extension` generates the ignored
`gg-ads-extension/config.js` required by the unpacked extension. Real `.env`
files, generated extension config, `node_modules`, Vite output, and Firebase
cache files are excluded from Git. Commit only the `.env.example` templates.

## Firebase setup

The configured Firebase project is `remd-c8ddb`.

1. In Firebase Authentication, enable the Google provider.
2. Confirm `remd-c8ddb.web.app` is listed as an authorized Auth domain.
3. Create/enable Firebase Hosting and Cloud Functions (Blaze plan is required for scheduled functions).
4. Deploy rules, indexes, Hosting, and Functions:

```sh
npx firebase-tools login
npx firebase-tools deploy --project remd-c8ddb
```

The web app must be deployed before extension login can work because the extension opens:
`https://remd-c8ddb.web.app/extension-auth`.

Hosting, Firestore rules, and indexes can be deployed on their own with
`firebase deploy --only firestore,hosting`. Deploying `functions` requires the
project to be upgraded to Blaze so Cloud Build and Cloud Scheduler can be enabled.

## Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select `gg-ads-extension/`.
4. Open a Google Ads campaign or matched-locations table and use **Quick Tick**.
5. Sign in with Google through Firebase Authentication. The extension remains locked until authentication succeeds.
6. Complete the action in Google Ads, reopen the popup, and confirm the draft.

Quick Tick does not pause/remove/exclude anything by itself. The user confirmation is the source of truth for the action history.

The popup also contains an always-visible manual action form. A user can enter a
campaign, optional comma-separated countries, an action, and a custom note
without running Quick Tick; the entry is appended to the current draft.

The authenticated popup is organized into three task-focused tabs: Quick Tick,
manual entry, and Draft. Creating a Quick Tick or manual entry automatically
opens Draft, whose badge shows the number of campaigns waiting for confirmation.

The web dashboard is also split into three tabs: reminder history, the signed-in
user's private Discord webhook configuration, and per-user timezone/delivery
time. `testDiscordWebhook` is an authenticated callable Function used by the
"Gửi test ngay" button. `createDailyDigests` runs at 22:45 every day using the
`Asia/Ho_Chi_Minh` scheduler timezone, loads each enabled user's daily campaign
records, and sends one Discord embed report. The Function itself remains in
`us-central1`; Cloud Scheduler performs the timezone conversion.

Discord webhook URLs are credentials. Never commit one to this repository. If a
URL is exposed in chat, logs, or screenshots, regenerate it in Discord before use.

## Firestore action model

Each confirmation stores one action document per campaign, not one document per
country. Location results are embedded in the `countries` array with their own
action, note, and metrics. This keeps the dashboard and future Discord/Telegram
digest to one row/message block per campaign. The dashboard automatically
migrates legacy per-location records owned by the signed-in user to schema v2.
