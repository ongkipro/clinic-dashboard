// `pnpm vendor:bootstrap` (DEC-036): the first platform owner of a fresh server, once.
// Run in the server terminal with DATABASE_URL set to the migration (owner) role:
//
//   pnpm vendor:bootstrap --email nama@vendor.id --nama "Nama Lengkap" \
//     --cidr 203.0.113.0/24 --label "Kantor vendor"
//
// The password is typed twice at a hidden prompt (or piped as two lines when stdin is not
// a terminal); it is never an argument or environment variable, so it never reaches shell
// history, the process list or a log. Refused once any vendor staff exists, for an email
// that already has an account (invite that person from Tim Vendor instead), and for a
// password outside the IAM-1 policy. One transaction: account, credential (Better Auth's
// own hash) and vendor_bootstrap (platform owner, console allowlist, vendor log); a refusal
// rolls back and is logged on its own. The first sign-in on /vendor/masuk enrols TOTP.
//
// Like the migration runner, Node runs this file with type stripping; the image ships it
// next to migrate.ts (Dockerfile).
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { passwordProblem } from "../auth/policy.ts";
import { resolveDatabaseUrl } from "./migrate.ts";

export class BootstrapError extends Error {}

export type BootstrapInput = { email: string; name: string; cidr: string; label: string; password: string; confirm: string };

export async function bootstrapFirstPlatformOwner(databaseUrl: string, input: BootstrapInput): Promise<{ staffId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || email.length > 254) throw new BootstrapError("Email tidak valid.");
  if (input.password !== input.confirm) throw new BootstrapError("Kedua kata sandi tidak sama.");
  const problem = passwordProblem(input.password, email);
  if (problem) throw new BootstrapError(problem);
  const hash = await hashPassword(input.password);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    let refusal: { code: string; reason?: string } | undefined;
    let staffId: string | undefined;
    try {
      // vendor_bootstrap refuses once vendor staff exist (already_bootstrapped); the account
      // made below is then rolled back with it.
      if ((await client.query(`select 1 from auth_user where lower(email) = $1`, [email])).rowCount) {
        refusal = { code: "ERR_VERSION_CONFLICT", reason: "account_exists" };
      } else {
        const user = (await client.query<{ id: string }>(
          `insert into auth_user (name, email, email_verified) values ($1, $2, false) returning id`, [input.name.trim(), email])).rows[0];
        await client.query(
          `insert into auth_account (user_id, account_id, provider_id, password) values ($1, $2, 'credential', $3)`, [user.id, user.id, hash]);
        const r = (await client.query<{ r: { ok: boolean; code?: string; reason?: string; id?: string } }>(
          `select vendor_bootstrap($1, $2, $3, $4) as r`, [user.id, input.name, input.cidr, input.label])).rows[0].r;
        if (r.ok) staffId = r.id;
        else refusal = { code: r.code ?? "ERR_FORBIDDEN", reason: r.reason };
      }
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    }
    if (staffId) {
      await client.query("commit");
      return { staffId };
    }
    // Refused: nothing created stays; the refusal itself is logged on its own.
    await client.query("rollback");
    await client.query(`select vendor_log(null, null, null, 'vendor_bootstrap', null, null, 'denied', $1, null)`, [refusal!.reason ?? "invalid_input"]);
    throw new BootstrapError(MESSAGES[refusal!.reason ?? refusal!.code] ?? MESSAGES.ERR_INVALID_INPUT);
  } finally {
    await client.end();
  }
}

const MESSAGES: Record<string, string> = {
  already_bootstrapped: "Tim Vendor sudah ada. Pemilik Platform mengundang anggota baru dari Konsol Vendor › Tim Vendor.",
  account_exists: "Email ini sudah punya akun. Pakai email lain, atau undang orang ini dari Konsol Vendor › Tim Vendor.",
  dual_identity_not_approved: "Akun ini terhubung ke klinik. Pakai email lain.",
  ERR_INVALID_INPUT: "Isian tidak valid: nama 2–120 karakter, label 2–80 karakter, CIDR paling luas /16 (IPv4) atau /32 (IPv6).",
};

// Hidden prompt on a terminal (nothing echoed); two plain lines when piped.
async function readPasswords(): Promise<[string, string]> {
  if (!process.stdin.isTTY) {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      lines.push(line);
      if (lines.length === 2) break;
    }
    rl.close();
    return [lines[0] ?? "", lines[1] ?? ""];
  }
  const ask = (label: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(label);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      let value = "";
      const onData = (buf: Buffer) => {
        for (const ch of buf.toString("utf8")) {
          if (ch === "\r" || ch === "\n") {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off("data", onData);
            process.stdout.write("\n");
            return resolve(value);
          }
          if (ch === "\u0003") process.exit(130); // Ctrl+C
          if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
          else value += ch;
        }
      };
      stdin.on("data", onData);
    });
  return [await ask("Kata sandi (min. 15 karakter): "), await ask("Ulangi kata sandi: ")];
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { email: { type: "string" }, nama: { type: "string" }, cidr: { type: "string" }, label: { type: "string" } },
    strict: true,
  });
  if (!values.email || !values.nama || !values.cidr || !values.label) {
    console.error('Pakai: pnpm vendor:bootstrap --email <email> --nama "<nama>" --cidr <ip/cidr> --label "<label>"');
    process.exit(2);
  }
  try {
    const [password, confirm] = await readPasswords();
    await bootstrapFirstPlatformOwner(resolveDatabaseUrl(process.env), {
      email: values.email, name: values.nama, cidr: values.cidr, label: values.label, password, confirm,
    });
    console.log("Pemilik Platform pertama dibuat. Masuk di /vendor/masuk dan pasang aplikasi autentikator.");
  } catch (e) {
    console.error(e instanceof BootstrapError ? e.message : "Bootstrap gagal. Periksa DATABASE_URL dan log server.");
    process.exit(1);
  }
}
