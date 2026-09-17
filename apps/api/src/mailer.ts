import nodemailer from "nodemailer";
import { isIP } from "node:net";

export interface EmailVerificationMailer {
  sendEmailVerification(input: {
    to: string;
    verificationUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface PasswordResetMailer {
  sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void>;
}

export interface SmtpMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromName: string;
  fromAddress: string;
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  auth?: {
    user: string;
    pass: string;
  };
}

export interface EmailVerificationMailMessage {
  from: {
    name: string;
    address: string;
  };
  to: {
    address: string;
  };
  subject: string;
  text: string;
  html: string;
}

interface MailTransport {
  sendMail(message: EmailVerificationMailMessage): Promise<unknown>;
}

type MailTransportFactory = (options: SmtpTransportOptions) => MailTransport;

const smtpConfigError = "SMTP_MAILER_CONFIG_INVALID";
const verificationSubject = "Verify your email address";
const passwordResetSubject = "Reset your password";
const emailLocalPartPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

export function parseSmtpMailerConfig(
  env: Record<string, string | undefined>
): SmtpMailerConfig | undefined {
  const smtpKeys = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_FROM_NAME",
    "SMTP_FROM_ADDRESS",
    "SMTP_USER",
    "SMTP_PASS"
  ] as const;

  if (smtpKeys.every((key) => env[key] === undefined)) {
    return undefined;
  }

  const host = parseSmtpHost(env.SMTP_HOST);
  const port = parseSmtpPort(env.SMTP_PORT);
  const secure = parseSmtpSecure(env.SMTP_SECURE);
  const { user, password } = parseSmtpCredentials(env);
  const fromName = parseSmtpFromName(env.SMTP_FROM_NAME);
  const fromAddress = parseSingleEmailAddress(
    env.SMTP_FROM_ADDRESS,
    "fromAddress"
  );

  return {
    host,
    port,
    secure,
    ...(user !== undefined && password !== undefined
      ? {
          user,
          password
        }
      : {}),
    fromName,
    fromAddress
  };
}

export function createDisabledEmailVerificationMailer(): EmailVerificationMailer {
  return {
    async sendEmailVerification() {
      throw new Error("SMTP_MAILER_NOT_CONFIGURED");
    }
  };
}

export function createSmtpEmailVerificationMailer(
  config: SmtpMailerConfig,
  transportFactory: MailTransportFactory = createNodemailerTransport
): EmailVerificationMailer {
  const transportOptions = createSmtpTransportOptions(config);
  const transport = transportFactory(transportOptions);

  return {
    async sendEmailVerification(input) {
      const recipient = parseSingleEmailAddress(input.to, "recipient");

      await transport.sendMail({
        from: {
          name: config.fromName,
          address: config.fromAddress
        },
        to: {
          address: recipient
        },
        subject: verificationSubject,
        text: buildEmailVerificationText(input),
        html: buildEmailVerificationHtml(input)
      });
    }
  };
}

export function createSmtpPasswordResetMailer(
  config: SmtpMailerConfig,
  transportFactory: MailTransportFactory = createNodemailerTransport
): PasswordResetMailer {
  const transportOptions = createSmtpTransportOptions(config);
  const transport = transportFactory(transportOptions);

  return {
    async sendPasswordReset(input) {
      const recipient = parseSingleEmailAddress(input.to, "recipient");

      await transport.sendMail({
        from: {
          name: config.fromName,
          address: config.fromAddress
        },
        to: {
          address: recipient
        },
        subject: passwordResetSubject,
        text: buildPasswordResetText(input),
        html: buildPasswordResetHtml(input)
      });
    }
  };
}

function createNodemailerTransport(options: SmtpTransportOptions): MailTransport {
  return nodemailer.createTransport(options);
}

function createSmtpTransportOptions(
  config: SmtpMailerConfig
): SmtpTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    ...(config.user !== undefined && config.password !== undefined
      ? {
          auth: {
            user: config.user,
            pass: config.password
          }
        }
      : {})
  };
}

function buildEmailVerificationText(input: {
  verificationUrl: string;
  expiresAt: Date;
}): string {
  return [
    "Verify your email address by opening the link below.",
    `This verification link expires at ${input.expiresAt.toISOString()}.`,
    input.verificationUrl
  ].join("\n\n");
}

