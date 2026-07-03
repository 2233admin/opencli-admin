// Macro feature barrel. Public surface re-exported by node-kit/index.ts.
export type { MacroDef, MacroPort } from './macro'
export {
  buildMacroDef,
  deriveBoundaryPorts,
  makeMacroSpec,
  registerMacroSpec,
  getMacroDef,
  inlineMacro,
  flattenForRun,
} from './macro'
export { listMacros, saveMacro, getMacro, deleteMacro } from './store'

import { registerMacroSpec } from './macro'
import { listMacros } from './store'

/** Register every persisted macro's synthetic spec. Call at module load right
 *  after registerNodes(ALL_NODES) so the host's one-time useMemo([]) for
 *  nodeTypes/palette (NodeWorkbench.tsx:87-88) snapshots them. Idempotent. */
export function registerSavedMacros(): void {
  for (const def of listMacros()) registerMacroSpec(def)
}
