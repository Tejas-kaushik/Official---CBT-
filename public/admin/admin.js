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
}

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

// ---------- start ----------

api('/me').then(me => {
  $('#mail-note').textContent = me.mail ? 'New enquiries are emailed to the studio.' : 'Email alerts are off (no SMTP set).';
  if (!me.configured) return showSignin('The desk is locked: set ADMIN_PASSWORD in the server settings.');
  return me.signedIn ? showDesk() : showSignin();
}).catch(() => showSignin('The desk could not reach the server.'));
