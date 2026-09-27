/**
 * The one message for an AI feature on a server with no model configured.
 * Any account can see it, so it names the feature and nothing about setup —
 * environment variables are the operator's business, and there is no
 * settings screen for a key.
 */
export function aiUnavailable(feature: string): string {
  return `${feature} uses AI, which isn't turned on for this app yet.`;
}
