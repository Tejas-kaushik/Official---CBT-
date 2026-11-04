// The studio desk: enquiries from the site's form, and the work shown on the site.
// Every value from the database is set with textContent, never as HTML.

const $ = (sel, root = document) => root.querySelector(sel);

const state = { enquiries: [], counts: {}, statuses: [], services: {}, filter: '', selected: null, work: [], editing: null };

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/desk${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    showSignin();
    throw new Error(data.error);
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { fields: data.fields });
  return data;
}

// ---------- signing in ----------

function showSignin(message = '') {
  $('#desk').hidden = true;
  $('#signin').hidden = false;
  $('#signin-msg').textContent = message;
  $('#password').focus();
}

async function showDesk() {
  $('#signin').hidden = true;
  $('#desk').hidden = false;
  await Promise.all([loadEnquiries(), loadWork()]);
  openFromLink();
  renderAlerts();
}

// A phone alert links to /admin#enquiry-12: open that enquiry.
function openFromLink() {
  const match = location.hash.match(/^#enquiry-(\d+)$/);
  if (!match) return;
  state.selected = Number(match[1]);
  renderRows();
  renderDetail();
  $('#detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
addEventListener('hashchange', async () => {
  if ($('#desk').hidden) return;
  state.filter = '';
  await loadEnquiries();
  openFromLink();
});

$('#signin-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/login', { method: 'POST', body: { password: $('#password').value } });
    $('#password').value = '';
    await showDesk();
  } catch (err) {
    $('#signin-msg').textContent = err.message;
  }
});

$('#signout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST', body: {} }).catch(() => {});
  showSignin('Signed out.');
});

// ---------- tabs ----------

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-pressed', String(t === tab)));
    $('#panel-enquiries').hidden = tab.dataset.tab !== 'enquiries';
    $('#panel-work').hidden = tab.dataset.tab !== 'work';
  });
});

// ---------- enquiries ----------

async function loadEnquiries() {
  const query = state.filter ? `?status=${encodeURIComponent(state.filter)}` : '';
  Object.assign(state, await api(`/enquiries${query}`));
  $('#new-count').textContent = state.counts.new || '';
  renderFilters();
  renderRows();
  renderDetail();
}

function renderFilters() {
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  const options = [['', `All ${total}`], ...state.statuses.map(s => [s, `${s[0].toUpperCase()}${s.slice(1)} ${state.counts[s] || 0}`])];
  $('#filters').replaceChildren(...options.map(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filter';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(state.filter === value));
    b.addEventListener('click', () => { state.filter = value; loadEnquiries(); });
    return b;
  }));
}

function renderRows() {
  const rows = state.enquiries.map(e => {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.className = e.status === 'new' ? 'is-new' : '';
    tr.setAttribute('aria-selected', String(e.id === state.selected));
    const pill = document.createElement('span');
    pill.className = `pill${e.status === 'new' ? ' pill--new' : ''}`;
    pill.textContent = e.status;
    const cells = [when.format(new Date(e.created_at)), e.name, e.brand, state.services[e.service] || e.service];
    tr.append(...cells.map(text => Object.assign(document.createElement('td'), { textContent: text })));
    const td = document.createElement('td');
    td.append(pill);
    tr.append(td);
    const open = () => { state.selected = e.id; renderRows(); renderDetail(); };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    return tr;
  });
  $('#enquiry-rows').replaceChildren(...rows);
  $('#enquiry-empty').hidden = rows.length > 0;
}

