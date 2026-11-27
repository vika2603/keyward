import http from "node:http"

export interface TestSiteServer {
  origin: string
  close: () => Promise<void>
}

const LOGIN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Login</title></head>
  <body>
    <form id="login-form" method="post" action="/api/login-ok">
      <label for="username">Username</label>
      <input id="username" name="username" type="email" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <label for="company-code">Company Code</label>
      <input id="company-code" name="company-code" type="text" />
      <button id="submit-ok" type="submit">Sign in</button>
    </form>
    <form id="fail-form" method="post" action="/api/login-fail">
      <label for="fail-user">Fail Username</label>
      <input id="fail-user" name="username" type="text" autocomplete="username" />
      <label for="fail-pass">Fail Password</label>
      <input id="fail-pass" name="password" type="password" autocomplete="current-password" />
      <button id="submit-fail" type="submit">Fail Sign in</button>
    </form>
    <script>
      document.getElementById("login-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/login-ok", { method: "POST", body: JSON.stringify({ ok: true }) })
      })
      document.getElementById("fail-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/login-fail", { method: "POST", body: JSON.stringify({ ok: false }) })
      })
    </script>
  </body>
</html>`

const SIGNUP_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Signup</title></head>
  <body>
    <form id="signup-form" method="post" action="/api/signup-ok">
      <label for="signup-user">Email</label>
      <input id="signup-user" name="email" type="email" autocomplete="username" />
      <label for="new-pass">New password</label>
      <input id="new-pass" name="new_password" type="password" autocomplete="new-password" />
      <label for="confirm-pass">Confirm password</label>
      <input id="confirm-pass" name="confirm_password" type="password" autocomplete="new-password" />
      <button id="submit-signup" type="submit">Create account</button>
    </form>
    <script>
      document.getElementById("signup-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/signup-ok", { method: "POST", body: JSON.stringify({ created: true }) })
      })
    </script>
  </body>
</html>`

const CHANGE_PASSWORD_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Change Password</title></head>
  <body>
    <form id="change-pw-form" method="post" action="/api/change-password-ok">
      <label for="cp-user">Username</label>
      <input id="cp-user" name="username" type="email" autocomplete="username" />
      <label for="cp-current">Current password</label>
      <input id="cp-current" name="current_password" type="password" autocomplete="current-password" />
      <label for="cp-new">New password</label>
      <input id="cp-new" name="new_password" type="password" autocomplete="new-password" />
      <label for="cp-confirm">Confirm new password</label>
      <input id="cp-confirm" name="confirm_password" type="password" autocomplete="new-password" />
      <button id="submit-change-pw" type="submit">Update password</button>
    </form>
    <script>
      document.getElementById("change-pw-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/change-password-ok", { method: "POST", body: JSON.stringify({ ok: true }) })
      })
    </script>
  </body>
</html>`

const OTP_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E 2FA</title></head>
  <body>
    <form id="otp-form">
      <label for="otp-code">Verification code</label>
      <input id="otp-code" name="totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      <button type="submit">Verify</button>
    </form>
  </body>
</html>`

const SHADOW_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Shadow DOM</title></head>
  <body>
    <login-widget id="widget"></login-widget>
    <script>
      class LoginWidget extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: "open" })
          root.innerHTML = \`
            <form id="shadow-form">
              <label for="shadow-user">Username</label>
              <input id="shadow-user" name="username" type="email" autocomplete="username" />
              <label for="shadow-pass">Password</label>
              <input id="shadow-pass" name="password" type="password" autocomplete="current-password" />
              <button type="submit">Log in</button>
            </form>
          \`
        }
      }
      customElements.define("login-widget", LoginWidget)
    </script>
  </body>
</html>`

const PASSKEY_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Passkey</title></head>
  <body>
    <form id="passkey-form">
      <label for="pk-user">Username</label>
      <input id="pk-user" name="username" type="text" autocomplete="username webauthn" />
      <label for="pk-pass">Password</label>
      <input id="pk-pass" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
    <script>
      window.__passkeyResult = null
      window.__passkeyError = null
      window.__startConditional = () => {
        const challenge = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88])
        navigator.credentials.get({
          mediation: "conditional",
          publicKey: {
            rpId: "localhost",
            challenge,
            userVerification: "preferred",
          },
        }).then(
          (credential) => {
            window.__passkeyResult = credential ? credential.toJSON() : null
          },
          (error) => {
            window.__passkeyError = error ? String(error.name || error) : "unknown"
          },
        )
      }
      if (!new URLSearchParams(location.search).has("noConditional")) {
        window.__startConditional()
      }
    </script>
  </body>
</html>`

const PAGES: Record<string, string> = {
  "/login": LOGIN_HTML,
  "/signup": SIGNUP_HTML,
  "/change-password": CHANGE_PASSWORD_HTML,
  "/otp": OTP_HTML,
  "/shadow": SHADOW_HTML,
  "/passkey": PASSKEY_HTML,
}

/** Starts a local HTTP test site served on `http://localhost:<port>` (secure context in Chrome). */
export async function startTestSite(): Promise<TestSiteServer> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname
    const html = PAGES[pathname]
    if (html) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(html)
      return
    }
    if (pathname === "/basic-auth") {
      const auth = request.headers.authorization
      if (auth?.startsWith("Basic ")) {
        const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8")
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end(
          `<html><body><pre id="auth-ok">${decoded}</pre></body></html>`,
        )
        return
      }
      response.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Keyward Router"',
      })
      response.end("Unauthorized")
      return
    }
    if (
      pathname === "/api/login-ok" ||
      pathname === "/api/signup-ok" ||
      pathname === "/api/change-password-ok"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (pathname === "/api/login-fail") {
      response.writeHead(401, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Invalid credentials" }))
      return
    }
    response.writeHead(404)
    response.end("Not Found")
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Could not bind test HTTP server")

  return {
    origin: `http://localhost:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
