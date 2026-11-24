import {
  type ContentConfig,
  type ContentMessage,
  callBackground,
  type FieldInfo,
  isContentMessage,
} from "@/background/api"
import {
  fillTargets,
  isPasswordField,
  loginFields,
  setFieldValue,
  submitFor,
} from "@/content/fields"
import { FieldIcons } from "@/content/icons"
import { InlineMenu, SavePrompt } from "@/content/overlays"
import { watchSubmissions } from "@/content/submit"
import { isDarkTheme } from "@/lib/theme"

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  runAt: "document_idle",
  async main(ctx) {
    const isTop = window === window.top
    let theme: ContentConfig["theme"] = "system"
    const scheme = () => (isDarkTheme(theme) ? "dark" : "light")
    const prompt = isTop ? new SavePrompt(ctx, scheme) : null
    let fields: HTMLInputElement[] = []
    let lastField: HTMLInputElement | null = null

    const menu = new InlineMenu(
      ctx,
      scheme,
      () => {
        icons.setExpanded(null)
        void callBackground("content.closeMenu", null).catch(() => {})
      },
      (target) => icons.owns(target),
    )
    const openMenu = async (field: HTMLInputElement) => {
      if (menu.openFor === field) {
        menu.close()
        return
      }
      menu.close()
      lastField = field
      const { token } = await callBackground("content.openMenu", null)
      icons.setExpanded(field)
      menu.show(field, token)
    }
    const icons = new FieldIcons(
      ctx,
      (field) => void openMenu(field).catch(() => {}),
    )

    browser.runtime.onMessage.addListener(
      (message: unknown, _sender, sendResponse) => {
        if (!isContentMessage(message)) return false
        sendResponse(handle(message) ?? null)
        return false
      },
    )

    function handle(message: ContentMessage): FieldInfo | undefined {
      switch (message.type) {
        case "fill":
          fill(message)
          return
        case "menu.resize":
          menu.resize(message.height)
          return
        case "menu.close":
          menu.close()
          return
        case "prompt.show":
          prompt?.show(message.token)
          return
        case "prompt.resize":
          prompt?.resize(message.height)
          return
        case "prompt.close":
          prompt?.close()
          return
        case "fieldInfo": {
          const focused = document.activeElement
          return {
            hasField: fields.length > 0,
            focused:
              focused instanceof HTMLInputElement && fields.includes(focused),
          }
        }
      }
    }

    function fill(message: Extract<ContentMessage, { type: "fill" }>): void {
      // The background checked the login against this origin; the frame may have navigated since.
      if (location.origin !== message.origin) return
      const focused = document.activeElement
      const anchor =
        menu.openFor ??
        (lastField?.isConnected ? lastField : null) ??
        (focused instanceof HTMLInputElement && fields.includes(focused)
          ? focused
          : null) ??
        fields.find(isPasswordField) ??
        fields[0]
      menu.close()
      if (!anchor) return
      const { username, password } = fillTargets(anchor)
      if (username && message.username)
        setFieldValue(username, message.username)
      if (password) setFieldValue(password, message.password)
      if (message.autoSubmit && (password ?? username))
        submitFor((password ?? username) as HTMLInputElement)
    }

    const config = await callBackground("content.init", null).catch(() => null)
    if (isTop) void callBackground("content.ready", null).catch(() => {})
    if (config) theme = config.theme
    if (!config?.active) return

    const scan = () => {
      fields = loginFields(document)
      icons.update(fields)
    }
    let pending = 0
    const observer = new MutationObserver(() => {
      if (pending) return
      pending = window.setTimeout(() => {
        pending = 0
        scan()
      }, 300)
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "style", "class", "hidden", "disabled"],
    })
    ctx.onInvalidated(() => observer.disconnect())
    scan()

    if (config.menuTrigger === "focus") {
      ctx.addEventListener(document, "focusin", (event) => {
        const target = event.target
        if (
          event.isTrusted &&
          target instanceof HTMLInputElement &&
          fields.includes(target) &&
          menu.openFor !== target
        ) {
          void openMenu(target).catch(() => {})
        }
      })
    }

    watchSubmissions(ctx, (credentials) => {
      void callBackground("content.submitted", credentials).catch(() => {})
    })
  },
})
