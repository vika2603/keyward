import { storage } from "wxt/utils/storage"
import type { CustomEndpoints } from "@/lib/providers/bitwarden/server"

/** The server of the last sign-in, offered again for the next account; empty for bitwarden.com. */
export const lastServerItem = storage.defineItem<string>(
  "local:bitwarden.lastServer",
  { fallback: "" },
)

/** The self-hosted server last set up, kept when a later sign-in uses a cloud region. */
export const selfHostedServerItem = storage.defineItem<string>(
  "local:bitwarden.selfHostedServer",
  { fallback: "" },
)

/** The separate endpoints of the self-hosted server last set up. */
export const selfHostedEndpointsItem = storage.defineItem<CustomEndpoints>(
  "local:bitwarden.selfHostedEndpoints",
  { fallback: {} },
)
