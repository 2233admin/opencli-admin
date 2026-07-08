"use client"

// Thin Yjs wrapper for real-time collaboration on nodes / edges + awareness
// cursors. Mirrors the recipe in https://reactflow.dev/examples/interaction/collaborative
// but reused as a hook so the canvas is decoupled from transport.

import { useEffect, useMemo, useRef, useState } from "react"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"
import { nanoid } from "nanoid"
import type { WorkflowNode, WorkflowEdge } from "./types"

const COLORS = ["#ff7a17", "#4ade80", "#a0c3ec", "#f87171", "#c084fc", "#facc15"]
const NAMES = ["Ada", "Alan", "Grace", "Linus", "Rita", "Ken", "Barbara", "Dennis"]

export interface RemoteCursor {
  id: number
  name: string
  color: string
  x: number
  y: number
}

export interface RemoteUser {
  id: number
  name: string
  color: string
}

export interface YjsBinding {
  connected: boolean
  users: RemoteUser[]
  cursors: RemoteCursor[]
  /** publish local graph state — call from a store subscription. */
  publish(nodes: WorkflowNode[], edges: WorkflowEdge[]): void
  /** publish local cursor position (flow coords). */
  publishCursor(x: number, y: number): void
  /** subscribe to remote graph updates. */
  onRemote(handler: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void): () => void
}

const NULL_BINDING: YjsBinding = {
  connected: false,
  users: [],
  cursors: [],
  publish: () => {},
  publishCursor: () => {},
  onRemote: () => () => {},
}

export function useYjs(
  enabled: boolean,
  { url, room }: { url: string; room: string },
): YjsBinding {
  const [connected, setConnected] = useState(false)
  const [users, setUsers] = useState<RemoteUser[]>([])
  const [cursors, setCursors] = useState<RemoteCursor[]>([])
  const remoteHandlerRef = useRef<((nodes: WorkflowNode[], edges: WorkflowEdge[]) => void) | null>(null)
  const applyingRemote = useRef(false)

  const identity = useMemo(
    () => ({
      name: NAMES[Math.floor(Math.random() * NAMES.length)] + "-" + nanoid(3),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }),
    [],
  )

  const bindingRef = useRef<{
    doc: Y.Doc
    provider: WebsocketProvider
    nodesMap: Y.Map<WorkflowNode>
    edgesMap: Y.Map<WorkflowEdge>
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === "undefined") return

    const doc = new Y.Doc()
    const nodesMap = doc.getMap<WorkflowNode>("nodes")
    const edgesMap = doc.getMap<WorkflowEdge>("edges")
    const provider = new WebsocketProvider(url, room, doc)

    provider.awareness.setLocalStateField("user", identity)

    bindingRef.current = { doc, provider, nodesMap, edgesMap }

    const onStatus = ({ status }: { status: string }) => setConnected(status === "connected")
    provider.on("status", onStatus)

    const onGraphUpdate = () => {
      if (!remoteHandlerRef.current) return
      applyingRemote.current = true
      const nodes = Array.from(nodesMap.values())
      const edges = Array.from(edgesMap.values())
      remoteHandlerRef.current(nodes, edges)
      queueMicrotask(() => {
        applyingRemote.current = false
      })
    }
    nodesMap.observe(onGraphUpdate)
    edgesMap.observe(onGraphUpdate)

    const onAwareness = () => {
      const states = Array.from(provider.awareness.getStates().entries())
      const nextUsers: RemoteUser[] = []
      const nextCursors: RemoteCursor[] = []
      const localId = provider.awareness.clientID
      for (const [clientId, state] of states) {
        const s = state as { user?: RemoteUser; cursor?: { x: number; y: number } }
        if (!s.user) continue
        if (clientId === localId) continue
        nextUsers.push({ id: clientId, name: s.user.name, color: s.user.color })
        if (s.cursor) {
          nextCursors.push({ id: clientId, name: s.user.name, color: s.user.color, x: s.cursor.x, y: s.cursor.y })
        }
      }
      setUsers(nextUsers)
      setCursors(nextCursors)
    }
    provider.awareness.on("change", onAwareness)

    return () => {
      nodesMap.unobserve(onGraphUpdate)
      edgesMap.unobserve(onGraphUpdate)
      provider.awareness.off("change", onAwareness)
      provider.off("status", onStatus)
      provider.destroy()
      doc.destroy()
      bindingRef.current = null
      setConnected(false)
      setUsers([])
      setCursors([])
    }
  }, [enabled, url, room, identity])

  if (!enabled) return NULL_BINDING

  return {
    connected,
    users,
    cursors,
    publish(nodes, edges) {
      const b = bindingRef.current
      if (!b || applyingRemote.current) return
      b.doc.transact(() => {
        const nextNodeIds = new Set(nodes.map((n) => n.id))
        for (const key of Array.from(b.nodesMap.keys())) {
          if (!nextNodeIds.has(key)) b.nodesMap.delete(key)
        }
        for (const node of nodes) b.nodesMap.set(node.id, node)

        const nextEdgeIds = new Set(edges.map((e) => e.id))
        for (const key of Array.from(b.edgesMap.keys())) {
          if (!nextEdgeIds.has(key)) b.edgesMap.delete(key)
        }
        for (const edge of edges) b.edgesMap.set(edge.id, edge)
      }, "local")
    },
    publishCursor(x, y) {
      bindingRef.current?.provider.awareness.setLocalStateField("cursor", { x, y })
    },
    onRemote(handler) {
      remoteHandlerRef.current = handler
      return () => {
        if (remoteHandlerRef.current === handler) remoteHandlerRef.current = null
      }
    },
  }
}
