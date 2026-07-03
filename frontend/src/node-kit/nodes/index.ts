// The atomic node library — real system functionality, nodified. Grouped:
//   sources   → backend collection channels (web_scraper/rss/api/cli/opencli)
//   processors→ backend processors (openai/claude/local/external_http)
//   pipeline  → pipeline stages (schedule/manual trigger, store, notify)
//   primitives→ generic compute atoms (value/filter/map/branch/display/note)
import { COLLECTION_NODES } from './collection'
import { PIPELINE_NODES } from './pipeline'
import { PLAN_GRAPH_NODES } from './planGraph'
import { PRIMITIVE_NODES } from './primitives'
import { PROCESSOR_NODES } from './processors'
import { SOURCE_NODES } from './sources'
import type { NodeSpec } from '../spec'

export { SOURCE_NODES } from './sources'
export { PROCESSOR_NODES } from './processors'
export { PIPELINE_NODES } from './pipeline'
export { PRIMITIVE_NODES } from './primitives'
export { COLLECTION_NODES } from './collection'
export { PLAN_GRAPH_NODES } from './planGraph'

export const ALL_NODES: NodeSpec<any>[] = [
  ...SOURCE_NODES,
  ...PROCESSOR_NODES,
  ...PIPELINE_NODES,
  ...PRIMITIVE_NODES,
  ...COLLECTION_NODES,
  ...PLAN_GRAPH_NODES,
]
