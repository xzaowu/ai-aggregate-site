import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createSmtpEmailVerificationMailer,
  createSmtpPasswordResetMailer,
  parseSmtpMailerConfig,
  type EmailVerificationMailMessage,
  type SmtpTransportOptions
} from "../src/mailer";

const validEnv = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-password-secret",
  SMTP_FROM_NAME: "AI Aggregate",
  SMTP_FROM_ADDRESS: "no-reply@example.com"
};

function createFakeTransport() {
  const options: SmtpTransportOptions[] = [];
  const messages: EmailVerificationMailMessage[] = [];

  return {
    options,
    messages,
    factory: (input: SmtpTransportOptions) => {
      options.push(input);
      return {
        async sendMail(message: EmailVerificationMailMessage) {
          messages.push(message);
        }
      };
    }
  };
}

function parseRequiredSmtpConfig(env: Record<string, string | undefined>) {
  const config = parseSmtpMailerConfig(env);
  if (!config) {
    throw new Error("TEST_SMTP_CONFIG_MISSING");
  }
  return config;
}

describe("parseSmtpMailerConfig", () => {
  it("accepts an omitted SMTP configuration", () => {
    expect(parseSmtpMailerConfig({})).toBeUndefined();
  });

  it("parses a valid SMTP config", () => {
    expect(parseRequiredSmtpConfig(validEnv)).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "smtp-user",
      password: "smtp-password-secret",
      fromName: "AI Aggregate",
      fromAddress: "no-reply@example.com"
    });
  });

  it.each([
    ["only SMTP host", { SMTP_HOST: "smtp.example.com" }],
    ["only SMTP credentials", { SMTP_USER: "smtp-user", SMTP_PASS: "smtp-password-secret" }]
  ])("rejects %s", (_label, env) => {
    expect(() => parseSmtpMailerConfig(env)).toThrow("SMTP_MAILER_CONFIG_INVALID");
  });

  it.each([
    ["non-integer port", { SMTP_PORT: "465.5" }],
    ["out-of-range port", { SMTP_PORT: "65536" }],
    ["invalid secure", { SMTP_SECURE: "yes" }],
    ["user without pass", { SMTP_PASS: undefined }],
    ["pass without user", { SMTP_USER: undefined }],
    ["empty user", { SMTP_USER: "" }],
    ["empty password", { SMTP_PASS: "" }],
    ["user with CRLF", { SMTP_USER: "smtp-user\r\nBcc: victim" }],
    ["missing host", { SMTP_HOST: "" }],
    ["missing from name", { SMTP_FROM_NAME: "" }],
    ["invalid from address", { SMTP_FROM_ADDRESS: "bad address" }],
    [
      "multiple from addresses",
      { SMTP_FROM_ADDRESS: "no-reply@example.com,other@example.com" }
    ],
    [
      "display name from address",
      { SMTP_FROM_ADDRESS: "AI Aggregate <no-reply@example.com>" }
    ],
    [
      "CRLF from address",
      { SMTP_FROM_ADDRESS: "no-reply@example.com\r\nBcc: victim@example.com" }
    ],
    ["from address with leading whitespace", { SMTP_FROM_ADDRESS: " no-reply@example.com" }],
    ["from address with trailing whitespace", { SMTP_FROM_ADDRESS: "no-reply@example.com " }],
    ["from name with CRLF", { SMTP_FROM_NAME: "AI Aggregate\r\nBcc: victim" }],
    ["from name with leading whitespace", { SMTP_FROM_NAME: " AI Aggregate" }],
    ["from name with trailing whitespace", { SMTP_FROM_NAME: "AI Aggregate " }]
  ])("rejects %s", (_label, override) => {
    expect(() => parseSmtpMailerConfig({ ...validEnv, ...override })).toThrow(
      "SMTP_MAILER_CONFIG_INVALID"
    );
  });

  it("does not include the SMTP password in config errors", () => {
    try {
      parseSmtpMailerConfig({ ...validEnv, SMTP_PORT: "not-a-port" });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("smtp-password-secret");
    }
  });

  it.each([
    ["SMTP URL", "smtp://example.com"],
    ["host with port", "example.com:587"],
    ["host path", "example.com/path"],
    ["host credentials", "user:pass@example.com"],
    ["host CRLF", "example.com\r\nX-Test: 1"]
  ])("rejects %s", (_label, SMTP_HOST) => {
    expect(() => parseSmtpMailerConfig({ ...validEnv, SMTP_HOST })).toThrow(
      "SMTP_MAILER_CONFIG_INVALID"
    );
  });

  it.each([
    "smtp.example.com",
    "localhost",
    "127.0.0.1",
    "2001:db8::1"
  ])("accepts valid SMTP host %s", (SMTP_HOST) => {
    expect(parseSmtpMailerConfig({ ...validEnv, SMTP_HOST })?.host).toBe(
      SMTP_HOST
    );
  });

  it("preserves SMTP password whitespace in Nodemailer auth", () => {
    const fake = createFakeTransport();
    const config = parseSmtpMailerConfig({
      ...validEnv,
      SMTP_PASS: " smtp-password-secret "
    });

    createSmtpEmailVerificationMailer(config!, fake.factory);

    expect(fake.options[0]?.auth).toEqual({
      user: "smtp-user",
      pass: " smtp-password-secret "
    });
  });
});

