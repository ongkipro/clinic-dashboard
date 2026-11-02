// KEK custody (ARCH-7, SEC-6): the KEK ring is a sealed file on the host, never a Coolify
// environment value. Its path comes from configuration (KEK_FILE). The file must be a
// regular file, not a symlink, readable by its owner only (mode 0400 or 0600).
//
// File format, one key per line:  <version>:<base64 of 32 random bytes>
// and one line `current=<version>` naming the version that wraps new DEKs. Rotation is
// stage-then-promote: append the new key on every instance, restart, then change
// `current=` and restart again. Generate a key with `openssl rand -base64 32`.
// Container mount: the host file is root-owned 0400 (ARCH-7); it is bind-mounted
// read-only into the app container owned by the container's app user, which is the
// owner this loader requires.
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { constants } from "node:fs";
import { KeyError, type KekRing } from "./envelope";

export function parseKekRing(text: string): KekRing {
  const keys = new Map<number, Buffer>();
  let current: number | undefined;
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const c = /^current=([1-9][0-9]{0,8})$/.exec(line);
    if (c) {
      if (current !== undefined) throw new KeyError("KEK file sets current twice");
      current = Number(c[1]);
      continue;
    }
    const m = /^([1-9][0-9]{0,8}):([A-Za-z0-9+/]{43}=)$/.exec(line);
    if (!m) throw new KeyError(`KEK file line ${i + 1} is malformed`);
    const v = Number(m[1]);
    if (keys.has(v)) throw new KeyError(`KEK version ${v} appears twice`);
    const key = Buffer.from(m[2], "base64");
    if (key.length !== 32) throw new KeyError(`KEK version ${v} is not 32 bytes`);
    keys.set(v, key);
  }
  if (keys.size === 0) throw new KeyError("KEK file has no keys");
  if (current === undefined) throw new KeyError("KEK file has no current=<version> line");
  if (!keys.has(current)) throw new KeyError(`current KEK version ${current} is not in the file`);
  return { current, keys };
}

export function loadKekRing(path: string): KekRing {
  const link = lstatSync(path);
  if (link.isSymbolicLink()) throw new KeyError("KEK file must not be a symlink");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new KeyError("KEK file must be a regular file");
    if ((st.mode & 0o077) !== 0) {
      throw new KeyError(`KEK file mode ${(st.mode & 0o777).toString(8)} is too open; use 0400`);
    }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
      throw new KeyError("KEK file must be owned by the user running the app");
    }
    return parseKekRing(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
