# Managed OpenCLI platform acceptance — 2026-07-14

## Capability truth

- Published and dispatchable: `official-site.observe@1.0.0`, output schema `1`.
- Not published: `chat-ai.capture@1`. The pinned OhMyOpenCLI checkout has AI
  assistant `session-probe` commands, but no `chat-ai` adapter, `capture`
  command, versioned output contract, or matching tests. Admin therefore fails
  closed instead of inventing this capability.

## Windows native result

The cross-platform verifier passed both the installed-runtime contract and a
live clean-profile trace run using Chrome CDP on `127.0.0.1:9333`:

- runtime commit: `73cc60c83586ef2c95469b3b70d6cfc80fa5bc53`
- capability source: `73cc60c83586ef2c95469b3b70d6cfc80fa5bc53`
- OpenCLI: `1.8.5`
- envelope: `official-site.observe@1.0.0`, schema `1`
- URL: `https://example.com/`
- access: `accessible`
- personalization detected: `false`
- DOM length: `544`
- DOM SHA-256: `31cbda82ae6aaca6662eb6555637185cc8c40a4e6ec197f5f1ef73d9d7a20b24`
- trace artifact was emitted and existed on disk

## GEO → Admin → OhMyOpenCLI large-page acceptance

The final pinned runtime was exercised through GEO's
`ManagedOfficialSiteBrandScopeResolver`, the Admin HTTP API, OhMyOpenCLI, and a
new anonymous Chrome profile. The ignored live contract test requires the
resulting immutable Snapshot DOM to exceed 256 KiB and passed against the
public `https://github.com/rust-lang/rust` page:

- execution: `be155a3c-face-46b8-8bbd-df19a6835831`
- status/access: `succeeded` / `accessible`
- personalization detected: `false`
- browser profile kind: `anonymous`
- DOM length: `431419` bytes
- DOM SHA-256: `bb8f6012991190dc98a9ae77f39724c63be478847daa20b42876ae181e8ddf73`
- body-text length: `3222`
- runtime/source commit: `73cc60c83586ef2c95469b3b70d6cfc80fa5bc53`
- OpenCLI: `1.8.5`
- retained trace: `20260714012946-6888fe10`

This is a real acquisition result, not the earlier large-DOM unit fixture. An
initial anonymous request to a non-public repository also produced a DOM over
256 KiB but was correctly rejected by GEO as a login wall.

Re-run from the Admin checkout:

```powershell
.\.venv\Scripts\python.exe scripts\verify_managed_opencli_runtime.py `
  --ohmyopencli-root C:\c\Users\Administrator\projects\OhMyOpenCLI `
  --opencli-bin C:\c\Users\Administrator\projects\OhMyOpenCLI\node_modules\.bin\opencli.cmd `
  --cdp-endpoint http://127.0.0.1:9333 `
  --url https://example.com
```

## Windows Docker and Linux Docker command

Both Linux images package the same verifier at
`/app/scripts/verify_managed_opencli_runtime.py`. Docker Desktop on Windows and
Docker Engine on Linux use the same command; only the CDP endpoint changes:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  --entrypoint python \
  opencli-admin-agent:<tag> \
  /app/scripts/verify_managed_opencli_runtime.py \
    --ohmyopencli-root /opt/ohmyopencli \
    --cdp-endpoint http://host.docker.internal:9333 \
    --url https://example.com
```

Docker execution was not claimed as passed on this host: `docker info` timed
out because the daemon was unavailable. Static image contract tests verify
that the pinned checkout, final-user plugin bootstrap, explicit repository
override, patched OpenCLI, and verifier are present in both Dockerfiles.

## Default source availability

The repository owner published the fixed commits during verification. A fresh,
cache-independent clone from the installer default
`https://github.com/2233admin/OhMyOpenCLI.git` succeeded, its public
`refs/heads/master` resolved to
`73cc60c83586ef2c95469b3b70d6cfc80fa5bc53`, detached checkout of that commit
succeeded, and the capability source
`73cc60c83586ef2c95469b3b70d6cfc80fa5bc53` passed the ancestry check.

The native and Docker installers retain an explicit repository override so a
deployment can use a separately audited mirror without changing the pinned
identity. No push was performed by this work.