function renderDetail() {
  const e = state.enquiries.find(x => x.id === state.selected);
  const box = $('#detail');
  box.hidden = !e;
  if (!e) return box.replaceChildren();

  const h = Object.assign(document.createElement('h2'), { textContent: `${e.name}, ${e.brand}` });
  const meta = Object.assign(document.createElement('p'), {
    className: 'detail__meta',
    textContent: [e.city, `wants ${state.services[e.service] || e.service}`, `received ${when.format(new Date(e.created_at))}`].filter(Boolean).join(' · '),
  });
  const message = Object.assign(document.createElement('p'), { className: 'detail__message', textContent: e.message || 'No message.' });

  const reply = document.createElement('a');
  reply.className = 'button';
  reply.href = `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent(`Your first chapter with Content Book`)}&body=${encodeURIComponent(`Hi ${e.name},\n\n`)}`;
  reply.textContent = `Reply to ${e.email}`;

  const status = document.createElement('select');
  status.append(...state.statuses.map(s => Object.assign(document.createElement('option'), { value: s, textContent: s, selected: s === e.status })));
  status.addEventListener('change', async () => {
    await save(e.id, { status: status.value }, saved);
    await loadEnquiries();
  });
  const statusLabel = document.createElement('label');
  statusLabel.append('Status', status);

  const notes = Object.assign(document.createElement('textarea'), { rows: 4, value: e.notes, maxLength: 5000 });
  const notesLabel = document.createElement('label');
  notesLabel.append('Notes for the team', notes);

  const saved = Object.assign(document.createElement('span'), { className: 'detail__meta', role: 'status' });
  const saveNotes = Object.assign(document.createElement('button'), { type: 'button', className: 'linkish', textContent: 'Save notes' });
  saveNotes.addEventListener('click', () => save(e.id, { notes: notes.value }, saved));
  const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'linkish danger', textContent: 'Delete enquiry' });
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete the enquiry from ${e.name}? This cannot be undone.`)) return;
    await api(`/enquiries/${e.id}`, { method: 'DELETE' });
    state.selected = null;
    await loadEnquiries();
  });
  const actions = document.createElement('div');
  actions.className = 'detail__actions';
  actions.append(saveNotes, saved, remove);

  box.replaceChildren(h, meta, message, reply, statusLabel, notesLabel, actions);
}

async function save(id, changes, note) {
  try {
    const updated = await api(`/enquiries/${id}`, { method: 'PATCH', body: changes });
    Object.assign(state.enquiries.find(x => x.id === id), updated);
    note.textContent = 'Saved.';
  } catch (err) {
    note.textContent = err.message;
  }
}

// ---------- work ----------

async function loadWork() {
  state.work = await api('/work');
  $('#work-list').replaceChildren(...state.work.map(w => {
    const li = document.createElement('li');
    li.className = 'work-item';
    const img = Object.assign(document.createElement('img'), { src: w.image, alt: '', loading: 'lazy' });
    const text = document.createElement('div');
    text.append(
      Object.assign(document.createElement('p'), { className: 'work-item__title', textContent: w.title }),
      Object.assign(document.createElement('p'), {
        className: 'work-item__meta',
        textContent: [`position ${w.position}`, w.metric, w.published ? 'on the site' : 'hidden'].filter(Boolean).join(' · '),
      }),
    );
    const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'linkish', textContent: 'Edit' });
    edit.addEventListener('click', () => openWork(w));
    const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'linkish danger', textContent: 'Delete' });
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove "${w.title}" from the site? This cannot be undone.`)) return;
      await api(`/work/${w.id}`, { method: 'DELETE' });
      loadWork();
    });
    const actions = document.createElement('div');
    actions.className = 'work-item__actions';
    actions.append(edit, remove);
    li.append(img, text, actions);
    return li;
  }));
}

const dialog = $('#work-dialog');
const workForm = $('#work-form');

function openWork(w = null) {
  state.editing = w;
  workForm.reset();
  $('#work-dialog-title').textContent = w ? `Edit ${w.title}` : 'Add work';
  $('#work-msg').textContent = '';
  for (const name of ['title', 'summary', 'metric', 'link', 'image', 'video', 'alt', 'position']) {
    workForm.elements[name].value = w ? w[name] ?? '' : '';
  }
  workForm.elements.published.checked = w ? Boolean(w.published) : true;
  preview(w?.image);
  dialog.showModal();
}

function preview(src) {
  const img = $('#image-preview');
  img.hidden = !src;
  if (src) img.src = src;
}

$('#add-work').addEventListener('click', () => openWork());
$('#work-cancel').addEventListener('click', () => dialog.close());
workForm.elements.image.addEventListener('change', () => preview(workForm.elements.image.value.trim()));

$('#upload').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  $('#work-msg').textContent = 'Uploading…';
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const { path } = await api('/uploads', { method: 'POST', body: { dataUrl } });
    workForm.elements.image.value = path;
    preview(path);
    $('#work-msg').textContent = '';
  } catch (err) {
    $('#work-msg').textContent = err.message;
  }
});

