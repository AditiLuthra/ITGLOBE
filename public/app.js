// Amplify — frontend SPA

const state = {
  step: 1,
  eventType: 'my_event',
  event: {
    name: '', date: '', time_start: '', time_end: '',
    venue_name: '', address: '', blurb: '',
    no_end: false,
    include_eventbrite: false,
    include_partiful: false,
  },
  channels: new Set(),
  contacts: [],
  selectedGroups: new Set(),
  drafts: {},
  jobId: null,
  pollTimer: null,
};

const IMESSAGE_TEMPLATE = `Hi [first name]! Wanted to send along my next event! No pressure as always to come. Would love if you could share w any friends that may be interested :) [event link or venue + date if no link]`;

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('view-' + t.dataset.view).classList.add('active');
    if (t.dataset.view === 'contacts') loadContacts();
  });
});

// ---------- event type toggle ----------
const eventTypeEl = document.getElementById('event-type');
eventTypeEl.querySelectorAll('.seg').forEach((b) => {
  b.addEventListener('click', () => {
    eventTypeEl.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.eventType = b.dataset.type;
    updateEventTypeUI();
  });
});

function updateEventTypeUI() {
  const isMine = state.eventType === 'my_event';
  document.body.classList.toggle('not-my', !isMine);
  document.getElementById('fetch-block').classList.toggle('hidden', isMine);
  document.getElementById('my-event-only').classList.toggle('hidden', !isMine);
  // clear channel selections that don't apply
  if (!isMine) {
    ['eventbrite_listing', 'partiful_copy'].forEach((k) => state.channels.delete(k));
    document
      .querySelectorAll('.channel-card.my-only input[type="checkbox"]')
      .forEach((i) => (i.checked = false));
  }
}
updateEventTypeUI();

// ---------- field bindings ----------
const bind = (id, key, type = 'value') => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    state.event[key] = type === 'checked' ? el.checked : el.value;
    if (key === 'date') updateDayOfWeek();
    if (key === 'no_end') {
      document.getElementById('ev-end').disabled = el.checked;
      if (el.checked) state.event.time_end = '';
    }
  });
};
bind('ev-name', 'name');
bind('ev-date', 'date');
bind('ev-start', 'time_start');
bind('ev-end', 'time_end');
bind('ev-no-end', 'no_end', 'checked');
bind('ev-venue', 'venue_name');
bind('ev-address', 'address');
bind('ev-blurb', 'blurb');
bind('inc-eventbrite', 'include_eventbrite', 'checked');
bind('inc-partiful', 'include_partiful', 'checked');

function updateDayOfWeek() {
  const dow = document.getElementById('ev-dow');
  if (!state.event.date) { dow.textContent = ''; return; }
  const d = new Date(state.event.date + 'T12:00:00');
  if (isNaN(d)) { dow.textContent = ''; return; }
  dow.textContent = '· ' + d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ---------- fetch partner event ----------
document.getElementById('fetch-btn').addEventListener('click', async () => {
  const url = document.getElementById('fetch-url').value.trim();
  const btn = document.getElementById('fetch-btn');
  const status = document.getElementById('fetch-status');
  if (!url) { status.textContent = 'paste a URL first'; status.className = 'status error'; return; }
  btn.disabled = true;
  status.textContent = 'fetching via web search…';
  status.className = 'status';
  try {
    const r = await fetch('/api/fetch-event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'fetch failed');
    applyEvent(data.event);
    status.textContent = 'filled from ' + new URL(url).hostname;
    status.className = 'status ok';
  } catch (err) {
    status.textContent = err.message;
    status.className = 'status error';
  } finally {
    btn.disabled = false;
  }
});

function applyEvent(ev) {
  const set = (id, v) => { const el = document.getElementById(id); if (v != null) { el.value = v; el.dispatchEvent(new Event('input')); } };
  set('ev-name', ev.name);
  set('ev-date', ev.date);
  set('ev-start', ev.time_start);
  set('ev-end', ev.time_end);
  set('ev-venue', ev.venue_name);
  set('ev-address', ev.address);
  set('ev-blurb', ev.blurb);
  if (!ev.time_end) {
    document.getElementById('ev-no-end').checked = true;
    document.getElementById('ev-no-end').dispatchEvent(new Event('input'));
  }
}

// ---------- step navigation ----------
document.querySelectorAll('[data-next]').forEach((b) =>
  b.addEventListener('click', () => goToStep(parseInt(b.dataset.next, 10)))
);
document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => goToStep(parseInt(b.dataset.back, 10)))
);

