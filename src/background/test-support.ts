import { vi } from "vitest"
import type {
  Credential,
  ExistingLogin,
  LoginSummary,
  PasswordBackend,
  SourceInfo,
} from "@/lib/backends/types"
import type { Backends } from "./backends"

/** URLs of frames, keyed by "tabId:frameId", which the mocked `frameUrl` reads. */
export const frames = new Map<string, string>()

export function setFrame(tabId: number, frameId: number, url: string): void {
  frames.set(`${tabId}:${frameId}`, url)
}

/** A stand-in for the `./page` module; tests pass it to `vi.mock`. */
export const pageModule = {
  frameUrl: vi.fn(async (tabId: number, frameId: number) => {
    const url = frames.get(`${tabId}:${frameId}`)
    return url ? new URL(url) : null
  }),
  sendToFrame: vi.fn(
    async (_tabId: number, _frameId: number, _message: unknown) =>
      undefined as unknown,
  ),
  activeTab: vi.fn(),
  webPage: (url: string | undefined) => (url ? new URL(url) : null),
}

export interface FakeSource {
  info: SourceInfo
  existing?: ExistingLogin | null
  credential?: Credential
  /** Logins listed for any page while the source is ready. */
  logins?: LoginSummary[]
  /** Whether the source stores logins for any address; true when left out. */
  canSave?: boolean
}

/** Backends with fixed sources; each source answers from its fake and records saves. */
export function fakeBackends(sources: FakeSource[]) {
  const calls = {
    save: vi.fn(),
    update: vi.fn(),
    credential: vi.fn(),
  }
  const backendFor = (source: FakeSource): PasswordBackend => ({
    kind: source.info.kind,
    sources: async () => [source.info],
    logins: async () => [],
    credential: async (...args) => {
      calls.credential(...args)
      if (!source.credential) throw new Error("no credential")
      return source.credential
    },
    canSave: () => source.canSave ?? true,
    save: async (...args) => {
      calls.save(...args)
    },
    update: async (...args) => {
      calls.update(...args)
    },
    findExisting: async () => source.existing ?? null,
    lockAll: async () => {},
  })
  const byId = new Map(sources.map((s) => [s.info.id, backendFor(s)]))
  const backends = {
    sourcesForPage: async () => sources.map((s) => s.info),
    loginsForPage: async () =>
      sources.map((s) => ({
        ...s.info,
        logins: s.info.status === "ready" ? (s.logins ?? []) : [],
      })),
    sources: async () => sources.map((s) => s.info),
    source: async (id: string) => {
      const found = sources.find((s) => s.info.id === id)
      if (!found) throw new Error("unknown source")
      return found.info
    },
    backendOf: (id: string) => {
      const backend = byId.get(id)
      if (!backend) throw new Error("unknown source")
      return backend
    },
  } as unknown as Backends
  return { backends, calls }
}

export const appleSource: SourceInfo = {
  id: "apple",
  kind: "apple",
  label: "Apple 密码",
  status: "ready",
}

export const accountSource: SourceInfo = {
  id: "bitwarden:a",
  kind: "bitwarden",
  label: "someone@example.com",
  status: "ready",
}
