import { parseWorkflowProject, type WorkflowProject } from "./schema"
import { parse as parseYaml } from "yaml"
import { translateDifyWorkflowToWorkflowProject, type DifyTranslationReport } from "./dify-translator"
import { translateN8nWorkflowToWorkflowProject, type N8nTranslationReport } from "./n8n-translator"
import { importDifyWorkflow } from "./backend-dify-import"

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

/**
 * Managed import boundary used by interactive callers.
 * Dify execution readiness is authoritative only after backend Graphon inspection.
 */
export async function translateWorkflowDslManaged(source: string): Promise<WorkflowImportResult> {
  const local = translateWorkflowDsl(source)
  if (!local.ok || local.format !== "dify") return local
  if (!local.report || local.report.source !== "dify") {
    return { ok: false, error: "Dify import did not produce a compatibility report" }
  }

  try {
    const managed = await importDifyWorkflow(source)
    return {
      ok: true,
      project: managed.project,
      format: "dify",
      report: managed.report,
    }
  } catch (error) {
    return {
      ...local,
      report: {
        ...local.report,
        executable: false,
        runtimeSource: "browser-fallback",
        backendError: error instanceof Error ? error.message : "Dify backend inspection failed",
      },
    }
  }
}

/** Backward-compatible name for existing canvas import callers. */
export const importWorkflowProjectFromJson = translateWorkflowDsl

export function exportWorkflowProjectToJson(project: WorkflowProject): string {
  return `${JSON.stringify(parseWorkflowProject(project), null, 2)}\n`
}