function goToStep(n) {
  if (n === 2 && !validateBrief()) return;
  state.step = n;
  document.querySelectorAll('.step').forEach((s) => {
    const sn = parseInt(s.dataset.step, 10);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');

  if (n === 2) preselectChannels();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateBrief() {
  const e = state.event;
  const missing = [];
  if (!e.name) missing.push('name');
  if (!e.date) missing.push('date');
  if (!e.time_start) missing.push('start time');
  if (!e.venue_name) missing.push('venue');
  if (!e.address) missing.push('address');
  if (!e.blurb) missing.push('blurb');
  if (missing.length) { toast('missing: ' + missing.join(', ')); return false; }
  return true;
}

function preselectChannels() {
  if (state.eventType === 'my_event') {
    if (state.event.include_eventbrite) toggleChannel('eventbrite_listing', true);
    if (state.event.include_partiful) toggleChannel('partiful_copy', true);
  }
}

function toggleChannel(key, on) {
  const card = document.querySelector(`.channel-card[data-channel="${key}"]`);
  if (!card) return;
  const input = card.querySelector('input');
  input.checked = on;
  if (on) state.channels.add(key); else state.channels.delete(key);
}

// ---------- channel selection ----------
document.querySelectorAll('.channel-card').forEach((card) => {
  const input = card.querySelector('input');
  card.addEventListener('click', (e) => {
    if (e.target !== input) input.checked = !input.checked;
    const key = card.dataset.channel;
    if (input.checked) state.channels.add(key); else state.channels.delete(key);
    if (key === 'imessage') {
      document.getElementById('imessage-contacts').classList.toggle('hidden', !input.checked);
      if (input.checked) loadContactsForImessage();
    }
  });
});

async function loadContactsForImessage() {
  await loadContacts();
  renderGroupChips();
  renderImessagePreview();
}

function renderGroupChips() {
  const tags = new Set();
  state.contacts.forEach((c) => (c.tags || []).forEach((t) => tags.add(t)));
  const container = document.getElementById('group-chips');
  if (!tags.size) {
    container.innerHTML = '<span class="hint">no groups yet — add tagged contacts in the Contacts tab</span>';
    return;
  }
  container.innerHTML = Array.from(tags).sort().map((tag) => `
    <label class="chip"><input type="checkbox" data-tag="${escapeHtml(tag)}" ${state.selectedGroups.has(tag) ? 'checked' : ''}/> ${escapeHtml(tag)}</label>
  `).join('');
  container.querySelectorAll('input').forEach((i) => {
    i.addEventListener('change', () => {
      if (i.checked) state.selectedGroups.add(i.dataset.tag);
      else state.selectedGroups.delete(i.dataset.tag);
      renderImessagePreview();
    });
  });
}

function renderImessagePreview() {
  const preview = document.getElementById('imessage-preview');
  const selected = getImessageRecipients();
  const example = IMESSAGE_TEMPLATE.replace('[first name]', selected[0]?.name.split(' ')[0] || 'Jamie');
  preview.textContent = `${selected.length} recipient${selected.length === 1 ? '' : 's'} · 45–90s delay between sends\n\nPreview:\n${example}`;
}

function getImessageRecipients() {
  if (!state.selectedGroups.size) return [];
  return state.contacts.filter((c) => (c.tags || []).some((t) => state.selectedGroups.has(t)));
}

// ---------- generate drafts ----------
document.getElementById('generate-btn').addEventListener('click', async () => {
  if (!state.channels.size) { toast('pick at least one channel'); return; }
  goToStep(3);
  const drafts = document.getElementById('drafts');
  drafts.innerHTML = '';

  const aiChannels = Array.from(state.channels).filter((c) => c !== 'imessage');
  // render shells
  aiChannels.forEach((k) => drafts.appendChild(makeDraftShell(k)));

  // iMessage panel
  const imPanel = document.getElementById('imessage-panel');
  if (state.channels.has('imessage')) {
    imPanel.classList.remove('hidden');
    renderImessageJobPanel();
  } else {
    imPanel.classList.add('hidden');
  }

  if (!aiChannels.length) return;

  try {
    const r = await fetch('/api/generate-drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: { ...state.event },
        channels: aiChannels,
        eventType: state.eventType,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'generate failed');
    state.drafts = data.drafts || {};
    Object.entries(state.drafts).forEach(([k, text]) => fillDraft(k, text));
  } catch (err) {
    toast(err.message);
    aiChannels.forEach((k) => fillDraft(k, '[error: ' + err.message + ']'));
  }
});

const CHANNEL_LABELS = {
  journalist_email: 'Journalist email',
  subscriber_email: 'Shopify subscriber email',
  reddit_nyc: 'Reddit — r/nyc + r/queens',
  whatsapp_broadcast: 'WhatsApp broadcast',
  substack_post: 'Substack post',
  eventbrite_listing: 'Eventbrite listing',
  partiful_copy: 'Partiful invite',
};

function makeDraftShell(key) {
  const el = document.createElement('div');
  el.className = 'draft-card';
  el.dataset.key = key;
  el.innerHTML = `
    <div class="draft-head">
      <div class="draft-title">${escapeHtml(CHANNEL_LABELS[key] || key)}</div>
      <div class="draft-actions">
        <button class="mini-btn copy-btn">Copy</button>
      </div>
    </div>
    <div class="draft-loading">drafting…</div>
  `;
  return el;
}

function fillDraft(key, text) {
  const card = document.querySelector(`.draft-card[data-key="${key}"]`);
  if (!card) return;
  const loading = card.querySelector('.draft-loading');
  if (loading) loading.remove();
  let ta = card.querySelector('textarea.draft-body');
  if (!ta) {
    ta = document.createElement('textarea');
    ta.className = 'draft-body';
    card.appendChild(ta);
  }
  ta.value = text;
  autoSize(ta);
  ta.addEventListener('input', () => { state.drafts[key] = ta.value; autoSize(ta); });
  const copyBtn = card.querySelector('.copy-btn');
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(ta.value);
    copyBtn.classList.add('copied');
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.textContent = 'Copy'; }, 1500);
  };
}

