# Version and publish Operations Agents

Operations Agent behavior is edited as a Draft and published as an immutable version, while Agent Permission Profiles remain a separate authorization surface. Runs bind to one published version for their full lifetime; Agents with automatic permissions require Admin approval for behavior releases, preventing an innocuous approved configuration from being changed underneath an existing grant.
