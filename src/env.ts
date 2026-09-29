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
  jwtSecret: required('JWT_SECRET'),
  jwtSecretKey: new TextEncoder().encode(required('JWT_SECRET')),
  // Optional, not required like DATABASE_URL/JWT_SECRET: no frontend exists
  // yet, and making this required would force every test file and CI run to
  // set it too, for a value nothing there actually uses. Defaults to Vite's
  // dev server port - the common case for a frontend just being scaffolded
  // - and stays fully overridable once a real deployed origin exists.
  corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
};
