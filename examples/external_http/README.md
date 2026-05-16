# external_http processor — example

The `external_http` processor POSTs each record to an HTTP endpoint and
stores the JSON response as the record's enrichment. Any agent runtime
that can serve HTTP works: KohakuTerrarium creatures, dify flows,
langflow agents, n8n webhooks, or a 30-line FastAPI script like
`stub.py` here.

## Files

- `stub.py` — minimal FastAPI server demonstrating the contract.
- `smoke.py` — drives `ExternalProcessor` against the live stub and
  asserts the round-trip.

## Contract

### Request (one POST per record)

```json
{
  "prompt": "<prompt_template with {{placeholders}} resolved>",
  "record": { ... record.normalized_data ... },
  "agent_id": "<config.agent_id, if set>"
}
```

- `record` is omitted when the agent's config sets `send_record: false`.
- `agent_id` is omitted when `config.agent_id` is not set.

### Response

Any JSON dict; opencli-admin stores it verbatim as the enrichment. A
non-dict JSON value is wrapped as `{"analysis": <value>}`. Non-2xx or
non-JSON bodies become `{"error": "<reason>"}` for that record without
aborting the batch.

## Agent config

In an opencli-admin AI Agent, set:

```yaml
processor_type: external_http
config:
  endpoint: http://127.0.0.1:8088/process   # required
  timeout: 60                                # optional, seconds
  auth_header: "Bearer <token>"              # optional
  headers: { x-trace: "1" }                  # optional, extra headers
  agent_id: tagger-news                      # optional
  send_record: true                          # optional, default true
prompt_template: "Tag: {{title}}\n\n{{content}}"
```

## Run the smoke

```bash
uv sync --extra dev
uv run python examples/external_http/smoke.py
```

Expected output:

```
stub listening on 127.0.0.1:8088
  [0] tags=['smoke-test', 'agent:smoke-tagger'] summary='Stub processed: Hello World' prompt_chars=...
  [1] tags=['smoke-test', 'agent:smoke-tagger'] summary='Stub processed: Second item' prompt_chars=...
smoke OK
```
