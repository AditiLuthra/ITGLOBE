import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const CONTACTS_PATH = path.join(__dirname, 'contacts.json');
const MODEL = 'claude-opus-4-5';
const FAST_MODEL = 'claude-sonnet-4-5';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- contacts ----------

async function readContacts() {
  try {
    const raw = await fs.readFile(CONTACTS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.contacts) ? data.contacts : [];
  } catch {
    return [];
  }
}

async function writeContacts(contacts) {
  await fs.writeFile(CONTACTS_PATH, JSON.stringify({ contacts }, null, 2));
}

app.get('/api/contacts', async (_req, res) => {
  const contacts = await readContacts();
  res.json({ contacts });
});

app.post('/api/contacts', async (req, res) => {
  const { name, phone, tags } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
  const contacts = await readContacts();
  const contact = {
    id: randomUUID(),
    name: String(name).trim(),
    phone: normalizePhone(phone),
    tags: Array.isArray(tags) ? tags.filter(Boolean) : (tags ? [String(tags).trim()] : []),
  };
  contacts.push(contact);
  await writeContacts(contacts);
  res.json({ contact });
});

app.delete('/api/contacts/:id', async (req, res) => {
  const contacts = await readContacts();
  const next = contacts.filter((c) => c.id !== req.params.id);
  await writeContacts(next);
  res.json({ ok: true });
});

app.post('/api/contacts/import-vcf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const parsed = parseVCF(req.file.buffer.toString('utf8'));
  const defaultTag = (req.body?.tag || '').toString().trim();
  const existing = await readContacts();
  const existingPhones = new Set(existing.map((c) => c.phone));
  const added = [];
  for (const p of parsed) {
    if (!p.phone || existingPhones.has(p.phone)) continue;
    const contact = {
      id: randomUUID(),
      name: p.name || 'Unknown',
      phone: p.phone,
      tags: defaultTag ? [defaultTag] : [],
    };
    existing.push(contact);
    added.push(contact);
    existingPhones.add(p.phone);
  }
  await writeContacts(existing);
  res.json({ added: added.length, contacts: added });
});

function normalizePhone(raw) {
  const s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.length === 10) return '+1' + s;
  if (s.length === 11 && s.startsWith('1')) return '+' + s;
  return s;
}

function parseVCF(text) {
  const cards = text.split(/END:VCARD/i).map((c) => c.trim()).filter(Boolean);
  const contacts = [];
  for (const card of cards) {
    let name = '';
    let phone = '';
    for (const rawLine of card.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^FN[:;]/i.test(line)) {
        name = line.split(':').slice(1).join(':').trim();
      } else if (/^N[:;]/i.test(line) && !name) {
        const parts = line.split(':').slice(1).join(':').split(';');
        name = [parts[1], parts[0]].filter(Boolean).join(' ').trim();
      } else if (/^TEL/i.test(line) && !phone) {
        phone = normalizePhone(line.split(':').slice(1).join(':'));
      }
    }
    if (name || phone) contacts.push({ name, phone });
  }
  return contacts;
}

// ---------- event auto-fetch (web search) ----------

app.post('/api/fetch-event', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });

    const prompt = `Use web search to look up this event page and extract its details: ${url}

Return ONLY a single JSON object with these keys (no markdown, no commentary):
{
  "name": "",
  "date": "YYYY-MM-DD",
  "time_start": "HH:MM",
  "time_end": "HH:MM or empty string if no end time",
  "venue_name": "",
  "address": "",
  "blurb": "organizer's own words describing the event, preserved verbatim where possible"
}

If a field is unknown leave it as an empty string. Use 24-hour time. Preserve the organizer's voice exactly in the blurb.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: prompt }],
    });

    const text = extractText(response);
    const json = extractJSON(text);
    if (!json) return res.status(502).json({ error: 'could not parse event', raw: text });
    res.json({ event: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function extractText(response) {
  if (!response?.content) return '';
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ---------- draft generation ----------

const CHANNEL_SPECS = {
  journalist_email: {
    label: 'Journalist email',
    guidance: `A short, direct pitch email to a local culture journalist. Subject line on first line prefixed with "Subject: ". Keep it 120–180 words. Lead with the hook, then a sentence of context, then the practical details (day, date, time, venue, address). Close with a warm sign-off and offer to share imagery or set up an interview. No hype words, no emoji.`,
  },
  subscriber_email: {
    label: 'Shopify subscriber email',
    guidance: `An email to the brand's Shopify subscriber list. Subject line on first line prefixed with "Subject: ". 90–140 words. Friendly, inviting, first-person-plural. Preserve the blurb verbatim as one paragraph, surround it with a warm opening and a clear CTA line listing day, date, time, venue, address. End with a PS that feels human.`,
  },
  reddit_nyc: {
    label: 'Reddit — r/nyc + r/queens',
    guidance: `Two short Reddit posts, one for r/nyc and one for r/queens. Format as:\n\nr/nyc\nTitle: ...\nBody: ...\n\nr/queens\nTitle: ...\nBody: ...\n\nNo self-promo tone. Conversational, low-key, "hey, this is happening, come hang" energy. 60–110 words per body. Always list day, date, time, venue, address. No emoji.`,
  },
  whatsapp_broadcast: {
    label: 'WhatsApp broadcast draft',
    guidance: `A single WhatsApp broadcast message. Warm, short (50–80 words), 1–2 line breaks max. Lead with the event name, then the blurb in the organizer's words (lightly trimmed only if needed), then day, date, time, venue, address on separate lines. End with one line inviting forwarding.`,
  },
  substack_post: {
    label: 'Substack post draft',
    guidance: `A Substack post. Title on first line prefixed with "Title: ". 200–320 words, 2–4 short paragraphs. Opens with scene/voice, keeps the organizer's blurb intact as its own paragraph, and lands with practical details: day, date, time, venue, address, and how to RSVP/attend. Warm, essayistic, personal.`,
  },
  eventbrite_listing: {
    label: 'Eventbrite listing',
    guidance: `A full Eventbrite listing. Format:\n\nTitle: ...\nSummary (under 140 chars): ...\nDescription: 2–3 short paragraphs, preserving the organizer's blurb verbatim as one paragraph.\nDetails:\n- Day & date\n- Time\n- Venue\n- Address\n\nNo price, no ticket tiers — those are set in Eventbrite.`,
  },
  partiful_copy: {
    label: 'Partiful invite copy',
    guidance: `Partiful invite copy. Format:\n\nEvent name: ...\nTagline (one line, under 80 chars): ...\nDescription: 40–90 words, playful, preserves the organizer's voice. Include day, date, time, venue, address on their own lines at the end.`,
  },
};

