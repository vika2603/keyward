import {
  type ContentConfig,
  type ContentMessage,
  callBackground,
  type FieldInfo,
  isContentMessage,
  SOURCES_CHANGED_KEY,
} from "@/background/api"
import { watchCodeImages } from "@/content/code-scan"
import {
  codeFields,
  deepActiveElement,
  eventOrigin,
  fillCodeField,
  fillTargets,
  isPasswordField,
  loginFields,
  newPasswordFields,
  newPasswordTargets,
  setFieldValue,
  submitFor,
} from "@/content/fields"
import { FieldIcons } from "@/content/icons"
import { InlineMenu, SavePrompt } from "@/content/overlays"
import {
  PASSKEY_CONTROL_EVENT,
  PASSKEY_STATE_EVENT,
  type PasskeyControl,
} from "@/content/passkey-events"
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
    /** Fields for a new password; their menu offers a generated one above the logins. */
    let newPasswords: HTMLInputElement[] = []
    /** One-time code fields; they get the icon only while a ready source has codes for the page. */
    let codes: HTMLInputElement[] = []
    let codesAvailable: boolean | null = null
    let askingCodes = false
    let lastField: HTMLInputElement | null = null
    const isOurs = (field: HTMLInputElement) =>
      fields.includes(field) ||
      newPasswords.includes(field) ||
      codes.includes(field)
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
      const { token } = await callBackground("content.openMenu", {
        kind: codes.includes(field) ? "code" : "login",
        newPassword: newPasswords.includes(field),
        passkey: passkeyWaiting && fields.includes(field),
      })
      // The page may have stopped offering logins while the session was requested.
      if (!active || !isOurs(field)) return
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
        case "fillCode":
          fillCode(message)
          return
        case "fillNew":
          fillNew(message)
          return
        case "usePasskey":
          controlPasskeys("use")
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

    function fillCode(
      message: Extract<ContentMessage, { type: "fillCode" }>,
    ): void {
      if (location.origin !== message.origin) return
      const focused = deepActiveElement()
      const anchor = [
        menu.openFor,
        focused instanceof HTMLInputElement ? focused : null,
        lastField?.isConnected ? lastField : null,
        codes[0],
      ].find((field) => field && codes.includes(field))
      menu.close()
      if (!anchor) return
      filling = true
      try {
        fillCodeField(anchor, message.code)
      } finally {
        filling = false
      }
    }

    function fillNew(
      message: Extract<ContentMessage, { type: "fillNew" }>,
    ): void {
      if (location.origin !== message.origin) return
      const anchor = [
        menu.openFor,
        lastField?.isConnected ? lastField : null,
      ].find((field) => field && newPasswords.includes(field))
      menu.close()
      if (!anchor) return
      filling = true
      try {
        for (const field of newPasswordTargets(anchor, newPasswords))
          setFieldValue(field, message.password)
      } finally {
        filling = false
      }
    }

    let active = false
    let scanCodes = false
    let takeOverPasskeys = false
    /** Whether the page-world script holds a passkey request for the menu. */
    let passkeyWaiting = false
    let passkeyMode: PasskeyControl | null = null
    const controlPasskeys = (control: PasskeyControl) =>
      document.dispatchEvent(
        new CustomEvent(PASSKEY_CONTROL_EVENT, { detail: control }),
      )
    /**
     * Keeps the page's passkey request for the menu while this frame shows the menu on login
     * fields; otherwise the browser lists passkeys itself.
     */
    const steerPasskeys = () => {
      const next =
        active && takeOverPasskeys && fields.length > 0 ? "hold" : "release"
      if (next === passkeyMode) return
      passkeyMode = next
      controlPasskeys(next)
    }
    let menuTrigger: ContentConfig["menuTrigger"] = "click"
    let observer: MutationObserver | null = null
    let rescan = 0
    let pending = 0

    const scan = () => {
      fields = loginFields(document)
      newPasswords = newPasswordFields(document)
      const found = codeFields(document, [...fields, ...newPasswords])
      if (found.length && codesAvailable === null) void checkCodes()
      codes = codesAvailable ? found : []
      icons.update([...fields, ...newPasswords, ...codes])
      steerPasskeys()
    }
    /**
     * Asks once per configuration whether code fields should get the icon. A configuration follows
     * every change of the sources, so an unlock after the page loaded shows the icon too.
     */
    const checkCodes = async () => {
      if (askingCodes) return
      askingCodes = true
      const request = requested
      const available = await callBackground("content.hasCodes", null).catch(
        () => false,
      )
      askingCodes = false
      if (request !== requested || ctx.isInvalid || !active) return
      codesAvailable = available
      if (available) scan()
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
      newPasswords = []
      codes = []
      icons.update([])
      steerPasskeys()
    }
    ctx.onInvalidated(() => {
      observer?.disconnect()
      clearTimeout(pending)
      // The menu of this copy is gone; a newer copy of the script takes over in new pages only.
      controlPasskeys("release")
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
      scanCodes = config.scanCodes
      takeOverPasskeys = config.takeOverPasskeys
      codesAvailable = null
      if (config.active === active) {
        if (active) scan()
        else steerPasskeys()
        return
      }
      active = config.active
      if (active) start()
      else stop()
    }
    const onStorage = (
      changes: Record<string, Browser.storage.StorageChange>,
    ) => {
      if (
        changes.settings ||
        changes[ACCOUNTS_KEY] ||
        changes[SOURCES_CHANGED_KEY]
      )
        void configure()
    }
    ctx.addEventListener(document, PASSKEY_STATE_EVENT, (event) => {
      const waiting = (event as CustomEvent<unknown>).detail === "waiting"
      if (waiting === passkeyWaiting) return
      passkeyWaiting = waiting
      // An open menu learned about the request when it opened, so it opens again to match.
      const field = menu.openFor
      if (field && fields.includes(field)) {
        menu.close()
        void openMenu(field).catch(() => {})
      }
    })
    browser.storage.local.onChanged.addListener(onStorage)
    onInvalidatedRemove(() =>
      browser.storage.local.onChanged.removeListener(onStorage),
    )
    await configure()
    if (isTop) void callBackground("content.ready", null).catch(() => {})

    // Only an empty field opens the menu on focus. A filled one, as after a fill when the focus
    // comes back from the menu's frame, opens it from its icon.
    ctx.addEventListener(document, "focusin", (event) => {
      const target = eventOrigin(event)
      if (
        active &&
        menuTrigger === "focus" &&
        event.isTrusted &&
        !filling &&
        target instanceof HTMLInputElement &&
        !target.value &&
        isOurs(target) &&
        menu.openFor !== target
      ) {
        void openMenu(target).catch(() => {})
      }
    })

    watchCodeImages(
      ctx,
      () => active && scanCodes,
      (candidate) => callBackground("content.codeCandidate", candidate ?? {}),
    )

    watchSubmissions(
      ctx,
      () => active,
      (credentials) =>
        void callBackground("content.submitted", credentials).catch(() => {}),
    )
  },
})
