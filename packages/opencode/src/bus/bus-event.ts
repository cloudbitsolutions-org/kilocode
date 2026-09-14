import { Schema } from "effect"
import { EventManifest } from "@/event-manifest" // kilocode_change

export type Definition<Type extends string = string, Properties extends Schema.Top = Schema.Top> = {
  type: Type
  properties: Properties
}

const registry = new Map<string, Definition>()

export function define<Type extends string, Properties extends Schema.Top>(
  type: Type,
  properties: Properties,
): Definition<Type, Properties> {
  const result = { type, properties }
  registry.set(type, result)
  return result
}

export function effectPayloads() {
  const payloads: any[] = []

  for (const [type, def] of registry.entries()) {
    if (def?.properties && (def.properties as any).ast) {
      payloads.push(
        Schema.Struct({
          id: Schema.String,
          type: Schema.Literal(type),
          properties: def.properties,
        }).annotate({ identifier: `Event.${type}` }),
      )
    } else {
      console.warn(`[bus-event] Skipping registry event without valid schema: ${type}`, def)
    }
  }

  // kilocode_change start - expose current Effect events through legacy bus schemas
  try {
    const latestValues = EventManifest?.Latest?.values?.()
    if (latestValues) {
      for (const definition of latestValues) {
        if (definition?.data && (definition.data as any).ast) {
          payloads.push(
            Schema.Struct({
              id: Schema.String,
              type: Schema.Literal(definition.type),
              properties: definition.data,
            }).annotate({ identifier: `Event.${definition.type}` }),
          )
        } else {
          console.warn(`[bus-event] Skipping EventManifest event without valid data schema: ${definition?.type}`)
        }
      }
    }
  } catch (err) {
    console.warn("[bus-event] Failed to read EventManifest.Latest:", err)
  }
  // kilocode_change end

  return payloads
}

export * as BusEvent from "./bus-event"
