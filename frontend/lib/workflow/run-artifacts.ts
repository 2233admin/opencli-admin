import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createDefaultAdapterRegistry, type AdapterRegistry } from "./adapter-registry"
import type { WorkflowCompiledPlanPreview } from "./backend-compile"
import { summarizeWorkflowRun } from "./run-summary"
import { parseWorkflowProject, type WorkflowProject } from "./schema"
import { simulateWorkflowRun, type WorkflowSimulationRun } from "./simulation"
import { verifyWorkflowRun, type WorkflowVerificationReport } from "./verification"

export type WorkflowRunArtifact = {
  schemaVersion: 1
  runId: string
  generatedAt: string
  artifactPath: string
  project: {
    id: string
    name: string
    profile: WorkflowProject["profile"]
    version: number
  }
  run: WorkflowSimulationRun
  summary: ReturnType<typeof summarizeWorkflowRun>
  verification: WorkflowVerificationReport
  backendCompile?: WorkflowCompiledPlanPreview
}

export type CreateWorkflowRunArtifactOptions = {
  now?: Date
  registry?: AdapterRegistry
  runId?: string
  backendCompile?: WorkflowCompiledPlanPreview
}

export const RUN_ARTIFACT_DIR = path.join(
  "C:",
  "Users",
  "Administrator",
  ".gstack",
  "projects",
  "react-flow-powerpack-lovable-fix",
  "runs",
)

export async function createWorkflowRunArtifact(
  input: unknown,
  options: CreateWorkflowRunArtifactOptions = {},
): Promise<WorkflowRunArtifact> {
  const project = parseWorkflowProject(input)
  const registry = options.registry ?? createDefaultAdapterRegistry()
  const run = await simulateWorkflowRun(project, registry)
  const generatedAt = (options.now ?? new Date()).toISOString()
  const runId = options.runId ?? `${run.runId}-${formatRunStamp(generatedAt)}`
  const artifactPath = artifactPathForRun(runId)
  const artifact: WorkflowRunArtifact = {
    schemaVersion: 1,
    runId,
    generatedAt,
    artifactPath,
    project: {
      id: project.id,
      name: project.name,
      profile: project.profile,
      version: project.version,
    },
    run: { ...run, runId },
    summary: summarizeWorkflowRun({ ...run, runId }),
    verification: verifyWorkflowRun(project, { ...run, runId }),
    backendCompile: options.backendCompile,
  }

  await mkdir(RUN_ARTIFACT_DIR, { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
  return artifact
}

export async function readWorkflowRunArtifact(runId: string): Promise<WorkflowRunArtifact | null> {
  if (!isSafeRunId(runId)) return null
  try {
    const raw = await readFile(artifactPathForRun(runId), "utf8")
    return JSON.parse(raw) as WorkflowRunArtifact
  } catch {
    return null
  }
}

export async function readLatestWorkflowRunArtifact(): Promise<WorkflowRunArtifact | null> {
  try {
    const entries = await readdir(RUN_ARTIFACT_DIR, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
    const latest = files.at(-1)
    if (!latest) return null
    return readWorkflowRunArtifact(latest.replace(/\.json$/, ""))
  } catch {
    return null
  }
}

function artifactPathForRun(runId: string): string {
  return path.join(RUN_ARTIFACT_DIR, `${runId}.json`)
}

function isSafeRunId(runId: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(runId)
}

function formatRunStamp(value: string): string {
  return value.replace(/\D/g, "").slice(0, 14)
}
