import { SEED_WORK, WORK_DEFAULTS } from '../content.js';

// The store for hosts without a disk (Vercel). It talks to Upstash Redis over its REST API,
// so it needs no driver. Each enquiry is one JSON value, indexed newest-first in a sorted set;
// the work list is small, so it is kept as one JSON array.
export function createRedisStore({ url, token, fetch: send = fetch, prefix = 'cbt' }) {
  const base = url.replace(/\/+$/, '');
  const call = async (...command) => {
    const res = await send(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Redis ${command[0]} failed: ${data.error || res.status}`);
    return data.result;
  };
  const key = s => `${prefix}:${s}`;
  const now = () => new Date().toISOString();
  const byPosition = (a, b) => a.position - b.position || a.id - b.id;

  async function readWork() {
    const stored = await call('GET', key('work'));
    if (stored) return JSON.parse(stored).sort(byPosition);
    const seeded = SEED_WORK.map((w, i) => ({ id: i + 1, ...WORK_DEFAULTS, ...w, position: i + 1, created_at: now() }));
    // NX: if two cold starts race, only the first seed is kept.
    await call('SET', key('work'), JSON.stringify(seeded), 'NX');
    await call('SET', key('work:seq'), String(seeded.length), 'NX');
    return JSON.parse(await call('GET', key('work'))).sort(byPosition);
  }
  const saveWork = list => call('SET', key('work'), JSON.stringify(list));

  async function allEnquiries() {
    const ids = await call('ZRANGE', key('enquiries'), 0, -1, 'REV');
    if (!ids?.length) return [];
    const rows = await call('MGET', ...ids.map(id => key(`enquiry:${id}`)));
    return rows.filter(Boolean).map(r => JSON.parse(r));
  }
  async function getEnquiry(id) {
    const row = await call('GET', key(`enquiry:${id}`));
    return row ? JSON.parse(row) : null;
  }

  return {
    kind: 'redis',
    canUpload: false,
    enquiries: {
      async add(e) {
        const id = Number(await call('INCR', key('enquiry:seq')));
        const row = { id, ...e, status: 'new', notes: '', created_at: now(), updated_at: now() };
        await call('SET', key(`enquiry:${id}`), JSON.stringify(row));
        await call('ZADD', key('enquiries'), Date.now(), String(id));
        return row;
      },
      async list(status) {
        const rows = await allEnquiries();
        return status ? rows.filter(r => r.status === status) : rows;
      },
      async counts() {
        const counts = {};
        for (const r of await allEnquiries()) counts[r.status] = (counts[r.status] || 0) + 1;
        return counts;
      },
      async update(id, changes) {
        const row = await getEnquiry(id);
        if (!row) return null;
        const updated = { ...row, ...changes, updated_at: now() };
        await call('SET', key(`enquiry:${id}`), JSON.stringify(updated));
        return updated;
      },
      async remove(id) {
        const removed = await call('DEL', key(`enquiry:${id}`));
        await call('ZREM', key('enquiries'), String(id));
        return removed > 0;
      },
    },
    work: {
      async published() {
        return (await readWork()).filter(w => w.published).map(({ id, title, summary, metric, link, image, video, alt }) => ({ id, title, summary, metric, link, image, video, alt }));
      },
      all: readWork,
      async add(w) {
        const list = await readWork();
        const id = Number(await call('INCR', key('work:seq')));
        const row = { id, ...WORK_DEFAULTS, ...w, created_at: now() };
        row.position ??= Math.max(0, ...list.map(x => x.position)) + 1;
        await saveWork([...list, row]);
        return row;
      },
      async update(id, changes) {
        const list = await readWork();
        const i = list.findIndex(w => w.id === id);
        if (i < 0) return null;
        list[i] = { ...list[i], ...changes };
        await saveWork(list);
        return list[i];
      },
      async remove(id) {
        const list = await readWork();
        const rest = list.filter(w => w.id !== id);
        if (rest.length === list.length) return false;
        await saveWork(rest);
        return true;
      },
    },
    close() {},
  };
}
