// Turns anything an axios call can throw into a sentence that is safe to render.
//
// FastAPI's `detail` is a plain string for errors we raise ourselves, but an
// *array of objects* for request-validation failures (HTTP 422). Rendering that
// array as a React child throws ("Objects are not valid as a React child") and
// blanks the page, so every call site goes through here instead of reading
// `err.response.data.detail` directly.

interface ValidationIssue {
  loc?: unknown[];
  msg?: unknown;
}

function describeIssue(issue: unknown): string | null {
  if (typeof issue === "string") return issue.trim() || null;
  if (!issue || typeof issue !== "object") return null;

  const { loc, msg } = issue as ValidationIssue;
  if (typeof msg !== "string" || !msg.trim()) return null;

  // Messages from our own validators arrive as "Value error, <our sentence>":
  // they already read as a full sentence, so drop the noise prefix.
  if (msg.startsWith("Value error, ")) return msg.slice("Value error, ".length);

  // Built-in messages ("Input should be a valid integer") need to say *which*
  // field, using the last path segment ("year"), skipping "body"/"query".
  const field = Array.isArray(loc) ? [...loc].reverse().find((part) => typeof part === "string") : undefined;
  const label = typeof field === "string" && field !== "body" && field !== "query" ? `${field.replace(/_/g, " ")}: ` : "";
  return `${label}${msg}`;
}

export function getApiErrorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const error = err as {
    response?: { data?: { detail?: unknown } };
    request?: unknown;
    code?: string;
  } | null;

  if (!error) return fallback;

  // Request was sent but nothing came back: server down, CORS block, offline.
  if (!error.response) {
    return "Can't reach the server. Check your connection and try again.";
  }

  const detail = error.response.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const messages = detail.map(describeIssue).filter((m): m is string => Boolean(m));
    if (messages.length > 0) return messages.join(" ");
  }

  return fallback;
}
