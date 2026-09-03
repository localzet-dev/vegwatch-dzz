import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const values = {
  VEGWATCH_ADMIN_EMAIL: process.env.VEGWATCH_ADMIN_EMAIL ?? "",
  VEGWATCH_ADMIN_PASSWORD: process.env.VEGWATCH_ADMIN_PASSWORD ?? "",
};

const contents = Object.entries(values)
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join("\n");

const outputPath = process.env.VEGWATCH_RUNTIME_ENV_PATH ?? "/tmp/vegwatch-runtime.env";
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${contents}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
