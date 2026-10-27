// A stand-in for the Upstash REST API, covering the commands the Redis store uses,
// so the store can be tested without a network or an account.
export function fakeUpstash() {
  const strings = new Map();
  const zsets = new Map();
  const run = ([cmd, ...a]) => {
    switch (cmd) {
      case 'GET': return strings.get(a[0]) ?? null;
      case 'SET':
        if (a[2] === 'NX' && strings.has(a[0])) return null;
        strings.set(a[0], String(a[1]));
        return 'OK';
      case 'MGET': return a.map(k => strings.get(k) ?? null);
      case 'INCR': {
        const n = Number(strings.get(a[0]) ?? 0) + 1;
        strings.set(a[0], String(n));
        return n;
      }
      case 'DEL': return a.filter(k => strings.delete(k)).length;
      case 'ZADD': {
        const z = zsets.get(a[0]) ?? new Map();
        zsets.set(a[0], z.set(String(a[2]), Number(a[1])));
        return 1;
      }
      case 'ZREM': return zsets.get(a[0])?.delete(String(a[1])) ? 1 : 0;
      case 'ZRANGE': {
        const members = [...(zsets.get(a[0]) ?? new Map())].sort((x, y) => x[1] - y[1] || Number(x[0]) - Number(y[0])).map(([m]) => m);
        if (a.includes('REV')) members.reverse();
        return members;
      }
      default: throw new Error(`fake Upstash: ${cmd} not supported`);
    }
  };
  return async (url, { headers, body }) => {
    if (headers.Authorization !== 'Bearer test-token') return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    try {
      return new Response(JSON.stringify({ result: run(JSON.parse(body)) }));
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400 });
    }
  };
}
