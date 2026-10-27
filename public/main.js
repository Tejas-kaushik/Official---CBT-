// Content Book by Tee: the page's behaviour. Everything here is an enhancement:
// without it the stills show, every section is visible and the form still posts.

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wide = matchMedia('(min-width: 861px)');
root.classList.add('js');
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));

// ---------- the reel panel ----------

const scenes = new Map([...document.querySelectorAll('.scene')].map(s => [s.dataset.scene, s]));
const workScene = scenes.get('work');
let current = 'matcha';

function play(video) {
  if (reduceMotion || !video) return;
  if (!video.src && video.dataset.src) video.src = video.dataset.src;
  if (video.src) video.play().catch(() => {});
}

function show(name) {
  if (!scenes.has(name)) return;
  if (name === current) return play(scenes.get(name).querySelector('video'));
  scenes.get(current)?.classList.remove('is-active');
  scenes.get(current)?.querySelector('video')?.pause();
  current = name;
  scenes.get(name).classList.add('is-active');
  play(scenes.get(name).querySelector('video'));
}

// The work scene shows whichever project in the ledger is active.
function showJob(job) {
  document.querySelectorAll('.job.is-active').forEach(j => j.classList.remove('is-active'));
  job.classList.add('is-active');
  const still = workScene.querySelector('.scene__still');
  const video = workScene.querySelector('video');
  still.src = job.dataset.image;
  workScene.querySelector('figcaption').textContent = job.dataset.caption;
  video.pause();
  video.removeAttribute('src');
  video.hidden = !job.dataset.video;
  if (job.dataset.video) {
    video.dataset.src = job.dataset.video;
    video.poster = job.dataset.image;
    if (current === 'work') play(video);
  }
  still.onload = () => workScene.classList.toggle('is-landscape', still.naturalWidth > still.naturalHeight);
}

const jobs = [...document.querySelectorAll('.job')];
if (jobs.length) showJob(jobs[0]);
jobs.forEach(job => {
  const activate = () => { if (wide.matches) { showJob(job); show('work'); } };
  job.addEventListener('mouseenter', activate);
  job.addEventListener('focus', activate);
});

// Whichever section crosses the middle of the screen picks the scene.
if ('IntersectionObserver' in window) {
  const sections = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) if (isIntersecting && wide.matches) show(target.dataset.scene);
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('.stage__read > section[data-scene]').forEach(s => sections.observe(s));

  // Only play while the panel is on screen (it scrolls away on phones).
  const panel = new IntersectionObserver(([entry]) => {
    const video = scenes.get(current).querySelector('video');
    if (entry.isIntersecting) play(video); else video?.pause();
  });
  panel.observe(document.querySelector('.stage__media'));
} else {
  play(scenes.get('matcha').querySelector('video'));
}

// ---------- entrances ----------

if (!reduceMotion && 'IntersectionObserver' in window) {
  document.querySelectorAll('[data-reveal-group]').forEach(group => {
    [...group.children].forEach((child, i) => child.style.setProperty('--delay', `${Math.min(i, 8) * 70}ms`));
  });
  const reveal = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      target.classList.add('is-in');
      reveal.unobserve(target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('[data-reveal], [data-reveal-group]').forEach(el => reveal.observe(el));
} else {
  document.querySelectorAll('[data-reveal], [data-reveal-group]').forEach(el => el.classList.add('is-in'));
}

// ---------- the enquiry form ----------

const form = document.querySelector('form.enquiry');
const fields = ['name', 'brand', 'city', 'service', 'email', 'message'];

// "Ask about …" links fill in the service and bring the visitor to the form.
document.querySelectorAll('[data-service]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    form.elements.service.value = link.dataset.service;
    document.getElementById('contact').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    form.elements.name.focus({ preventScroll: true });
    history.replaceState(null, '', '#contact');
  });
});

function showErrors(errors = {}) {
  let first;
  for (const f of fields) {
    const input = form.elements[f];
    const note = document.getElementById(`e-${f}`);
    if (errors[f]) {
      input.setAttribute('aria-invalid', 'true');
      note.textContent = errors[f];
      first ??= input;
    } else {
      input.removeAttribute('aria-invalid');
      note.textContent = '';
    }
  }
  first?.focus();
}

function statusLine(message) {
  let line = form.querySelector('.enquiry__status');
  if (!line) {
    line = document.createElement('p');
    line.className = 'enquiry__status';
    line.setAttribute('role', 'alert');
    form.append(line);
  }
  line.textContent = message;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));

  // The same checks the server makes, so the visitor hears about them without a round trip.
  const errors = {};
  if (!data.name.trim()) errors.name = 'Tell us your name.';
  if (!data.brand.trim()) errors.brand = 'Tell us the brand or business.';
  if (!data.service) errors.service = 'Choose what you would like help with.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) errors.email = 'Check your email address.';
  showErrors(errors);
  if (Object.keys(errors).length) return;

  button.disabled = true;
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 400) return showErrors(body.fields);
    if (!res.ok) return statusLine(body.error || 'That did not send. Email contentbook7@gmail.com instead.');

    const done = document.createElement('div');
    done.className = 'enquiry--done';
    done.setAttribute('role', 'status');
    done.append(
      Object.assign(document.createElement('h3'), { textContent: `Thank you, ${body.name}.` }),
      Object.assign(document.createElement('p'), {
        textContent: `We have your enquiry about ${body.service} for ${body.brand}. We will reply to ${body.email} to set up a call.`,
      }),
    );
    form.replaceWith(done);
  } catch {
    statusLine('That did not send. Check your connection, or email contentbook7@gmail.com.');
  } finally {
    button.disabled = false;
  }
});
