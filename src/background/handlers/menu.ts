import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import type { Handlers } from "@/lib/messaging"
import { passwordLimitsFor } from "@/lib/password-rules"
import { VaultError } from "@/lib/providers/types"
import { siteDomainOf } from "@/lib/site"
import type { BackgroundApi } from "../api"
import { fillCode, fillLogin, fillNewPassword } from "../autofill"
import { menuSessions } from "../overlays"
import { frameUrl, sendToFrame } from "../page"
import { openPopup } from "../popup-window"
import type { Providers } from "../providers"
import { recallGenerated, rememberGenerated } from "../recent-generated"
import { markRecent, recallUsername } from "../recent-usernames"
import { namedVault } from "./capabilities"
import { closeMenu } from "./request-context"
import { requireFiniteNumber, requireText } from "./validation"

export function menuHandlers(providers: Providers) {
  return {
    "menu.state": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        const page = await frameUrl(session.tabId, session.frameId)
        if (!page)
          throw new VaultError("The frame is not a web page", "notWebPage")
        const kind = session.kind ?? "login"
        const top =
          session.frameId !== 0 ? await frameUrl(session.tabId, 0) : null
        const embeddedInHost =
          top && siteDomainOf(top.hostname) !== siteDomainOf(page.hostname)
            ? page.hostname
            : undefined
        // The account this tab used on the site moments ago comes first: the password step of a
        // two-step login, or the code step after a password.
        const recent = await recallUsername(
          session.tabId,
          siteDomainOf(page.hostname),
        )
        if (kind === "login") {
          let suggestion = session.suggestion
          if (session.newPassword && !suggestion) {
            const site = siteDomainOf(page.hostname)
            const cached = await recallGenerated(session.tabId, site)
            suggestion =
              cached?.password ??
              generatePassword(
                await getGeneratorOptions(),
                passwordLimitsFor(page.hostname, session.fieldRules ?? null),
              )
            if (!cached)
              await rememberGenerated(
                session.tabId,
                site,
                page,
                suggestion,
                false,
              )
            await menuSessions.set({ ...session, suggestion })
          }
          return {
            host: page.hostname,
            kind,
            vaults: markRecent(await providers.loginsForPage(page), recent),
            ...(suggestion ? { suggestion } : {}),
            ...(session.passkey ? { passkey: true } : {}),
            ...(embeddedInHost ? { embeddedInHost } : {}),
          }
        }
        const vaults = await providers.codeLoginsForPage(page, {
          tabId: session.tabId,
          frameId: session.frameId,
        })
        return {
          host: page.hostname,
          kind,
          vaults: markRecent(vaults, recent),
          ...(embeddedInHost ? { embeddedInHost } : {}),
        }
      },
    },
    "menu.fill": {
      allow: ["menu"],
      handle: async ({ token, vaultId, loginId, confirmInsecure }, sender) => {
        const session = await menuSessions.claim(sender, token)
        if (session.kind === "code") {
          await fillCode(
            providers,
            session.tabId,
            session.frameId,
            requireText(vaultId, "vaultId"),
            requireText(loginId, "loginId"),
          )
        } else {
          await fillLogin(
            providers,
            session.tabId,
            session.frameId,
            requireText(vaultId, "vaultId"),
            requireText(loginId, "loginId"),
            { allowInsecureHttp: confirmInsecure === true },
          )
        }
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.fillSuggestion": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        if (!session.suggestion)
          throw new VaultError("No password is offered", "invalidInput")
        await fillNewPassword(
          session.tabId,
          session.frameId,
          session.suggestion,
        )
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.regenerateSuggestion": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        if (!session.newPassword)
          throw new VaultError("No password is offered", "invalidInput")
        const page = await frameUrl(session.tabId, session.frameId)
        if (!page)
          throw new VaultError("The frame is not a web page", "notWebPage")
        const suggestion = generatePassword(
          await getGeneratorOptions(),
          passwordLimitsFor(page.hostname, session.fieldRules ?? null),
        )
        await rememberGenerated(
          session.tabId,
          siteDomainOf(page.hostname),
          page,
          suggestion,
          false,
        )
        await menuSessions.set({ ...session, suggestion })
        return { suggestion }
      },
    },
    "menu.usePasskey": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        if (!session.passkey)
          throw new VaultError("No passkey sign-in is offered", "invalidInput")
        await sendToFrame(session.tabId, session.frameId, {
          type: "usePasskey",
        })
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.resize": {
      allow: ["menu"],
      handle: async ({ token, height }, sender) => {
        const session = await menuSessions.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "menu.resize",
          height: requireFiniteNumber(height, "height"),
        })
        return null
      },
    },
    "menu.close": {
      allow: ["menu"],
      handle: async ({ token, focusField }, sender) => {
        await closeMenu(
          (await menuSessions.claim(sender, token)).tabId,
          focusField === true,
        )
        return null
      },
    },
    "menu.focusField": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "menu.focusField",
        }).catch(() => {})
        return null
      },
    },
    "menu.connect": {
      allow: ["menu"],
      handle: async ({ token, vaultId }, sender) => {
        const session = await menuSessions.claim(sender, token)
        const vault = namedVault(providers, vaultId)
        await closeMenu(session.tabId)
        await openPopup({
          name: "connect",
          kind: vault.provider.kind,
          vaultId: vault.vaultId,
        })
        return null
      },
    },
    "menu.newLogin": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menuSessions.claim(sender, token)
        await closeMenu(session.tabId)
        await openPopup({ name: "add" })
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}
