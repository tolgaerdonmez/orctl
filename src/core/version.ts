import pkg from "../../package.json" with { type: "json" };

export const ORCTL_VERSION: string = pkg.version;

/** Exact @openrouter/sdk pin; cache envelopes are invalidated when it changes (plan §8.4). */
export const SDK_VERSION = "1.3.21";

export const USER_AGENT = `orctl/${ORCTL_VERSION}`;

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

export const MANAGEMENT_KEYS_URL = "https://openrouter.ai/settings/management-keys";
