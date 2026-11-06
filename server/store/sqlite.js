import { DatabaseSync } from 'node:sqlite';
import { SEED_WORK, WORK_DEFAULTS } from '../content.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS enquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  brand      TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT '',
  service    TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS enquiries_status ON enquiries (status, created_at);

CREATE TABLE IF NOT EXISTS work (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  metric     TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  video      TEXT NOT NULL DEFAULT '',
  alt        TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  published  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  name  TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

const WORK_FIELDS = ['title', 'summary', 'metric', 'link', 'image', 'video', 'alt', 'position', 'published'];

// The store for a server with its own disk (local runs, Render, Railway). Column names are fixed
// by the code above, so building SET clauses from them is safe.
export function createSqliteStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const insertWork = db.prepare(`INSERT INTO work (${WORK_FIELDS.join(', ')}) VALUES (${WORK_FIELDS.map(() => '?').join(', ')})`);
  const addWork = w => {
    const row = { ...WORK_DEFAULTS, ...w };
    row.position ??= db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM work').get().p;
    return Number(insertWork.run(...WORK_FIELDS.map(f => row[f])).lastInsertRowid);
  };
  if (db.prepare('SELECT COUNT(*) AS n FROM work').get().n === 0) SEED_WORK.forEach((w, i) => addWork({ ...w, position: i + 1 }));

  const q = {
    published: db.prepare('SELECT id, title, summary, metric, link, image, video, alt FROM work WHERE published = 1 ORDER BY position, id'),
    allWork: db.prepare('SELECT * FROM work ORDER BY position, id'),
    getWork: db.prepare('SELECT * FROM work WHERE id = ?'),
    deleteWork: db.prepare('DELETE FROM work WHERE id = ?'),
    addEnquiry: db.prepare('INSERT INTO enquiries (name, brand, city, service, email, message) VALUES (?, ?, ?, ?, ?, ?)'),
    getEnquiry: db.prepare('SELECT * FROM enquiries WHERE id = ?'),
    allEnquiries: db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC, id DESC'),
    byStatus: db.prepare('SELECT * FROM enquiries WHERE status = ? ORDER BY created_at DESC, id DESC'),
    deleteEnquiry: db.prepare('DELETE FROM enquiries WHERE id = ?'),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status'),
    getSetting: db.prepare('SELECT value FROM settings WHERE name = ?'),
    initSetting: db.prepare('INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)'),
    allSubs: db.prepare('SELECT subscription, created_at FROM push_subscriptions ORDER BY created_at'),
    putSub: db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription) VALUES (?, ?)'),
    deleteSub: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    hitLimit: db.prepare(`INSERT INTO rate_limits (name, count, reset) VALUES (?1, 1, ?2 + ?3)
      ON CONFLICT (name) DO UPDATE SET count = CASE WHEN reset <= ?2 THEN 1 ELSE count + 1 END,
                                       reset = CASE WHEN reset <= ?2 THEN ?2 + ?3 ELSE reset END
      RETURNING count`),
    pruneLimits: db.prepare('DELETE FROM rate_limits WHERE reset <= ?'),
  };

  return {
    kind: 'sqlite',
    canUpload: true,
    enquiries: {
      async add(e) {
        const id = Number(q.addEnquiry.run(e.name, e.brand, e.city, e.service, e.email, e.message).lastInsertRowid);
        return q.getEnquiry.get(id);
      },
      async list(status) {
        return status ? q.byStatus.all(status) : q.allEnquiries.all();
      },
      async counts() {
        return Object.fromEntries(q.counts.all().map(r => [r.status, r.n]));
      },
      async update(id, changes) {
        if (!q.getEnquiry.get(id)) return null;
        const keys = Object.keys(changes);
        db.prepare(`UPDATE enquiries SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
          .run(...keys.map(k => changes[k]), id);
        return q.getEnquiry.get(id);
      },
      async remove(id) {
        return q.deleteEnquiry.run(id).changes > 0;
      },
    },
    work: {
      async published() {
        return q.published.all();
      },
      async all() {
        return q.allWork.all();
      },
      async add(w) {
        return q.getWork.get(addWork(w));
      },
      async update(id, changes) {
        if (!q.getWork.get(id)) return null;
        const keys = Object.keys(changes);
        db.prepare(`UPDATE work SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => changes[k]), id);
        return q.getWork.get(id);
      },
      async remove(id) {
        return q.deleteWork.run(id).changes > 0;
      },
    },
    settings: {
      async get(name) {
        const row = q.getSetting.get(name);
        return row ? JSON.parse(row.value) : null;
      },
      // Keeps the first value ever written.
      async init(name, value) {
        q.initSetting.run(name, JSON.stringify(value));
        return JSON.parse(q.getSetting.get(name).value);
      },
    },
    limits: {
      async hit(name, windowMs) {
        const now = Date.now();
        if (Math.random() < 0.01) q.pruneLimits.run(now);
        return q.hitLimit.get(name, now, windowMs).count;
      },
    },
    push: {
      async list() {
        return q.allSubs.all().map(r => ({ ...JSON.parse(r.subscription), created_at: r.created_at }));
      },
      async add(sub) {
        q.putSub.run(sub.endpoint, JSON.stringify(sub));
      },
      async remove(endpoint) {
        return q.deleteSub.run(endpoint).changes > 0;
      },
    },
    close() {
      db.close();
    },
  };
}
