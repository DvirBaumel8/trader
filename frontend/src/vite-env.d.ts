/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The backend's origin in production (e.g. https://trader-backend.onrender.com),
   * baked in at build time by the Cloudflare Pages workflow. Empty locally,
   * where the frontend and backend are the same origin via Vite's dev proxy.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
