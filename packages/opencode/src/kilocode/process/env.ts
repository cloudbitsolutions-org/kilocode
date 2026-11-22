// levios_change start - the host's filter of what model-facing children inherit
/** The child an environment is for: an MCP server (with its name and command), or any other process. */
export type HostChild = { kind: "process" } | { kind: "mcp"; server: string; command: string }

/**
 * Set in-process by the host that embeds the engine (levi-server, at startup). It receives this
 * process's environment and returns the part the child inherits; the child's own variables
 * (`extra`: a `shell.env` plugin result, an MCP server's configured environment) are added after.
 */
export type HostFilter = (env: Record<string, string>, child: HostChild) => Record<string, string>

let hostFilter: HostFilter | undefined

export function setHostFilter(filter: HostFilter) {
  hostFilter = filter
}

export function currentHostFilter() {
  return hostFilter
}
// levios_change end

function strings(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export function model(extra?: NodeJS.ProcessEnv | null, child: HostChild = { kind: "process" }): Record<string, string> {
  const inherited = strings(process.env)
  const env = { ...(hostFilter ? hostFilter(inherited, child) : inherited), ...strings(extra ?? {}) } // levios_change
  delete env.KILO_SERVER_PASSWORD
  delete env.KILO_SERVER_USERNAME
  delete env.KILO_BROWSER_BROKER_URL
  delete env.KILO_BROWSER_BROKER_TOKEN
  delete env.KILO_CONFIG
  delete env.KILO_CONFIG_CONTENT
  delete env.KILO_CONFIG_DIR
  return env
}