describe("createSmtpEmailVerificationMailer", () => {
  it("sends fixed-subject text and escaped html through the injected transport", async () => {
    const fake = createFakeTransport();
    const config = parseRequiredSmtpConfig(validEnv);
    const mailer = createSmtpEmailVerificationMailer(config, fake.factory);
    const verificationUrl =
      "https://example.com/verify-email?token=A&next=<script>";
    const expiresAt = new Date("2026-07-20T12:00:00.000Z");

    await mailer.sendEmailVerification({
      to: "user.name+tag@example.co.uk",
      verificationUrl,
      expiresAt
    });

    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]?.from).toEqual({
      name: "AI Aggregate",
      address: "no-reply@example.com"
    });
    expect(fake.messages[0]?.to).toEqual({
      address: "user.name+tag@example.co.uk"
    });
    expect(fake.messages[0]?.subject).toBe("Verify your email address");
    expect(fake.messages[0]?.text).toContain(verificationUrl);
    expect(fake.messages[0]?.text).toContain("2026-07-20T12:00:00.000Z");
    expect(fake.messages[0]?.html).toContain("2026-07-20T12:00:00.000Z");
    expect(fake.messages[0]?.html).toContain(
      '<a href="https://example.com/verify-email?token=A&amp;next=&lt;script&gt;">'
    );
    expect(fake.messages[0]?.html).toContain(
      "<p>https://example.com/verify-email?token=A&amp;next=&lt;script&gt;</p>"
    );
    expect(fake.messages[0]?.html).not.toContain(
      "user.name+tag@example.co.uk"
    );
  });

  it.each([
    ["comma-separated recipients", "user@example.com,other@example.com"],
    ["semicolon-separated recipients", "user@example.com;other@example.com"],
    ["CRLF recipient", "user@example.com\r\nBcc: victim@example.com"],
    ["display name recipient", "User <user@example.com>"],
    ["recipient with backslash", "user\\name@example.com"],
    ["recipient with leading whitespace", " user@example.com"],
    ["recipient with trailing whitespace", "user@example.com "]
  ])("rejects %s before calling sendMail", async (_label, to) => {
    const fake = createFakeTransport();
    const mailer = createSmtpEmailVerificationMailer(
      parseRequiredSmtpConfig(validEnv),
      fake.factory
    );

    await expect(
      mailer.sendEmailVerification({
        to,
        verificationUrl: "https://example.com/verify-email?token=A",
        expiresAt: new Date("2026-07-20T12:00:00.000Z")
      })
    ).rejects.toThrow("SMTP_MAILER_RECIPIENT_INVALID");
    expect(fake.messages).toHaveLength(0);
  });

  it("sets SMTP timeouts and auth when credentials are configured", () => {
    const fake = createFakeTransport();

    createSmtpEmailVerificationMailer(
      parseRequiredSmtpConfig(validEnv),
      fake.factory
    );

    expect(fake.options).toEqual([
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: {
          user: "smtp-user",
          pass: "smtp-password-secret"
        }
      }
    ]);
  });

  it("does not set auth when credentials are absent", () => {
    const fake = createFakeTransport();
    const config = parseSmtpMailerConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "25",
      SMTP_SECURE: "false",
      SMTP_FROM_NAME: "AI Aggregate",
      SMTP_FROM_ADDRESS: "no-reply@example.com"
    });

    createSmtpEmailVerificationMailer(config!, fake.factory);

    expect(fake.options[0]).not.toHaveProperty("auth");
  });

  it("propagates sendMail failures", async () => {
    const failure = new Error("SMTP_SEND_FAILED");
    const mailer = createSmtpEmailVerificationMailer(
      parseRequiredSmtpConfig(validEnv),
      () => ({
        async sendMail() {
          throw failure;
        }
      })
    );

    await expect(
      mailer.sendEmailVerification({
        to: "user@example.com",
        verificationUrl: "https://example.com/verify-email?token=A",
        expiresAt: new Date("2026-07-20T12:00:00.000Z")
      })
    ).rejects.toBe(failure);
  });
});

