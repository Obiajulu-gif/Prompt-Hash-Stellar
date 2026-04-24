import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

// Fields to redact from logs for privacy and security
const redactFields = [
  "req.headers.authorization",
  "req.headers.cookie",
  "plaintext",
  "secret",
  "privateKey",
  "unlockPrivateKey",
  "challengeSecret",
  "signedMessage",
  "body.plaintext",
  "body.secret",
  "body.privateKey",
  "body.signedMessage",
  "res.body.plaintext",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? "silent" : "info"),
  redact: {
    paths: redactFields,
    censor: "[REDACTED]",
  },
  transport: (isProduction || isTest)
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
        },
      },
  base: {
    env: process.env.NODE_ENV,
    service: "prompt-hash-unlock",
  },
});

export default logger;