workForm.addEventListener('submit', async event => {
  event.preventDefault();
  const f = workForm.elements;
  const body = {
    title: f.title.value, summary: f.summary.value, metric: f.metric.value, link: f.link.value,
    image: f.image.value, video: f.video.value, alt: f.alt.value, published: f.published.checked,
  };
  if (f.position.value !== '') body.position = Number(f.position.value);
  try {
    if (state.editing) await api(`/work/${state.editing.id}`, { method: 'PATCH', body });
    else await api('/work', { method: 'POST', body });
    dialog.close();
    loadWork();
  } catch (err) {
    const first = err.fields && Object.entries(err.fields)[0];
    $('#work-msg').textContent = first ? `${first[0]}: ${first[1]}` : err.message;
  }
});

// ---------- phone alerts ----------
// Each phone turns alerts on once. On iPhone this only works from the desk added to the home
// screen (iOS 16.4 and later); Android Chrome works straight from the browser.

const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const onIphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const fromHomeScreen = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let worker;

const say = text => {
  $('#alerts-msg').textContent = text;
  $('#alerts-msg').hidden = !text;
};
const phones = n => `${n} phone${n === 1 ? '' : 's'}`;
const keyBytes = base64 => {
  const raw = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

async function mySubscription() {
  worker ??= await navigator.serviceWorker.register('/sw.js', { scope: '/admin' });
  await navigator.serviceWorker.ready;
  return worker.pushManager.getSubscription();
}

async function renderAlerts() {
  const button = $('#alerts');
  if (!canPush) {
    button.dataset.mode = 'help';
    button.textContent = 'Phone alerts';
    return;
  }
  const sub = await mySubscription().catch(() => null);
  const on = Boolean(sub) && Notification.permission === 'granted';
  button.dataset.mode = on ? 'on' : 'off';
  button.textContent = on ? 'Alerts on: send a test' : 'Turn on phone alerts';
  $('#alerts-off').hidden = !on;
  // Keep the server's list in step with this phone, in case it was cleared.
  if (on) api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }).catch(() => {});
}

$('#alerts').addEventListener('click', async () => {
  const mode = $('#alerts').dataset.mode;
  try {
    if (mode === 'help') {
      return say(onIphone && !fromHomeScreen
        ? 'On iPhone: tap Share, then "Add to Home Screen". Open the CBT desk from that new icon, sign in, and tap "Turn on phone alerts" there.'
        : 'This browser cannot show phone alerts. Use Chrome on Android, or the desk added to your iPhone home screen.');
    }
    if (mode === 'on') {
      // Phones only show the banner when the desk is not on screen, so the test waits a few seconds.
      say('Sending a test in 8 seconds. Lock your phone or go to your home screen now to see it pop up.');
      const { sent } = await api('/push/test', { method: 'POST', body: { delay: 8 } });
      return say(sent
        ? `Test alert sent to ${phones(sent)}. No banner? Swipe down for Notification Center, and check Settings → Notifications → CBT desk has Banners on and no Focus mode is blocking it.`
        : 'No phones are signed up for alerts yet.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return say('Notifications are blocked for the desk. Allow them in your phone settings, then try again.');
    const { publicKey } = await api('/push');
    let sub = await mySubscription();
    // A subscription made with an older key cannot be reused.
    if (sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const res = await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    say(`Alerts are on for this phone (${phones(res.phones)} in total). Every new enquiry will pop up here, and tapping it opens the enquiry.`);
  } catch (err) {
    say(err.message || 'Phone alerts could not be turned on.');
  }
  renderAlerts();
});

$('#alerts-off').addEventListener('click', async () => {
  const sub = await mySubscription().catch(() => null);
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  say('Alerts are off for this phone.');
  renderAlerts();
});

// The desk is already open when an alert is tapped: jump to that enquiry.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'open') return;
    const hash = new URL(event.data.url).hash;
    if (location.hash === hash) dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  });
}

// ---------- start ----------

api('/me').then(me => {
  $('#mail-note').textContent = me.mail ? 'New enquiries are emailed to the studio.' : 'Email alerts are off (no SMTP set).';
  // On hosts without a disk, images are linked rather than uploaded.
  $('#upload').closest('label').hidden = !me.uploads;
  if (!me.configured) return showSignin('The desk is locked: set ADMIN_PASSWORD in the server settings.');
  return me.signedIn ? showDesk() : showSignin();
}).catch(() => showSignin('The desk could not reach the server.'));
