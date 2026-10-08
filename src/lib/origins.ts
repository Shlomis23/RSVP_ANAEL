export function allowedOrigins(
  env: Record<string, string | undefined> = process.env,
) {
  const origins = new Set<string>();
  if (env.APP_ORIGIN) origins.add(new URL(env.APP_ORIGIN).origin);
  // Only exact deployment/branch hosts supplied by Vercel; never trust Host or an arbitrary *.vercel.app site.
  if (env.VERCEL_ENV === "preview") {
    for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (host && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) {
        origins.add(`https://${host}`);
      }
    }
  }
  return origins;
}
