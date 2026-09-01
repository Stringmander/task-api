try {
  process.loadEnvFile();
} catch {
  // no .env file present (e.g. CI) — rely on process.env directly
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env['PORT'] ?? 3000),
};
