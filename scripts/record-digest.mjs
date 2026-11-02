#!/usr/bin/env node
// DEL-2 / DEL-4: one build artifact per release with its digest recorded.
// Usage: node scripts/record-digest.mjs <image-ref> [output.json]
// Reads the local image's content-addressed id (and repo digests once pushed) from
// Docker and writes a JSON record that CI uploads as an artifact. Until the release task
// pushes images to a registry this is a build attestation, not a deployable reference:
// `imageId` is the local config digest and `repoDigests` stays empty. On pull requests
// GITHUB_SHA is the merge commit, so the PR head is recorded separately.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [image, out = "image-digest.json"] = process.argv.slice(2);
if (!image) {
  console.error("usage: node scripts/record-digest.mjs <image-ref> [output.json]");
  process.exit(2);
}

const [inspected] = JSON.parse(
  execFileSync("docker", ["image", "inspect", image], { encoding: "utf8" }),
);
const imageId = inspected.Id;
if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) {
  console.error(`unexpected image id: ${imageId}`);
  process.exit(1);
}

const record = {
  kind: "build-attestation", // becomes a registry digest when the release task pushes
  image,
  imageId,
  repoDigests: inspected.RepoDigests ?? [],
  commit: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  ref: process.env.GITHUB_REF ?? null,
  prHead: process.env.GITHUB_HEAD_SHA || null,
  run: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  recordedAt: new Date().toISOString(),
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`${record.imageId} ${record.commit}`);
