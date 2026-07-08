import type { WorkflowPrimitive, WorkflowPrimitiveCategory } from "./node-primitives"

export const PRIMITIVE_MENU_ORDER: WorkflowPrimitiveCategory[] = [
  "input",
  "transform",
  "ai",
  "logic",
  "state",
  "output",
  "verify",
  "business",
  "ops",
  "core",
  "map",
]

export const PRIMITIVE_MENU_LABELS: Record<WorkflowPrimitiveCategory, string> = {
  input: "Input",
  transform: "Transform",
  ai: "AI",
  logic: "Logic",
  state: "State",
  output: "Output",
  verify: "Verify",
  business: "Business",
  ops: "Ops",
  core: "Core",
  map: "Map",
}

export type PrimitiveMenuGroup = {
  category: WorkflowPrimitiveCategory
  label: string
  items: WorkflowPrimitive[]
}

export function groupPrimitivesForNodeMenu(primitives: WorkflowPrimitive[]): PrimitiveMenuGroup[] {
  return PRIMITIVE_MENU_ORDER.map((category) => ({
    category,
    label: PRIMITIVE_MENU_LABELS[category],
    items: primitives.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0)
}
