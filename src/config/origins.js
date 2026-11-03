/*
 * Origins that are fine to accept while developing (never used when deployed):
 * localhost, phones on the same Wi-Fi (192.168.x.x, 10.x.x.x, 172.16-31.x.x) and
 * common tunnel hosts (ngrok, Cloudflare quick tunnels, localtunnel).
 */
const TUNNEL = /\.(ngrok-free\.(app|dev)|ngrok\.(io|app|dev)|trycloudflare\.com|loca\.lt)$/i;

function isDevOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname;
    return host === 'localhost'
      || host === '127.0.0.1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || host.endsWith('.local')
      || TUNNEL.test(host);
  } catch {
    return false;
  }
}

module.exports = { isDevOrigin };
