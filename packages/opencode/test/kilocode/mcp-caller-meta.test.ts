import { describe, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpCatalog } from "@/mcp/catalog"
import { CALLER_DIRECTORY, CALLER_MESSAGE, CALLER_SESSION, callerMeta } from "@/kilocode/mcp/caller-meta"

const options = { toolCallId: "call_mcp", abortSignal: new AbortController().signal } as any
const def = { name: "whoami", inputSchema: { type: "object", properties: {} } } as any

async function connected() {
  const seen: Array<Record<string, unknown> | undefined> = []
  const server = new Server({ name: "meta", version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    seen.push(params._meta)
    return Promise.resolve({ content: [{ type: "text", text: "ok" }] })
  })
  const client = new Client({ name: "meta-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return { client, seen, close: () => Promise.all([client.close(), server.close()]) }
}

describe("MCP caller meta", () => {
  test("names the calling session turn and its directory", () => {
    expect(callerMeta({ sessionID: "ses_1", messageID: "msg_2", directory: "/workspace" })).toEqual({
      [CALLER_SESSION]: "ses_1",
      [CALLER_MESSAGE]: "msg_2",
      [CALLER_DIRECTORY]: "/workspace",
    })
  })

  test("convertTool sends the meta of the moment of each call", async () => {
    const mcp = await connected()
    try {
      let message = "msg_a"
      const tool = McpCatalog.convertTool(def, mcp.client, undefined, () =>
        callerMeta({ sessionID: "ses_1", messageID: message, directory: "/workspace" }),
      )
      await tool.execute?.({}, options)
      message = "msg_b"
      await tool.execute?.({}, options)
      expect(mcp.seen.map((m) => m?.[CALLER_MESSAGE])).toEqual(["msg_a", "msg_b"])
      expect(mcp.seen[0]?.[CALLER_SESSION]).toBe("ses_1")
    } finally {
      await mcp.close()
    }
  })

  test("convertTool without meta sends none", async () => {
    const mcp = await connected()
    try {
      await McpCatalog.convertTool(def, mcp.client).execute?.({}, options)
      expect(mcp.seen[0]?.[CALLER_SESSION]).toBeUndefined()
    } finally {
      await mcp.close()
    }
  })
})
