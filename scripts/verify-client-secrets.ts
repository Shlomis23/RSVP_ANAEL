import { config } from "dotenv";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
config({ path: ".env.local", quiet: true });
config({ path: "work/.env.tests", quiet: true });
const secrets = [process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED, process.env.ADMIN_PASSWORD_HASH, process.env.TEST_ADMIN_PASSWORD].filter((v): v is string => Boolean(v));
async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]));
  return paths.flat();
}
for (const file of await walk(".next/static")) {
  const contents = await readFile(file, "utf8");
  if (secrets.some((secret) => contents.includes(secret))) throw new Error("A private value appeared in a browser asset");
}
const files = execFileSync("git", ["ls-files", "--cached"], { encoding: "utf8" }).trim().split(/\r?\n/);
if (files.some((file) => /(^|\/)(\.env(?!\.example)|\.neon$|work\/|node_modules\/)/.test(file))) throw new Error("A private or generated file is tracked by Git");
console.log("PASS: private values absent from browser assets; private/generated files are not tracked.");