app.post('/api/generate-drafts', async (req, res) => {
  try {
    const { event, channels, eventType } = req.body || {};
    if (!event) return res.status(400).json({ error: 'event required' });
    const selected = (channels || []).filter((c) => CHANNEL_SPECS[c]);
    if (!selected.length) return res.json({ drafts: {} });

    const dayOfWeek = computeDayOfWeek(event.date);
    const timeStr = event.time_end
      ? `${event.time_start}–${event.time_end}`
      : `${event.time_start} (open end)`;

    const context = `EVENT BRIEF
Name: ${event.name}
Day: ${dayOfWeek}
Date: ${event.date}
Time: ${timeStr}
Venue: ${event.venue_name}
Address: ${event.address}
Event type: ${eventType || 'my_event'}

Organizer's blurb (DO NOT REWRITE — use exact words, only adjust length/framing):
"""
${event.blurb || ''}
"""

GLOBAL RULES
- Never rewrite the organizer's voice. Adapt length and framing only. Use their exact words.
- Always include day, date, time, venue name, and address somewhere in the draft.
- Plain text only. No markdown headers unless specified. No emoji unless the blurb already uses them.
- Do not invent facts (prices, performers, RSVP links) that aren't in the brief.`;

    const results = await Promise.all(
      selected.map(async (channelKey) => {
        const spec = CHANNEL_SPECS[channelKey];
        const prompt = `${context}\n\nCHANNEL: ${spec.label}\n${spec.guidance}\n\nReturn only the draft text, nothing else.`;
        try {
          const resp = await anthropic.messages.create({
            model: FAST_MODEL,
            max_tokens: 1200,
            messages: [{ role: 'user', content: prompt }],
          });
          return [channelKey, extractText(resp).trim()];
        } catch (err) {
          return [channelKey, `[error generating draft: ${err.message}]`];
        }
      })
    );

    const drafts = Object.fromEntries(results);
    res.json({ drafts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function computeDayOfWeek(date) {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ---------- iMessage send (local only, AppleScript) ----------

const imessageJobs = new Map();

app.post('/api/imessage/send', async (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(400).json({ error: 'iMessage sending only works on macOS (darwin). Run this app locally on a Mac.' });
  }
  const { template, recipients } = req.body || {};
  if (!template || !Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ error: 'template and recipients required' });
  }
  const job = {
    id: randomUUID(),
    items: recipients.map((r) => ({
      id: randomUUID(),
      name: r.name,
      phone: r.phone,
      status: 'queued',
      error: null,
    })),
    createdAt: Date.now(),
  };
  imessageJobs.set(job.id, job);
  runImessageJob(job, template).catch((err) => console.error('imessage job error', err));
  res.json({ jobId: job.id, items: job.items });
});

app.get('/api/imessage/status/:id', (req, res) => {
  const job = imessageJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ jobId: job.id, items: job.items });
});

async function runImessageJob(job, template) {
  for (const item of job.items) {
    item.status = 'sending';
    const firstName = (item.name || '').trim().split(/\s+/)[0] || 'there';
    const body = template.replace(/\[first name\]/gi, firstName);
    try {
      await sendIMessage(item.phone, body);
      item.status = 'sent';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
    // 45–90s random delay between sends, except after the last
    if (item !== job.items[job.items.length - 1]) {
      const delay = 45000 + Math.floor(Math.random() * 45000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

function sendIMessage(phone, body) {
  return new Promise((resolve, reject) => {
    const script = `
on run argv
  set phoneNumber to item 1 of argv
  set messageBody to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy phoneNumber of targetService
    send messageBody to targetBuddy
  end tell
end run`;
    execFile('osascript', ['-e', script, phone, body], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr?.toString().trim() || err.message));
      resolve();
    });
  });
}

// ---------- start ----------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    platform: process.platform,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.listen(PORT, () => {
  console.log(`Amplify running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠  ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
  }
});
