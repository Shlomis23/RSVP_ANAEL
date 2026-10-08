import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { passwordHash, newToken } from "../src/lib/crypto";
config({ path: ".env.local", quiet: true });
if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production")
  throw new Error("Tests require a development branch");
const password = newToken();
const existing = await readFile(".env.local", "utf8");
const lines = existing
  .split(/\r?\n/)
  .filter(
    (v) => v && !/^(APP_ORIGIN|COOKIE_SECURE|ADMIN_PASSWORD_HASH)=/.test(v),
  );
if (process.env.ADMIN_PASSWORD_HASH)
  throw new Error("Refusing to replace an existing administrator password");
await writeFile(
  ".env.local",
  [
    ...lines,
    "APP_ORIGIN=http://127.0.0.1:3000",
    "COOKIE_SECURE=false",
    `ADMIN_PASSWORD_HASH=${passwordHash(password)}`,
    "",
  ].join("\n"),
);
await mkdir("work", { recursive: true });
await writeFile("work/.env.tests", `TEST_ADMIN_PASSWORD=${password}\n`);
console.log(
  "Development test credential configured. Raw password is local and gitignored; no production credentials changed.",
);
