import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { passwordHash } from "../src/lib/crypto";

let hidden = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  process.stdout.write("Choose an admin password (at least 12 characters): ");
  hidden = true;
  const password = await rl.question("");
  hidden = false;
  process.stdout.write("\nConfirm password: ");
  hidden = true;
  const confirmed = await rl.question("");
  hidden = false;
  process.stdout.write("\n");
  if (password !== confirmed) throw new Error("Passwords do not match");
  if (password.length < 12 || password.length > 200)
    throw new Error("Use 12–200 characters");
  const hash = passwordHash(password);
  const existing = await readFile(".env.local", "utf8").catch(() => "");
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("ADMIN_PASSWORD_HASH=") && line !== "");
  await writeFile(
    ".env.local",
    [...lines, `ADMIN_PASSWORD_HASH=${hash}`, ""].join("\n"),
  );
  console.log(
    "Admin password saved as a hash in .env.local. Restart the server. For deployment copy only ADMIN_PASSWORD_HASH to your server's secret environment settings.",
  );
} finally {
  rl.close();
}
