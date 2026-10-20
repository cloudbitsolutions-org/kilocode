/**
 * MCP `_meta` of a tool call naming the session turn that makes it, so an MCP server can act on
 * behalf of that session (for example, read the model and variant its turn runs with).
 */
export const CALLER_SESSION = "ai.kilo/sessionID"
export const CALLER_MESSAGE = "ai.kilo/messageID"
export const CALLER_DIRECTORY = "ai.kilo/directory"

export function callerMeta(input: { sessionID: string; messageID: string; directory: string }) {
  return {
    [CALLER_SESSION]: input.sessionID,
    [CALLER_MESSAGE]: input.messageID,
    [CALLER_DIRECTORY]: input.directory,
  }
}
