# Encapsulate Node internals behind promoted parameters

Packaged Nodes expose a stable set of important parameters while keeping their internal steps observable through canvas drill-down. Users configure and test the Node without understanding its implementation; explicitly changing internals creates a separate user definition rather than mutating the installed official Node.
