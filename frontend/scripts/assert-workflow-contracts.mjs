import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  isUserFacingRuntimeParam,
  projectedCatalogRuntimeCapability,
  runtimeContractForCapability,
} from "../lib/workflow/capabilities.ts"

const capability = {
  id: "intelligence.source.opencli-slot",
  label: "OpenCLI Source Slot",
  surface: "catalog",
  status: "runnable",
  backendAvailable: true,
  missing: [],
  tags: [],
  manifest: {
    contract: {
      schemaVersion: 1,
      bindingId: "iii.collector-opencli.snapshot",
      status: "dispatch_only",
      inputShape: { ports: [{ name: "in", type: "trigger" }], params: ["site", "command", "profileId"] },
      outputShape: { ports: [{ name: "out", type: "items[]" }], artifacts: ["batch_ready"] },
      permissionGate: { required: ["canFetchNetwork"] },
      configGate: { required: ["opencli_channel"] },
      eventShape: { events: ["batch_ready", "completed"] },
      fixtureCoverage: { cases: ["happy-path"] },
      certification: { realNodeIoContract: true, realWebhookDelivery: false },
      canvas: { exposeResourceInternals: false },
    },
  },
}

const contract = runtimeContractForCapability(capability)
assert.equal(contract?.bindingId, "iii.collector-opencli.snapshot")
assert.deepEqual(contract?.outputShape.ports, [{ name: "out", type: "items[]" }])
assert.deepEqual(contract?.eventShape.events, ["batch_ready", "completed"])

const unsupported = projectedCatalogRuntimeCapability(
  undefined,
  { id: "canvas.placeholder", label: "Placeholder", kind: "schedule", capability: "trigger" },
  true,
)
assert.equal(unsupported?.status, "design_only")
assert.equal(projectedCatalogRuntimeCapability(undefined, { id: "loading", label: "Loading" }, false), undefined)

assert.equal(isUserFacingRuntimeParam("interval"), true)
for (const hidden of ["cookieJar", "profileId", "sessionPolicy", "workerTags", "command"]) {
  assert.equal(isUserFacingRuntimeParam(hidden), false, `${hidden} must not become a user input`)
}

const root = fileURLToPath(new URL("..", import.meta.url))
const contractsSource = readFileSync(`${root}/lib/workflow/node-contracts.ts`, "utf8")
const templatesSource = readFileSync(`${root}/lib/workflow/node-templates.ts`, "utf8")
assert.doesNotMatch(contractsSource, /node\.kind === "schedule" && node\.capability === "trigger"/)
assert.doesNotMatch(templatesSource, /node\.kind === "schedule" && node\.capability === "trigger"/)

console.log("workflow contract assertions passed")
