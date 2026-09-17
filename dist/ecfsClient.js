const BASE_URL = "https://publicapi.fcc.gov/ecfs";
export class EcfsApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = "EcfsApiError";
    }
}
export class MissingApiKeyError extends Error {
    constructor() {
        super("ECFS_API_KEY is not set. Get a free key at " +
            "https://www.fcc.gov/ecfs/help/public_api and set it as an " +
            "environment variable before starting this server.");
        this.name = "MissingApiKeyError";
    }
}
function getApiKey() {
    const key = process.env.ECFS_API_KEY?.trim();
    if (!key || key.length === 0) {
        throw new MissingApiKeyError();
    }
    return key;
}
/** Strips the api_key query param so it never leaks into logs or tool output. */
export function redactUrl(url) {
    const parsed = new URL(url);
    if (parsed.searchParams.has("api_key")) {
        parsed.searchParams.set("api_key", "REDACTED");
    }
    return parsed.toString();
}
/**
 * Redacts any occurrence of the literal API key value from raw response text.
 * Some ECFS response bodies echo the key back verbatim — e.g. `type=downloadplan`
 * responses embed it in each bucket's `suggested_api_call` URL — so redactUrl()
 * (which only covers URLs we construct for error messages) isn't enough on its own.
 */
function redactApiKeyFromText(text, apiKey) {
    if (!apiKey)
        return text;
    return text.split(apiKey).join("REDACTED");
}
function buildUrl(path, params) {
    const url = new URL(BASE_URL + (path.startsWith("/") ? path : `/${path}`));
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined)
            continue;
        url.searchParams.set(key, String(value));
    }
    url.searchParams.set("api_key", getApiKey());
    return url;
}
/**
 * Performs a GET request against the ECFS public API.
 * Throws MissingApiKeyError if no key is configured, or EcfsApiError on a
 * non-2xx response. Never includes the raw API key in thrown error messages.
 */
export async function ecfsGet(path, params = {}) {
    const url = buildUrl(path, params);
    const apiKey = url.searchParams.get("api_key") ?? "";
    let response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json" },
        });
    }
    catch (cause) {
        throw new Error(`Network error calling ECFS API at ${redactUrl(url.toString())}: ${cause.message}`);
    }
    const rawText = await response.text();
    const text = redactApiKeyFromText(rawText, apiKey);
    let body;
    try {
        body = text.length > 0 ? JSON.parse(text) : undefined;
    }
    catch {
        body = text;
    }
    if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body
            ? JSON.stringify(body.error)
            : `HTTP ${response.status}`;
        throw new EcfsApiError(`ECFS API request to ${redactUrl(url.toString())} failed: ${message}`, response.status, body);
    }
    return body;
}
