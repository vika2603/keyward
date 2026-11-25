import { storage } from "wxt/utils/storage"

/** The server of the last sign-in, offered again for the next account; empty for the official service. */
export const lastServerItem = storage.defineItem<string>(
  "local:bitwarden.lastServer",
  { fallback: "" },
)

/** The self-hosted server last signed in to, kept when a later sign-in uses the official service. */
export const selfHostedServerItem = storage.defineItem<string>(
  "local:bitwarden.selfHostedServer",
  { fallback: "" },
)
