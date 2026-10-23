import * as os from 'node:os';

// All IPv4 addresses of this machine on the local network, as panel URLs.
// Typical home-network addresses (192.168.x.x) come first; link-local ones are skipped.
export function getLanUrls(port: number): string[] {
  const addresses: string[] = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        addresses.push(entry.address);
      }
    }
  }

  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return addresses
    .sort((a, b) => rank(a) - rank(b))
    .map(ip => `http://${ip}:${port}`);
}

// True for loopback, private (RFC 1918), link-local and unique-local addresses.
export function isPrivateAddress(ip: string): boolean {
  let address = ip.toLowerCase();

  if (address.startsWith('::ffff:')) {
    address = address.slice(7);
  }

  if (address === '::1' || address === 'localhost') {
    return true;
  }

  if (address.includes(':')) {
    return address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) {
    return false;
  }

  const [a, b] = parts;
  return a === 127
    || a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}
