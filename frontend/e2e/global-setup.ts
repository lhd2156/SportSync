import { execSync } from "node:child_process";

function clearRedisAuthBuckets(): void {
  const command =
    "docker exec sportsync-redis sh -lc \"redis-cli --raw KEYS 'rate:*' | xargs -r redis-cli DEL >/dev/null; " +
    "redis-cli --raw KEYS 'password_reset:*' | xargs -r redis-cli DEL >/dev/null; " +
    "redis-cli --raw KEYS 'lockout:*' | xargs -r redis-cli DEL >/dev/null\"";

  try {
    execSync(command, {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // Best-effort local cleanup. CI and non-Docker runs should still proceed.
  }
}

async function globalSetup(): Promise<void> {
  clearRedisAuthBuckets();
}

export default globalSetup;
