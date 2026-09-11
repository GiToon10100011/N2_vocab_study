import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
}
