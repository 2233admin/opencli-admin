# Use freshness-bounded Query Requests over the Workflow engine

Agents and applications query the platform through a freshness-bounded Query Request. The platform returns eligible existing data when it is fresh enough and otherwise invokes an authorized existing Workflow for on-demand collection and processing, optionally streaming partial results while publishing them to a Data Feed. This is a query and scheduling surface over the one Workflow engine, not a separate answer engine, and missing evidence is reported rather than filled from model memory.
