// Minimal structured (JSON-lines) logger — no external dependency. Every line is a single
// JSON object with a level, message, timestamp, and whatever context fields the caller passes
// (reqId, userId, statusCode, ...), so log lines are grep/jq-able instead of free-text
// console.log. This is a pragmatic floor, not a replacement for a real APM/error tracker
// (Sentry, Datadog, etc.) — wiring one of those in needs an account/DSN this repo doesn't have;
// swap the `write` calls below for that SDK once one is provisioned.
const write = (level, message, context = {}) => {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
};

export const logger = {
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
};
