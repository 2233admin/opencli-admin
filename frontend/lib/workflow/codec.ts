import { parseWorkflowProject, type WorkflowProject } from "./schema"
import { parse as parseYaml } from "yaml"
import { translateDifyWorkflowToWorkflowProject, type DifyTranslationReport } from "./dify-translator"
import { translateN8nWorkflowToWorkflowProject, type N8nTranslationReport } from "./n8n-translator"

/**
 * DSL translation boundary.
 * Translators end here; compiler, scheduler and workers only receive WorkflowProject.
 */
export type WorkflowDslFormat = "canonical" | "dify" | "n8n"
export type WorkflowTranslationReport = DifyTranslationReport | N8nTranslationReport

export type WorkflowImportResult =
  | { ok: true; project: WorkflowProject; format: WorkflowDslFormat; report?: WorkflowTranslationReport }
  | { ok: false; error: string }

export function translateWorkflowDsl(json: string): WorkflowImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    try {
      parsed = parseYaml(json)
    } catch (error) {
      return { ok: false, error: `Invalid workflow DSL: ${error instanceof Error ? error.message : "Unknown error"}` }
    }
  }

  try {
    return { ok: true, project: parseWorkflowProject(parsed), format: "canonical" }
  } catch (error) {
    const dify = translateDifyWorkflowToWorkflowProject(parsed)
    if (dify.ok) {
      return {
        ok: true,
        project: dify.project,
        format: "dify",
        report: dify.report,
      }
    }
    const translated = translateN8nWorkflowToWorkflowProject(parsed)
    if (translated.ok) {
      return {
        ok: true,
        project: translated.project,
        format: "n8n",
        report: translated.report,
      }
    }
    return { ok: false, error: `Invalid workflow DSL: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

/** Backward-compatible name for existing canvas import callers. */
export const importWorkflowProjectFromJson = translateWorkflowDsl

export function exportWorkflowProjectToJson(project: WorkflowProject): string {
  return `${JSON.stringify(parseWorkflowProject(project), null, 2)}\n`
}
