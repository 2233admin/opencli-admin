// elkjs ships no .d.ts for the browser bundle (package "types" points at a
// non-existent lib/main.d.ts). Declare the slice of the API we use so the
// deep import type-checks under strict mode.
declare module 'elkjs/lib/elk.bundled.js' {
  export interface ElkExtendedEdge {
    id: string
    sources: string[]
    targets: string[]
    sections?: unknown[]
  }
  export interface ElkNode {
    id: string
    x?: number
    y?: number
    width?: number
    height?: number
    children?: ElkNode[]
    edges?: ElkExtendedEdge[]
    layoutOptions?: Record<string, string>
  }
  export interface ElkLayoutArguments {
    layoutOptions?: Record<string, string>
  }
  export default class ELK {
    constructor(options?: {
      defaultLayoutOptions?: Record<string, string>
      workerUrl?: string
      workerFactory?: (url: string) => Worker
    })
    layout(graph: ElkNode, args?: ElkLayoutArguments): Promise<ElkNode>
  }
}
