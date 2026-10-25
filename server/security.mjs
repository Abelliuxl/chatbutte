import dns from 'node:dns';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export function publicIP(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}
export function validateTarget(value) {
  const u = new URL(value);
  const allowed = (process.env.CHATBUTTE_ALLOWED_HOSTS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443'))
    throw new Error('Upstream must be HTTPS on port 443, without credentials or fragments.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (allowed.length && !allowed.includes(host))
    throw new Error('This upstream host is not permitted by the server.');
  if (ipaddr.isValid(host) && !publicIP(host))
    throw new Error('Private upstream addresses are not allowed.');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    throw new Error('Private upstream hosts are not allowed.');
  return u;
}
export function checkedLookup(hostname, options, callback, resolver = dns.lookup) {
  resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => !publicIP(a.address)))
      return callback(new Error('Upstream DNS resolved to a private or reserved address.'));
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}
export const dispatcher = new Agent({
  connect: { timeout: 15_000, lookup: checkedLookup },
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});
export function trustedHost(req) {
  const host = req.headers.host || '';
  try {
    const parsed = new URL(`http://${host}`);
    if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return true;
    return (process.env.CHATBUTTE_ORIGINS || '')
      .split(',')
      .filter(Boolean)
      .some((origin) => new URL(origin.trim()).host === host);
  } catch {
    return false;
  }
}
export function sameOrigin(req) {
  if (!trustedHost(req) || req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    if (origin.host !== req.headers.host) return false;
    if (['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return true;
    return (process.env.CHATBUTTE_ORIGINS || '')
      .split(',')
      .map((x) => x.trim())
      .includes(origin.origin);
  } catch {
    return false;
  }
}
export function clientAddress(req) {
  const peer = req.socket.remoteAddress;
  if (
    process.env.CHATBUTTE_TRUST_PROXY === 'loopback' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
  ) {
    const value = req.headers['x-real-ip'];
    if (typeof value === 'string' && ipaddr.isValid(value)) return value;
  }
  return peer;
}
export function redact(message, secrets = []) {
  let text = String(message || 'Upstream request failed');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 2000);
}
