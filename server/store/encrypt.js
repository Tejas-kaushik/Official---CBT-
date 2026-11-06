import crypto from 'node:crypto';

// Field-level encryption for enquiries. With DATA_ENCRYPTION_KEY set, a visitor's name, brand, city,
// email, message and the team's notes are stored as AES-256-GCM ciphertext, so the database alone
// gives nothing away. Status, service and dates stay readable for filtering and counting.
// Values written before the key was set are plain text and still read fine.
const FIELDS = ['name', 'brand', 'city', 'email', 'message', 'notes'];
const PREFIX = 'enc1:';

export function parseKey(raw) {
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes: 64 hex characters, or base64.');
  return key;
}

export function encryptStore(store, key) {
  if (!key) return store;

  const seal = value => {
    if (value === undefined || value === null || value === '') return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };
  const open = value => {
    if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  };
  const sealRow = row => {
    const out = { ...row };
    for (const f of FIELDS) if (Object.hasOwn(out, f)) out[f] = seal(out[f]);
    return out;
  };
  const openRow = row => {
    if (!row) return row;
    const out = { ...row };
    for (const f of FIELDS) {
      if (!Object.hasOwn(out, f)) continue;
      try {
        out[f] = open(out[f]);
      } catch {
        out[f] = '[cannot be read: the encryption key has changed]';
      }
    }
    return out;
  };

  const e = store.enquiries;
  return {
    ...store,
    encrypted: true,
    enquiries: {
      ...e,
      add: async row => openRow(await e.add(sealRow(row))),
      list: async status => (await e.list(status)).map(openRow),
      update: async (id, changes) => openRow(await e.update(id, sealRow(changes))),
    },
  };
}
