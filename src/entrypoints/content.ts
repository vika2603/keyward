import {
  type ContentConfig,
  type ContentMessage,
  callBackground,
  type FieldInfo,
  isContentMessage,
} from "@/background/api"
import {
  deepActiveElement,
  eventOrigin,
  fillTargets,
  isPasswordField,
  loginFields,
  setFieldValue,
  submitFor,
} from "@/content/fields"
import { FieldIcons } from "@/content/icons"
import { InlineMenu, SavePrompt } from "@/content/overlays"
import { watchSubmissions } from "@/content/submit"
import { ACCOUNTS_KEY } from "@/lib/backends/bitwarden/account-store"
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
    /** Set while a fill moves the focus between fields, which must not reopen the menu. */
    let filling = false
    /**
     * Removes an extension event listener when a newer copy of this script takes over. After the
     * extension reloads, its APIs throw and its events stop, so there is nothing to remove.
     */
    const onInvalidatedRemove = (remove: () => void) =>
      ctx.onInvalidated(() => {
        if (browser.runtime?.id) remove()
      })

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
      // The page may have stopped offering logins while the session was requested.
      if (!active || !fields.includes(field)) return
      icons.setExpanded(field)
      menu.show(field, token)
      // Keeps the keyboard path open: ArrowDown in the field moves into the menu.
      if (deepActiveElement() !== field) field.focus({ preventScroll: true })
    }
    const icons = new FieldIcons(
      ctx,
      (field) => void openMenu(field).catch(() => {}),
    )

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (!isContentMessage(message)) return false
      sendResponse(handle(message) ?? null)
      return false
    }
    browser.runtime.onMessage.addListener(onMessage)
    onInvalidatedRemove(() =>
      browser.runtime.onMessage.removeListener(onMessage),
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
          const focused = deepActiveElement()
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
      const focused = deepActiveElement()
      const anchor =
        menu.openFor ??
        (focused instanceof HTMLInputElement && fields.includes(focused)
          ? focused
          : null) ??
        (lastField?.isConnected ? lastField : null) ??
        fields.find(isPasswordField) ??
        fields[0]
      menu.close()
      if (!anchor) return
      const { username, password } = fillTargets(anchor)
      filling = true
      try {
        if (username && message.username)
          setFieldValue(username, message.username)
        if (password) setFieldValue(password, message.password)
      } finally {
        filling = false
      }
      if (message.autoSubmit && (password ?? username))
        submitFor((password ?? username) as HTMLInputElement)
    }

    let active = false
    let menuTrigger: ContentConfig["menuTrigger"] = "click"
    let observer: MutationObserver | null = null
    let rescan = 0
    let pending = 0

    const scan = () => {
      fields = loginFields(document)
      icons.update(fields)
    }
    const start = () => {
      observer = new MutationObserver(() => {
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
      // Changes inside shadow roots do not reach the observer above; a slow rescan picks them up.
      rescan = ctx.setInterval(scan, 2000)
      scan()
    }
    const stop = () => {
      observer?.disconnect()
      observer = null
      clearInterval(rescan)
      clearTimeout(pending)
      pending = 0
      menu.close()
      fields = []
      icons.update([])
    }
    ctx.onInvalidated(() => {
      observer?.disconnect()
      clearTimeout(pending)
    })

    let requested = 0
    /** Applies this frame's configuration, which follows the settings and the connected backends. */
    const configure = async () => {
      const request = ++requested
      const config = await callBackground("content.init", null).catch(
        () => null,
      )
      if (!config || request !== requested || ctx.isInvalid) return
      theme = config.theme
      icons.setLanguage(config.language)
      menuTrigger = config.menuTrigger
      if (config.active === active) return
      active = config.active
      if (active) start()
      else stop()
    }
    const onStorage = (
      changes: Record<string, Browser.storage.StorageChange>,
    ) => {
      if (changes.settings || changes[ACCOUNTS_KEY]) void configure()
    }
    browser.storage.local.onChanged.addListener(onStorage)
    onInvalidatedRemove(() =>
      browser.storage.local.onChanged.removeListener(onStorage),
    )
    await configure()
    if (isTop) void callBackground("content.ready", null).catch(() => {})

    ctx.addEventListener(document, "focusin", (event) => {
      const target = eventOrigin(event)
      if (
        active &&
        menuTrigger === "focus" &&
        event.isTrusted &&
        !filling &&
        target instanceof HTMLInputElement &&
        fields.includes(target) &&
        menu.openFor !== target
      ) {
        void openMenu(target).catch(() => {})
      }
    })

    watchSubmissions(
      ctx,
      () => active,
      (credentials) =>
        void callBackground("content.submitted", credentials).catch(() => {}),
    )
  },
})
