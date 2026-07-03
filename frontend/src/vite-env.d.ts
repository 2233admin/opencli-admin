/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TOPOLOGY_LAB?: string
  readonly VITE_API_AUTH_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