function autoSize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(140, ta.scrollHeight + 4) + 'px';
}

// ---------- iMessage send ----------
function renderImessageJobPanel() {
  const recipients = getImessageRecipients();
  const progress = document.getElementById('im-progress');
  if (!recipients.length) {
    progress.innerHTML = '<div class="hint">no recipients — pick a group in step 2.</div>';
    document.getElementById('im-send-btn').disabled = true;
    return;
  }
  document.getElementById('im-send-btn').disabled = false;
  progress.innerHTML = recipients.map((c) => `
    <div class="im-row" data-phone="${escapeHtml(c.phone)}">
      <div><strong>${escapeHtml(c.name)}</strong> <span class="phone">${escapeHtml(c.phone)}</span></div>
      <div></div>
      <div class="im-status queued">queued</div>
    </div>
  `).join('');
}

document.getElementById('im-send-btn').addEventListener('click', async () => {
  const recipients = getImessageRecipients();
  if (!recipients.length) return;
  if (!confirm(`Send iMessages to ${recipients.length} people? 45–90s delay between each.`)) return;

  const btn = document.getElementById('im-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const r = await fetch('/api/imessage/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: IMESSAGE_TEMPLATE, recipients }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'send failed');
    state.jobId = data.jobId;
    pollImessage();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = 'Send iMessages';
  }
});

