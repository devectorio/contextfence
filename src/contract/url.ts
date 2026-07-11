import { TargetConfigurationError } from "./errors";

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Enforce encrypted targets, with an explicit exception for local development. */
export function assertAllowedTargetUrl(value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new TargetConfigurationError("Target baseUrl must be a valid absolute URL.");
  }
  if (target.username || target.password) {
    throw new TargetConfigurationError("Target URLs must not contain credentials.");
  }
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && LOCAL_HTTP_HOSTS.has(target.hostname))
  ) {
    throw new TargetConfigurationError(
      "Target baseUrl must use HTTPS (HTTP is allowed only for localhost, 127.0.0.1, or ::1).",
    );
  }
  if (target.search || target.hash) {
    throw new TargetConfigurationError("Target baseUrl must not contain a query string or fragment.");
  }
  return target;
}

