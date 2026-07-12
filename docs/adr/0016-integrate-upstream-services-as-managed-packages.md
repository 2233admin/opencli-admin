# Integrate upstream services as managed packages

External systems such as SearXNG are delivered as versioned Managed Integrations: the platform can deploy and operate the upstream service and expose its capabilities as nodes, but does not copy or fork its implementation into the core. This preserves a single-install user experience while allowing upstream upgrades and independent adapter compatibility testing.