function pollImessage() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (!state.jobId) return;
    try {
      const r = await fetch('/api/imessage/status/' + state.jobId);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      updateImessageProgress(data.items);
      const done = data.items.every((i) => i.status === 'sent' || i.status === 'error');
      if (done) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        const btn = document.getElementById('im-send-btn');
        btn.disabled = false;
        btn.textContent = 'Send again';
        toast('iMessage batch complete');
      }
    } catch (err) {
      clearInterval(state.pollTimer);
      toast(err.message);
    }
  }, 1200);
}

function updateImessageProgress(items) {
  const progress = document.getElementById('im-progress');
  progress.innerHTML = items.map((it) => `
    <div class="im-row">
      <div><strong>${escapeHtml(it.name)}</strong> <span class="phone">${escapeHtml(it.phone)}</span></div>
      <div>${it.error ? `<span class="hint" title="${escapeHtml(it.error)}">error</span>` : ''}</div>
      <div class="im-status ${it.status}">${it.status}</div>
    </div>
  `).join('');
}

// ---------- restart ----------
document.getElementById('restart').addEventListener('click', () => {
  if (!confirm('Start over? This clears your drafts.')) return;
  location.reload();
});

// ---------- contacts tab ----------
async function loadContacts() {
  try {
    const r = await fetch('/api/contacts');
    const data = await r.json();
    state.contacts = data.contacts || [];
    renderContacts();
  } catch (err) { console.error(err); }
}

function renderContacts(filter = '') {
  const list = document.getElementById('contact-list');
  const q = filter.trim().toLowerCase();
  const shown = !q ? state.contacts : state.contacts.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    c.phone.toLowerCase().includes(q) ||
    (c.tags || []).some((t) => t.toLowerCase().includes(q))
  );
  if (!shown.length) {
    list.innerHTML = '<li class="hint" style="grid-template-columns:1fr">no contacts yet.</li>';
    return;
  }
  list.innerHTML = shown.map((c) => `
    <li>
      <span class="contact-name">${escapeHtml(c.name)}</span>
      <span class="contact-phone">${escapeHtml(c.phone)}</span>
      <span class="tag-dots">${(c.tags || []).map((t) => `<span class="tag-dot">${escapeHtml(t)}</span>`).join('')}</span>
      <button class="del-btn" data-id="${c.id}">remove</button>
    </li>
  `).join('');
  list.querySelectorAll('.del-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Remove contact?')) return;
      await fetch('/api/contacts/' + b.dataset.id, { method: 'DELETE' });
      loadContacts();
    })
  );
}

document.getElementById('contact-search').addEventListener('input', (e) => renderContacts(e.target.value));

document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const tags = (f.get('tags') || '').toString().split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const r = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), phone: f.get('phone'), tags }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    e.target.reset();
    toast('added ' + data.contact.name);
    loadContacts();
  } catch (err) { toast(err.message); }
});

// drag-drop vcf
const drop = document.getElementById('drop-zone');
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })
);
drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) uploadVcf(file);
});
document.getElementById('vcf-pick').addEventListener('click', () => document.getElementById('vcf-input').click());
document.getElementById('vcf-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) uploadVcf(file);
});

async function uploadVcf(file) {
  const tag = document.getElementById('vcf-tag').value.trim();
  const fd = new FormData();
  fd.append('file', file);
  if (tag) fd.append('tag', tag);
  try {
    const r = await fetch('/api/contacts/import-vcf', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    toast(`imported ${data.added} contact${data.added === 1 ? '' : 's'}`);
    loadContacts();
  } catch (err) { toast(err.message); }
}

// ---------- helpers ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// initial
loadContacts();
