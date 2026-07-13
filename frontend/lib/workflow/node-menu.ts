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
  input: "输入",
  transform: "数据处理",
  ai: "AI",
  logic: "逻辑",
  state: "状态",
  output: "输出",
  verify: "验证",
  business: "业务",
  ops: "运维",
  core: "核心",
  map: "知识映射",
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
