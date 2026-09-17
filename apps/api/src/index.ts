import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { normalizePublicWebUrl } from "./email-verification";
import {
  createSmtpEmailVerificationMailer,
  createSmtpPasswordResetMailer,
  createDisabledEmailVerificationMailer,
  parseSmtpMailerConfig
} from "./mailer";
import { buildServer } from "./server";

for (const envPath of [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env")
]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

const emailVerificationEnvironment =
  process.env.NODE_ENV === "production"
    ? "production"
    : process.env.NODE_ENV === "test"
      ? "test"
      : "development";

try {
  const publicWebUrl = normalizePublicWebUrl(
    process.env.PUBLIC_WEB_URL,
    emailVerificationEnvironment
  );
  const smtpMailerConfig = parseSmtpMailerConfig(process.env);
  const emailVerificationMailer = smtpMailerConfig
    ? createSmtpEmailVerificationMailer(smtpMailerConfig)
    : createDisabledEmailVerificationMailer();
  const passwordResetMailer = smtpMailerConfig
    ? createSmtpPasswordResetMailer(smtpMailerConfig)
    : undefined;
  const server = buildServer({
    emailVerificationMailer,
    passwordResetMailer,
    publicWebUrl
  });
  await server.listen({ port, host });
  server.log.info(`API listening on http://${host}:${port}`);
} catch {
  process.stderr.write("API startup failed\n");
  process.exit(1);
}
