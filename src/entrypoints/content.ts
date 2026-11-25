import {
  type ContentConfig,
  type ContentMessage,
  callBackground,
  type FieldInfo,
  isContentMessage,
} from "@/background/api"
import { watchCodeImages } from "@/content/code-scan"
import { ContentConfiguration } from "@/content/content-config"
import { deepActiveElement, eventOrigin } from "@/content/deep-dom"
import {
  listenToExtension,
  notifyBackground,
} from "@/content/extension-messages"
import { FieldTracker } from "@/content/field-tracker"
import { FillHandlers } from "@/content/fill-handlers"
import { FieldIcons } from "@/content/icons"
import { InlineMenu, SavePrompt } from "@/content/overlays"
import { PasskeySteering } from "@/content/passkey-steering"
import { watchSubmissions } from "@/content/submit"
import { isDarkTheme } from "@/lib/theme"

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  runAt: "document_idle",
  async main(ctx) {
    const isTop = window === window.top
    const configuration = new ContentConfiguration(ctx, applyConfig)
    const colorScheme = () =>
      isDarkTheme(configuration.current.theme) ? "dark" : "light"
    const savePrompt = isTop ? new SavePrompt(ctx, colorScheme) : null

    const menu = new InlineMenu(
      ctx,
      colorScheme,
      () => {
        icons.setExpanded(null)
        notifyBackground("content.closeMenu", null)
      },
      (target) => icons.owns(target),
    )
    const icons = new FieldIcons(ctx, (field) => void openMenu(field))
    const fields = new FieldTracker(ctx, {
      isKeywardNode: (node) =>
        icons.owns(node) ||
        menu.owns(node) ||
        (savePrompt?.owns(node) ?? false),
      askCodes: () =>
        configuration.whileCurrent(
          callBackground("content.hasCodes", null).catch(() => false),
        ),
      onScan: (found) => {
        icons.update([...found.login, ...found.newPassword, ...found.code])
        steerPasskeys()
      },
    })
    const passkeys = new PasskeySteering(ctx, {
      // An open menu learned about the request when it opened, so it opens again to match.
      onWaitingChange: () => {
        const field = menu.openFor
        if (field && fields.isLogin(field)) {
          menu.close()
          void openMenu(field)
        }
      },
      onUsed: () => notifyBackground("content.passkeyUsed", null),
    })
    /** Keeps the page's passkey request for the menu while this frame shows the menu on login fields. */
    const steerPasskeys = () => {
      const { active, takeOverPasskeys } = configuration.current
      passkeys.steer(active && takeOverPasskeys && fields.login.length > 0)
    }

    let lastMenuField: HTMLInputElement | null = null
    const fills = new FillHandlers(menu, fields, () => lastMenuField)
    /**
     * Counts calls to open the menu. Only the latest may show it: the background keeps the token of
     * the latest session only, and showing an earlier one would move the focus back to a field
     * the user has left.
     */
    let menuOpenings = 0

    async function openMenu(field: HTMLInputElement): Promise<void> {
      const opening = ++menuOpenings
      if (menu.openFor === field) {
        menu.close()
        return
      }
      menu.close()
      lastMenuField = field
      const session = await callBackground("content.openMenu", {
        kind: fields.isCode(field) ? "code" : "login",
        newPassword: fields.isNewPassword(field),
        passkey: passkeys.waiting && fields.isLogin(field),
      }).catch(() => null)
      if (opening !== menuOpenings || !session) return
      // The page may have stopped offering logins while the session was requested.
      if (!configuration.current.active || !fields.has(field)) return
      icons.setExpanded(field)
      menu.show(field, session.token)
      // Keeps the keyboard path open: ArrowDown in the field moves into the menu.
      if (deepActiveElement() !== field) field.focus({ preventScroll: true })
    }

    function applyConfig(config: ContentConfig, previous: ContentConfig): void {
      icons.setLanguage(config.language)
      fields.forgetCodes()
      if (config.active === previous.active) {
        if (config.active) fields.scan()
        else steerPasskeys()
      } else if (config.active) {
        fields.start()
      } else {
        menu.close()
        fields.stop()
      }
    }

    listenToExtension(
      ctx,
      browser.runtime.onMessage,
      (
        message: unknown,
        _sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => {
        if (!isContentMessage(message)) return false
        sendResponse(handle(message) ?? null)
        return false
      },
    )

    function handle(message: ContentMessage): FieldInfo | boolean | undefined {
      switch (message.type) {
        case "fill":
          fills.fill(message)
          return
        case "fillCode":
          fills.fillCode(message)
          return
        case "fillNew":
          return fills.fillNew(message)
        case "usePasskey":
          passkeys.use()
          return
        case "menu.resize":
          menu.resize(message.height)
          return
        case "menu.close":
          menu.close()
          return
        case "prompt.show":
          savePrompt?.show(message.token)
          return
        case "prompt.resize":
          savePrompt?.resize(message.height)
          return
        case "prompt.close":
          savePrompt?.close()
          return
        case "fieldInfo": {
          const focused = deepActiveElement()
          return {
            hasField: fields.login.length > 0,
            focused:
              focused instanceof HTMLInputElement && fields.isLogin(focused),
          }
        }
      }
    }

    await configuration.load()
    if (isTop) notifyBackground("content.ready", null)

    // Only an empty field opens the menu on focus. A filled one, as after a fill when the focus
    // comes back from the menu's frame, opens it from its icon.
    ctx.addEventListener(document, "focusin", (event) => {
      const target = eventOrigin(event)
      const { active, menuTrigger } = configuration.current
      if (
        active &&
        menuTrigger === "focus" &&
        event.isTrusted &&
        !fills.filling &&
        target instanceof HTMLInputElement &&
        !target.value &&
        fields.has(target) &&
        menu.openFor !== target
      ) {
        void openMenu(target)
      }
    })

    watchCodeImages(
      ctx,
      () => configuration.current.active && configuration.current.scanCodes,
      (candidate) => callBackground("content.codeCandidate", candidate ?? {}),
    )

    watchSubmissions(
      ctx,
      () => configuration.current.active,
      (credentials) => notifyBackground("content.submitted", credentials),
    )
  },
})