describe("createSmtpPasswordResetMailer", () => {
  it("uses the same trusted SMTP config for a fixed reset message", async () => {
    const fake = createFakeTransport();
    const config = parseRequiredSmtpConfig(validEnv);
    const mailer = createSmtpPasswordResetMailer(config, fake.factory);
    const resetUrl = "https://app.example.test/reset-password?token=A&next=<script>";
    const expiresAt = new Date("2026-07-22T12:30:00.000Z");

    await mailer.sendPasswordReset({
      to: "reset.user@example.test",
      resetUrl,
      expiresAt
    });

    expect(fake.options).toEqual([
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        auth: {
          user: "smtp-user",
          pass: "smtp-password-secret"
        }
      }
    ]);
    expect(fake.messages).toHaveLength(1);
    expect(fake.messages[0]).toMatchObject({
      from: {
        name: "AI Aggregate",
        address: "no-reply@example.com"
      },
      to: { address: "reset.user@example.test" },
      subject: "Reset your password"
    });
    expect(fake.messages[0]?.text).toContain(resetUrl);
    expect(fake.messages[0]?.text).toContain("2026-07-22T12:30:00.000Z");
    expect(fake.messages[0]?.text).toContain("ignore this email");
    expect(fake.messages[0]?.html).toContain("2026-07-22T12:30:00.000Z");
    expect(fake.messages[0]?.html).toContain("ignore this email");
    expect(fake.messages[0]?.html).toContain(
      '<a href="https://app.example.test/reset-password?token=A&amp;next=&lt;script&gt;">'
    );
    expect(fake.messages[0]?.html).toContain(
      "<p>https://app.example.test/reset-password?token=A&amp;next=&lt;script&gt;</p>"
    );
  });

  it("rejects recipient injection before calling sendMail", async () => {
    const fake = createFakeTransport();
    const mailer = createSmtpPasswordResetMailer(
      parseRequiredSmtpConfig(validEnv),
      fake.factory
    );

    await expect(
      mailer.sendPasswordReset({
        to: "reset.user@example.test\r\nBcc: victim@example.test",
        resetUrl: "https://app.example.test/reset-password?token=A",
        expiresAt: new Date("2026-07-22T12:30:00.000Z")
      })
    ).rejects.toThrow("SMTP_MAILER_RECIPIENT_INVALID");
    expect(fake.messages).toHaveLength(0);
  });

  it("propagates sendMail failures without logging", async () => {
    const failure = new Error("TEST_SMTP_SEND_FAILURE");
    const mailer = createSmtpPasswordResetMailer(
      parseRequiredSmtpConfig(validEnv),
      () => ({
        async sendMail() {
          throw failure;
        }
      })
    );

    await expect(
      mailer.sendPasswordReset({
        to: "reset.user@example.test",
        resetUrl: "https://app.example.test/reset-password?token=A",
        expiresAt: new Date("2026-07-22T12:30:00.000Z")
      })
    ).rejects.toBe(failure);
  });
});

describe("mailer static safety", () => {
  it("does not include prohibited runtime behavior", () => {
    const source = readFileSync(new URL("../src/mailer.ts", import.meta.url), {
      encoding: "utf8"
    });

    expect(source).not.toContain("console.");
    expect(source).not.toContain("DEBUG_EMAIL");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("rejectUnauthorized: false");
    expect(source).not.toContain(".verify(");
  });
});