function buildEmailVerificationHtml(input: {
  verificationUrl: string;
  expiresAt: Date;
}): string {
  const escapedUrl = escapeHtml(input.verificationUrl);
  const escapedExpiry = escapeHtml(input.expiresAt.toISOString());

  return [
    "<p>Verify your email address by opening the link below.</p>",
    `<p>This verification link expires at ${escapedExpiry}.</p>`,
    `<p><a href="${escapedUrl}">Verify email address</a></p>`,
    `<p>${escapedUrl}</p>`
  ].join("");
}

function buildPasswordResetText(input: {
  resetUrl: string;
  expiresAt: Date;
}): string {
  return [
    "Reset your password by opening the link below.",
    `This password reset link expires at ${input.expiresAt.toISOString()}.`,
    "If you did not request a password reset, you can ignore this email.",
    input.resetUrl
  ].join("\n\n");
}

function buildPasswordResetHtml(input: {
  resetUrl: string;
  expiresAt: Date;
}): string {
  const escapedUrl = escapeHtml(input.resetUrl);
  const escapedExpiry = escapeHtml(input.expiresAt.toISOString());

  return [
    "<p>Reset your password by opening the link below.</p>",
    `<p>This password reset link expires at ${escapedExpiry}.</p>`,
    "<p>If you did not request a password reset, you can ignore this email.</p>",
    `<p><a href=\"${escapedUrl}\">Reset password</a></p>`,
    `<p>${escapedUrl}</p>`
  ].join("");
}

export function parseSingleEmailAddress(
  input: unknown,
  fieldName: "recipient" | "fromAddress"
): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 254 ||
    input !== input.trim() ||
    /[\r\n,;<>"\\]/.test(input) ||
    /\s/.test(input)
  ) {
    throwEmailAddressError(fieldName);
  }

  const atIndex = input.indexOf("@");
  if (atIndex <= 0 || atIndex !== input.lastIndexOf("@")) {
    throwEmailAddressError(fieldName);
  }

  const localPart = input.slice(0, atIndex);
  const domain = input.slice(atIndex + 1);
  if (
    localPart.length > 64 ||
    !emailLocalPartPattern.test(localPart) ||
    !isValidEmailDomain(domain)
  ) {
    throwEmailAddressError(fieldName);
  }

  return input;
}

function throwEmailAddressError(fieldName: "recipient" | "fromAddress"): never {
  throw new Error(
    fieldName === "recipient"
      ? "SMTP_MAILER_RECIPIENT_INVALID"
      : smtpConfigError
  );
}

function isValidEmailDomain(domain: string): boolean {
  return (
    domain.length > 0 &&
    domain.length <= 253 &&
    domain.includes(".") &&
    domain.split(".").every(isValidDnsLabel)
  );
}

function parseSmtpHost(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 253 ||
    value !== value.trim() ||
    /\s/.test(value) ||
    value.includes("://") ||
    /[\\/@?#]/.test(value)
  ) {
    throw new Error(smtpConfigError);
  }

  if (isIP(value) !== 0) {
    return value;
  }

  if (!value.includes(":") && value.split(".").every(isValidDnsLabel)) {
    return value;
  }

  throw new Error(smtpConfigError);
}

function isValidDnsLabel(label: string): boolean {
  return (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function parseSmtpFromName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(smtpConfigError);
  }

  return value;
}

function parseSmtpCredentials(env: Record<string, string | undefined>): {
  user?: string;
  password?: string;
} {
  const user = env.SMTP_USER;
  const password = env.SMTP_PASS;

  if (user === undefined && password === undefined) {
    return {};
  }

  if (
    typeof user !== "string" ||
    typeof password !== "string" ||
    user.length === 0 ||
    password.length === 0 ||
    /[\r\n]/.test(user)
  ) {
    throw new Error(smtpConfigError);
  }

  return { user, password };
}

function requireTrimmedNonEmptyEnv(value: string | undefined): string {
  const trimmed = optionalTrimmed(value);
  if (trimmed === undefined) {
    throw new Error(smtpConfigError);
  }

  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSmtpPort(value: string | undefined): number {
  const trimmed = requireTrimmedNonEmptyEnv(value);
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(smtpConfigError);
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(smtpConfigError);
  }

  return parsed;
}

function parseSmtpSecure(value: string | undefined): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(smtpConfigError);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
