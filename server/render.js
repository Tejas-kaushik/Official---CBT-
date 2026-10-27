import fs from 'node:fs';
import path from 'node:path';
import { SERVICES } from './content.js';

export const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Only our own paths or https links reach an href or src.
const safeUrl = u => (/^(\/(?!\/)|https:\/\/)/.test(u) ? u : '');

function piece(w) {
  const image = safeUrl(w.image);
  const video = safeUrl(w.video);
  const link = safeUrl(w.link);
  const media = video
    ? `<video class="piece__media" muted loop playsinline preload="none" poster="${escapeHtml(image)}" data-src="${escapeHtml(video)}" aria-label="${escapeHtml(w.alt)}"></video>`
    : `<img class="piece__media" src="${escapeHtml(image)}" alt="${escapeHtml(w.alt)}" loading="lazy">`;
  const framed = link
    ? `<a class="piece__frame" href="${escapeHtml(link)}" target="_blank" rel="noopener">${media}<span class="visually-hidden"> (watch ${escapeHtml(w.title)} on Instagram)</span></a>`
    : `<div class="piece__frame">${media}</div>`;
  return `<article class="piece" data-reveal>
        <h3 class="piece__name">${escapeHtml(w.title)}</h3>
        ${framed}
        <p class="piece__text">${escapeHtml(w.summary)}${w.metric ? ` <span class="piece__metric">${escapeHtml(w.metric)}</span>` : ''}</p>
      </article>`;
}

const REMARK = `<p class="scatter__remark" data-reveal>A moment lasts one night. A chapter keeps working long after it.</p>`;

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
    const pieces = work.map(piece);
    if (pieces.length > 1) pieces.splice(2, 0, REMARK);

    const chosen = SERVICES[query.service] ? query.service : '';
    const options = [`<option value="" disabled${chosen ? '' : ' selected'}>choose one</option>`]
      .concat(Object.entries(SERVICES).map(([k, label]) => `<option value="${k}"${k === chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`))
      .join('');

    let status = '';
    if (query.sent === '1') status = '<p class="write__status write__status--ok" role="status">Thank you. Your first chapter is with us, and we will write back from contentbook7@gmail.com.</p>';
    else if (query.error) status = `<p class="write__status" role="alert">${escapeHtml(String(query.error).slice(0, 200))}</p>`;

    return template()
      .replace('<!--work-->', pieces.join('\n      '))
      .replace('<!--service-options-->', options)
      .replace('<!--form-status-->', status)
      .replaceAll('{{year}}', String(new Date().getFullYear()));
  };
}
