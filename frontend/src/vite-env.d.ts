/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_TOPOLOGY_LAB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
