const zlib = require('node:zlib');

/*
 * Compresses large JSON API responses with gzip (built into Node, no extra
 * package). Feed and comment payloads shrink by roughly 70-85%, which matters
 * on slow mobile connections. Small responses are left alone.
 */
const MIN_BYTES = 1024;

function jsonGzip(req, res, next) {
  const accepts = String(req.headers['accept-encoding'] || '');
  if (!/\bgzip\b/i.test(accepts)) return next();

  const send = res.json.bind(res);
  res.json = (body) => {
    let payload;
    try { payload = Buffer.from(JSON.stringify(body), 'utf8'); } catch { return send(body); }
    res.vary('Accept-Encoding');
    if (payload.length < MIN_BYTES || res.headersSent) return send(body);
    zlib.gzip(payload, { level: 5 }, (error, compressed) => {
      if (error || res.headersSent) { if (!res.headersSent) { res.type('application/json'); res.send(payload); } return; }
      res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' });
      res.send(compressed);
    });
    return res;
  };
  return next();
}

module.exports = jsonGzip;
