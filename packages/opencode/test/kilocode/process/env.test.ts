// levios_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { currentHostFilter, model, setHostFilter, type HostChild } from "../../../src/kilocode/process/env"

const saved = currentHostFilter()

afterEach(() => {
  if (saved) setHostFilter(saved)
  else setHostFilter((env) => env)
  delete process.env.LEVIOS_ENV_TEST_SECRET
})

describe("model environment host filter", () => {
  test("the host filter decides what is inherited; the child's own variables are added after it", () => {
    process.env.LEVIOS_ENV_TEST_SECRET = "secret"
    const seen: HostChild[] = []
    setHostFilter((env, child) => {
      seen.push(child)
      const out = { ...env }
      delete out.LEVIOS_ENV_TEST_SECRET
      return out
    })
    const shell = model({ EXTRA: "1" })
    expect(shell.LEVIOS_ENV_TEST_SECRET).toBeUndefined()
    expect(shell.EXTRA).toBe("1")
    const mcp = model({ LEVIOS_ENV_TEST_SECRET: "explicit" }, { kind: "mcp", server: "launchpad", command: "launchpad-mcp-server" })
    expect(mcp.LEVIOS_ENV_TEST_SECRET).toBe("explicit")
    expect(seen).toEqual([{ kind: "process" }, { kind: "mcp", server: "launchpad", command: "launchpad-mcp-server" }])
  })

  test("the engine's own credentials are removed whatever the filter returns", () => {
    setHostFilter((env) => ({ ...env, KILO_SERVER_PASSWORD: "pw" }))
    expect(model().KILO_SERVER_PASSWORD).toBeUndefined()
  })
})
