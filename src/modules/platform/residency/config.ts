// Deployed storage locations and release digest, read from configuration only (PR-36, ARCH-9, H-02b; T-120).
// Every production storage target — database, object storage, backups, logs, error tracking (STORAGE_KINDS) —
// is declared by the deployment via:
//   RESIDENCY_<KIND>_PROVIDER   ([\w .-]{2,60})
//   RESIDENCY_<KIND>_REGION     ([\w .-]{2,60})
//   RESIDENCY_<KIND>_COUNTRY    (ISO 3166-1 alpha-2)
// plus APP_RELEASE_DIGEST (16..128 lowercase hex characters) identifying the exact deployed release serving writes.
// No region, provider or country is hard-coded anywhere in code (ARCH-9: moving providers changes configuration only).
import { createHash } from "node:crypto";
import { STORAGE_KINDS } from "../../vendor/schema";

export type StorageKind = (typeof STORAGE_KINDS)[number];
export type Location = { kind: StorageKind; provider: string; region: string; country: string };
export type ConfigIssue = { kind: StorageKind; field: "provider" | "region" | "country"; problem: "missing" | "invalid" };
export type DeployedConfig = { locations: Location[]; issues: ConfigIssue[] };
export type EffectiveResidencyConfig = DeployedConfig & {
  releaseDigest: string | null;
  releaseDigestValid: boolean;
  locationsDigest: string | null;
};

const NAME = /^[\w .-]{2,60}$/;
const COUNTRY = /^[A-Z]{2}$/;
const DIGEST = /^[0-9a-f]{16,128}$/;

export const envKey = (kind: StorageKind, field: "provider" | "region" | "country") =>
  `RESIDENCY_${kind.toUpperCase()}_${field.toUpperCase()}`;

export function releaseDigest(env: Partial<Record<string, string>> = process.env): string | null {
  const raw = env.APP_RELEASE_DIGEST?.trim();
  if (!raw || !DIGEST.test(raw)) return null;
  return raw;
}

export function deployedLocations(env: Partial<Record<string, string>> = process.env): DeployedConfig {
  const locations: Location[] = [];
  const issues: ConfigIssue[] = [];
  for (const kind of STORAGE_KINDS) {
    const v = {
      provider: env[envKey(kind, "provider")]?.trim(),
      region: env[envKey(kind, "region")]?.trim(),
      country: env[envKey(kind, "country")]?.trim(),
    };
    let ok = true;
    for (const field of ["provider", "region", "country"] as const) {
      const x = v[field];
      if (!x) {
        issues.push({ kind, field, problem: "missing" });
        ok = false;
        continue;
      }
      if (!(field === "country" ? COUNTRY : NAME).test(x)) {
        issues.push({ kind, field, problem: "invalid" });
        ok = false;
      }
    }
    if (ok) locations.push({ kind, provider: v.provider!, region: v.region!, country: v.country! });
  }
  return { locations, issues };
}

// Canonical SHA-256 digest of a complete, valid deployed location set (exact SQL mirror in residency_attest).
// Returns null if any storage kind is missing or invalid so callers fail closed.
export function residencyConfigDigest(cfg: DeployedConfig): string | null {
  if (cfg.issues.length > 0 || cfg.locations.length !== STORAGE_KINDS.length) return null;
  const canonical = [...cfg.locations]
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
    .map((l) => `${l.kind}|${l.provider.trim().toLowerCase()}|${l.region.trim().toLowerCase()}|${l.country.trim()}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// Single runtime configuration reader consumed by storage clients, bindResidencyContext, and deploy-time attestation.
export function effectiveResidencyConfig(env: Partial<Record<string, string>> = process.env): EffectiveResidencyConfig {
  const deployed = deployedLocations(env);
  const digest = releaseDigest(env);
  return { ...deployed, releaseDigest: digest, releaseDigestValid: digest !== null, locationsDigest: residencyConfigDigest(deployed) };
}

export type Mismatch = {
  kind: StorageKind;
  problem: "undeclared" | "ambiguous" | "differs";
  deployed: Location | null;
  declared: Location[];
};

const same = (a: Location, b: Location) =>
  a.provider.toLowerCase() === b.provider.toLowerCase()
  && a.region.toLowerCase() === b.region.toLowerCase()
  && a.country === b.country;

export function matchDeclared(deployed: readonly Location[], declared: readonly Location[]): Mismatch[] {
  const out: Mismatch[] = [];
  for (const kind of STORAGE_KINDS) {
    const d = deployed.find((x) => x.kind === kind) ?? null;
    const p = declared.filter((x) => x.kind === kind);
    if (!d) continue;
    if (p.length === 0) out.push({ kind, problem: "undeclared", deployed: d, declared: [] });
    else if (p.length > 1) out.push({ kind, problem: "ambiguous", deployed: d, declared: p });
    else if (!same(d, p[0])) out.push({ kind, problem: "differs", deployed: d, declared: p });
  }
  return out;
}
