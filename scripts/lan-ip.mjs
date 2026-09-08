#!/usr/bin/env node
// ─── LAN IP autodetection ─────────────────────────────────────────────────────
//
// Detects this host's primary LAN IPv4 address (e.g. 192.168.1.46) and prints
// it, so scripts, compose files, and CI never need a hardcoded IP again.
//
//   node scripts/lan-ip.mjs            -> 192.168.1.46
//   node scripts/lan-ip.mjs --url      -> http://192.168.1.46
//   node scripts/lan-ip.mjs --url 3000 -> http://192.168.1.46:3000
//
// Resolution order:
//   1. PLUTUS_HOST env var (explicit override — wins over everything)
//   2. Primary LAN IPv4 from os.networkInterfaces() (private ranges,
//     first non-internal IPv4; deterministic interface order)
//   3. "127.0.0.1" fallback when no LAN interface exists (CI / containers)
//
// Exit codes: 0 on success, 1 when detection fails entirely (never expected
// — the loopback fallback always resolves).

import os from "node:os";

function privateIpv4(addrs) {
  const hits = [];
  for (const addr of addrs) {
    if (addr.internal) continue;
    // Node historically used "IPv4"; newer runtimes lowercase it.
    if (String(addr.family).toLowerCase() !== "ipv4") continue;
    const parts = addr.address.split(".").map(Number);
    const [a, b] = parts;
    const isPrivate =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (isPrivate) hits.push(addr.address);
  }
  return hits;
}

// Interfaces that carry container/VPN bridges, not the LAN. Docker's default
// bridge pool (172.17-31.0.1) would otherwise win on compose-heavy hosts.
const VIRTUAL_IFACE_RE =
  /^(docker|br-|veth|virbr|podman|cni|flannel|calico|weave|zt|tailscale|wg|tun|tap|lo)/;

// Preference order: classic home/office LAN ranges first, docker-style
// 172.16/12 last (that range is still legitimate on some networks).
function classRank(ip) {
  const [a, b] = ip.split(".").map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  return 2; // 172.16.0.0/12
}

export function detectLanIp() {
  // 1. Explicit override always wins.
  if (process.env.PLUTUS_HOST) return process.env.PLUTUS_HOST;

  // 2. First private IPv4 on a physical-looking interface.
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const ip of privateIpv4(addrs ?? [])) candidates.push(ip);
  }
  candidates.sort((x, y) => classRank(x) - classRank(y));
  if (candidates.length > 0) return candidates[0];

  // 3. No physical-looking interface: accept a virtual one before giving up
  //    (bare containers often only have a bridge IP).
  for (const addrs of Object.values(os.networkInterfaces())) {
    const ips = privateIpv4(addrs ?? []);
    if (ips.length > 0) return ips[0];
  }

  // 4. Loopback fallback (CI containers with no network at all).
  return "127.0.0.1";
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());

if (invokedDirectly) {
  const lanIp = detectLanIp();
  const arg = process.argv[2];
  if (arg === "--url") {
    const port = process.argv[3];
    console.log(`http://${lanIp}${port ? `:${port}` : ""}`);
  } else {
    console.log(lanIp);
  }
}
