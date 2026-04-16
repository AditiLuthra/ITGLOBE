# Amplify

An event awareness agent for NYC & Houston pop-ups. Drafts emails, Reddit posts, WhatsApp, Substack, Eventbrite, Partiful, and iMessage broadcasts — in the organizer's own words.

## Stack

- Node.js + Express backend
- Vanilla single-page frontend (`public/`)
- Anthropic API with web search for auto-fetching partner events (Partiful, Luma, Eventbrite)
- AppleScript bridge to Mac Messages for iMessage sends

## Run locally

```bash
npm install
cp .env.example .env
# add your ANTHROPIC_API_KEY to .env
npm start
```

Open http://localhost:3000.

## Flow

1. **Brief** — event name, date, time, venue, address, blurb. Toggle my event / partner / collab. For partner/collab, paste a URL and hit Fetch — Anthropic's `web_search` tool extracts and auto-fills the fields.
2. **Channels** — pick where to publish: journalist email, Shopify subscriber email, Reddit (r/nyc + r/queens), WhatsApp, Substack, Eventbrite, Partiful, iMessage. For iMessage, filter contacts by group tag.
3. **Drafts & send** — each channel gets a draft you can edit and copy. iMessage sends via AppleScript with 45–90 second random delays and a live progress panel.

## Contacts

- `contacts.json` at repo root stores contacts with `name`, `phone`, `tags[]`.
- Add manually in the Contacts tab, or drag a `.vcf` file onto the drop zone — it's parsed server-side.
- Group tags (e.g. `local friends`, `press`, `influencers`) drive iMessage recipient filtering.

## iMessage / AppleScript

Only works on macOS with the Messages app configured. The server refuses the send endpoint on other platforms. This cannot be hosted on Vercel — run it on your Mac for iMessage. The rest of the app (fetch, draft generation, contacts, copy buttons) works anywhere Node runs.

## Writing rules

- Never rewrite the organizer's voice.
- Adapt length and framing only; use their exact words.
- Always include day, date, time, venue, address in every draft.
- iMessage uses a fixed, non-AI template:
  > Hi [first name]! Wanted to send along my next event! No pressure as always to come. Would love if you could share w any friends that may be interested :) [event link or venue + date if no link]

## Files

```
server.js            Express API + AppleScript bridge
public/index.html    SPA shell
public/styles.css    Warm minimal type-driven design
public/app.js        Client logic
contacts.json        Local contact store
.env                 ANTHROPIC_API_KEY=…
```
