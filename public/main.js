// Content Book by Tee: the page's behaviour. Everything here is an enhancement:
// without it every section is visible and the form still posts.

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
root.classList.add('js');
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));

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
