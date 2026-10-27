import fs from 'node:fs';
import path from 'node:path';
import { SERVICES } from './content.js';

export const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Only our own paths or https links reach an href or src.
const safeUrl = u => (/^(\/(?!\/)|https:\/\/)/.test(u) ? u : '');

// One row of the work ledger: name, result, a line about it and a link to the reel.
function job(w) {
  const link = safeUrl(w.link);
  const title = escapeHtml(w.title);
  return `<li class="job">
            <h3 class="job__name">${title}</h3>
            <p class="job__metric">${escapeHtml(w.metric)}</p>
            <p class="job__text">${escapeHtml(w.summary)}${link ? ` <a class="textlink" href="${escapeHtml(link)}" target="_blank" rel="noopener">Watch<span class="visually-hidden"> ${title}</span> on Instagram</a>` : ''}</p>
          </li>`;
}

const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1);

// The traced wordmark, inlined once as symbols so the hero and footer can <use> it and colour it with CSS.
function sprite(brandDir) {
  const symbol = (id, file) => {
    const svg = fs.readFileSync(path.join(brandDir, file), 'utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`;
  };
  return `<svg class="sprite" aria-hidden="true" focusable="false">${symbol('wm-content', 'word-content.svg')}${symbol('wm-book', 'word-book.svg')}${symbol('wm-bytee', 'bytee.svg')}</svg>`;
}

export function createRenderer({ root, publicDir, isProd }) {
  const file = path.join(root, 'server', 'views', 'home.html');
  let cached;
  const template = () => {
    if (isProd && cached) return cached;
    return (cached = fs.readFileSync(file, 'utf8').replace('<!--sprite-->', sprite(path.join(publicDir, 'assets', 'brand'))));
  };

  return function renderHome({ work, query = {} }) {
    const chosen = Object.hasOwn(SERVICES, query.service) ? query.service : '';
    const options = [`<option value="" disabled${chosen ? '' : ' selected'}>Choose a service</option>`]
      .concat(Object.entries(SERVICES).map(([k, label]) => `<option value="${k}"${k === chosen ? ' selected' : ''}>${escapeHtml(capitalise(label))}</option>`))
      .join('');

    let status = '';
    if (query.sent === '1') status = '<p class="enquiry__status enquiry__status--ok" role="status">Thank you. Your enquiry is with us, and we will reply from contentbook7@gmail.com.</p>';
    else if (query.error) status = `<p class="enquiry__status" role="alert">${escapeHtml(String(query.error).slice(0, 200))}</p>`;

    return template()
      .replace('<!--work-->', work.map(job).join('\n          '))
      .replace('<!--service-options-->', options)
      .replace('<!--form-status-->', status)
      .replaceAll('{{year}}', String(new Date().getFullYear()));
  };
}
