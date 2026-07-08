import { parseWorkflowProject, type WorkflowProject } from "./schema"
import { translateN8nWorkflowToWorkflowProject, type N8nTranslationReport } from "./n8n-translator"

export type WorkflowImportResult =
  | { ok: true; project: WorkflowProject; format: "canonical" | "n8n"; report?: N8nTranslationReport }
  | { ok: false; error: string }

export function importWorkflowProjectFromJson(json: string): WorkflowImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { ok: false, error: `Invalid workflow JSON: ${error instanceof Error ? error.message : "Unknown error"}` }
  }

  try {
    return { ok: true, project: parseWorkflowProject(parsed), format: "canonical" }
  } catch (error) {
    const translated = translateN8nWorkflowToWorkflowProject(parsed)
    if (translated.ok) {
      return {
        ok: true,
        project: translated.project,
        format: "n8n",
        report: translated.report,
      }
    }
    return { ok: false, error: `Invalid workflow JSON: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

export function exportWorkflowProjectToJson(project: WorkflowProject): string {
  return `${JSON.stringify(parseWorkflowProject(project), null, 2)}\n`
}
