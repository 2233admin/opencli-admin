# Publish once and let consumers subscribe independently

A producing Workflow publishes processed records once to a persistent Data Feed. Web applications, quantitative systems, messaging connectors, databases, training exports, and Agents consume that Feed through independent Data Subscriptions with separate filters, cursors, retries, and delivery state. Adding or repairing a consumer does not change the producing Workflow or repeat collection and processing.
