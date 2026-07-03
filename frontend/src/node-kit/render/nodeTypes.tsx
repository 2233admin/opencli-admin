// Bridge registry → xyflow. Call AFTER registering nodes; returns the nodeTypes
// map (every registered spec.type -> a KitNode bound to that spec). Memoize the
// result in the host (it only changes when new node types are registered).
import type { NodeProps, NodeTypes } from '@xyflow/react'

import { listNodes } from '../registry'
import { KitNode, type KitNodeData } from './KitNode'

export function nodeTypesForXyflow(options: { hideOps?: boolean } = {}): NodeTypes {
  const { hideOps } = options
  const map: NodeTypes = {}
  for (const spec of listNodes()) {
    map[spec.type] = function BoundKitNode(props: NodeProps) {
      return (
        <KitNode
          spec={spec}
          id={props.id}
          data={props.data as unknown as KitNodeData}
          selected={props.selected}
          hideOps={hideOps}
        />
      )
    }
  }
  return map
}
