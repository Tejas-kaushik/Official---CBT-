// Content Book by Tee: the page's behaviour. Everything here is an enhancement:
// without it the posters show, the sections are visible and the form still posts.

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
root.classList.add('js');

// ---------- the cover: staggered arrival, then the clips play ----------

const hero = document.querySelector('.hero');
const stagger = [...document.querySelectorAll('.hero__clip, .nav, .hero__row > *, .hero__name > svg')];
stagger.forEach((el, i) => el.style.setProperty('--delay', `${i * 80}ms`));
requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('is-ready')));

function loadVideo(video) {
  if (video.dataset.src && !video.src) {
    video.src = video.dataset.src;
    video.preload = 'auto';
  }
}

// Clips play only while on screen, and never for people who asked for less motion.
if (!reduceMotion && 'IntersectionObserver' in window) {
  const clips = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        loadVideo(target);
        target.play().catch(() => {});
      } else {
        target.pause();
      }
    }
  }, { threshold: 0.35 });
  document.querySelectorAll('video[data-src]').forEach(v => clips.observe(v));
}

// ---------- entrances, section by section ----------

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
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('[data-reveal], [data-reveal-group]').forEach(el => reveal.observe(el));
} else {
  document.querySelectorAll('[data-reveal], [data-reveal-group]').forEach(el => el.classList.add('is-in'));
}

// ---------- the form: write the first chapter ----------

const form = document.querySelector('form.chapter');
const title = document.getElementById('write-title');
const select = form.elements.service;
const fields = ['name', 'brand', 'city', 'service', 'email', 'message'];
const original = title.textContent;

// The section's title becomes the visitor's chapter as they type.
function retitle() {
  const brand = form.elements.brand.value.trim();
  const city = form.elements.city.value.trim();
  title.textContent = brand ? `Chapter one: ${brand}${city ? `, ${city}` : ''}` : original;
}
form.elements.brand.addEventListener('input', retitle);
form.elements.city.addEventListener('input', retitle);

// A service row in the menu fills in "Help with" and brings the visitor to the form.
document.querySelectorAll('.menu__row[data-service]').forEach(row => {
  row.addEventListener('click', event => {
    event.preventDefault();
    select.value = row.dataset.service;
    document.getElementById('write').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    const empty = fields.map(f => form.elements[f]).find(el => el.required && !el.value);
    (empty || select).focus({ preventScroll: true });
    history.replaceState(null, '', '#write');
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
  let line = document.querySelector('.write__status');
  if (!line) {
    line = document.createElement('p');
    line.className = 'write__status';
    line.setAttribute('role', 'alert');
    form.after(line);
  }
  line.textContent = message;
}

function line(...parts) {
  const div = document.createElement('div');
  div.className = 'line';
  // One span, so the row's flex gap does not split the sentence around the bold words.
  const span = document.createElement('span');
  span.append(...parts);
  div.append(span);
  return div;
}
const strong = text => Object.assign(document.createElement('strong'), { textContent: text });

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('.send');
  const data = Object.fromEntries(new FormData(form));

  // Same checks the server makes, so the visitor hears about them without a round trip.
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

    // The answers come back as the opening page of their chapter.
    document.querySelector('.write__status')?.remove();
    title.textContent = `Chapter one: ${body.brand}${body.city ? `, ${body.city}` : ''}`;
    const done = document.createElement('div');
    done.className = 'chapter chapter--done';
    done.setAttribute('role', 'status');
    done.append(
      line('Thank you, ', strong(body.name), '.'),
      line('It starts with ', strong(body.service), ','),
      line('and a call about your budget.'),
      line('We will write to ', strong(body.email), '.'),
    );
    form.replaceWith(done);
  } catch {
    statusLine('That did not send. Check your connection, or email contentbook7@gmail.com.');
  } finally {
    button.disabled = false;
  }
});
