// Platform residency and deployment environment tables (PR-36, ARCH-9, ARCH-10, MIG-2; T-120).
// Both tables are singletons (id = 1), policy kind `platform`, RLS enabled, zero runtime grants
// to clinic_app, clinic_vendor, or clinic_operator. Managed solely by migrations / deploy scripts
// (platform_environment) and the deploy-only residency_attest() definer (residency_attestations).
import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

export const DEPLOY_ENVS = ["local", "staging", "demo", "production"] as const;

export const platformEnvironment = pgTable(
  "platform_environment",
  {
    id: smallint("id").primaryKey().default(1),
    deployEnv: text("deploy_env", { enum: DEPLOY_ENVS }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_environment_singleton_check", sql`${t.id} = 1`),
    check("platform_environment_env_check", sql`${t.deployEnv} in ('local','staging','demo','production')`),
  ],
);

export const residencyAttestations = pgTable(
  "residency_attestations",
  {
    id: smallint("id").primaryKey().default(1),
    releaseDigest: text("release_digest").notNull(),
    deployedLocations: jsonb("deployed_locations").notNull().default(sql`'[]'::jsonb`),
    deployedLocationsDigest: text("deployed_locations_digest"),
    configVersion: text("config_version").notNull(),
    matched: boolean("matched").notNull(),
    mismatches: jsonb("mismatches").notNull().default(sql`'[]'::jsonb`),
    deployEnv: text("deploy_env", { enum: DEPLOY_ENVS }).notNull(),
    attestedAt: timestamp("attested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("residency_attestations_singleton_check", sql`${t.id} = 1`),
    check("residency_attestations_release_digest_check", sql`${t.releaseDigest} ~ '^[0-9a-f]{16,128}$'`),
    check("residency_attestations_deployed_check", sql`jsonb_typeof(${t.deployedLocations}) = 'array'`),
    check("residency_attestations_deployed_digest_check", sql`(${t.deployedLocationsDigest} is null or ${t.deployedLocationsDigest} ~ '^[0-9a-f]{64}$') and (not ${t.matched} or ${t.deployedLocationsDigest} is not null)`),
    check("residency_attestations_config_version_check", sql`${t.configVersion} ~ '^[0-9a-f]{64}$'`),
    check("residency_attestations_mismatches_check", sql`jsonb_typeof(${t.mismatches}) = 'array'`),
    check("residency_attestations_env_check", sql`${t.deployEnv} in ('production','staging','demo','local')`),
  ],
);
