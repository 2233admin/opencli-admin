import { spawnSync } from "node:child_process"

const command = process.argv[2]
const commandArgs = {
  dev: "pnpm --dir frontend dev",
  build: "pnpm --dir frontend build",
  lint: "pnpm --dir frontend lint",
  typecheck: "pnpm --dir frontend exec tsc --noEmit",
}

if (!command || !commandArgs[command]) {
  console.error("Usage: node scripts/frontend.mjs <dev|build|lint|typecheck>")
  process.exit(1)
}

const result = spawnSync(commandArgs[command], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PNPM_CONFIG_MINIMUM_RELEASE_AGE: "0",
  },
})

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
