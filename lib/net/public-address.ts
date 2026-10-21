import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Addresses a server the app connects to on someone's say-so (an
// organization's mail server, a webhook URL) must never be: this machine,
// the private network it sits on, or cloud metadata. Without the check, an
// owner could point the app at internal services.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, "ipv6");
}

// Resolves a host name and returns an address to connect to, or throws if
// any address it resolves to isn't public. Connect to the returned address
// (not the name again), so a second lookup can't answer differently.
// ALLOW_PRIVATE_NETWORK_HOSTS=true lifts the check, for a self-hosted
// instance whose own users are trusted with its network (a mail server on
// the LAN).
export async function resolvePublicAddress(host: string): Promise<string> {
  const results = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (results.length === 0) throw new Error(`${host} doesn't resolve`);
  if (process.env.ALLOW_PRIVATE_NETWORK_HOSTS === "true") return results[0].address;
  if (!results.every((r) => isPublicAddress(r.address))) {
    throw new Error(`${host} is a private or local address`);
  }
  return results[0].address;
}

type LookupCallback = (
  err: Error | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

// A drop-in for dns.lookup in http(s).request: connects only to a vetted
// address while the request keeps its host name (for TLS and Host).
export function publicLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  resolvePublicAddress(hostname).then(
    (address) => {
      const family = isIP(address);
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    },
    (err: Error) => callback(err, ""),
  );
}
