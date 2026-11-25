import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FingerprintIcon,
  PencilIcon,
  RefreshCwIcon,
  TimerIcon,
  Trash2Icon,
} from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, sourceLabel } from "@/components/keyward/brand-icon"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN } from "@/components/keyward/loading"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  LoginDetails,
  LoginSummary,
  OneTimeCode,
  SourceInfo,
} from "@/lib/backends/types"
import { currentLanguage, t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { BackHeader } from "./header"

/** Shown in place of a password that is not revealed; it does not tell the password's length. */
const MASK = "••••••••••••"

function charClass(char: string): string | undefined {
  if (/[0-9]/.test(char)) return "text-blue-600 dark:text-blue-400"
  if (/[a-zA-Z]/.test(char)) return undefined
  return "text-amber-700 dark:text-amber-400"
}

function formatDate(time: number): string {
  return new Intl.DateTimeFormat(currentLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time)
}

/** An address that can be opened in a tab: one with a web scheme, or a bare host. */
function webUrl(uri: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `https://${uri}`
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null
  } catch {
    return null
  }
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title && (
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {title}
        </h2>
      )}
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {children}
      </div>
    </section>
  )
}

function Field({
  label,
  children,
  actions,
  valueRef,
}: {
  label?: string
  children: ReactNode
  actions?: ReactNode
  valueRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex min-h-12 items-center gap-1 border-t py-2 pr-2 pl-3 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <div ref={valueRef} className="text-sm break-all">
          {children}
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-0.5">{actions}</div>}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** A copy button that shows a check for a moment once the copy went through. */
function CopyButton({
  label,
  copy,
  disabled,
}: {
  label: string
  copy: () => Promise<boolean>
  disabled?: boolean
}) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <IconButton
      label={done ? t("popup.copied") : label}
      disabled={disabled}
      onClick={() => void copy().then(setDone)}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  )
}

/** Seconds left of a code, drawn as a shrinking ring. */
function Countdown({
  remaining,
  period,
}: {
  remaining: number
  period: number
}) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const label = t("popup.detail.codeExpires", { count: remaining })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative inline-flex size-6 shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth="2"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
          className={cn(
            "transition-[stroke-dashoffset] duration-1000 ease-linear",
            remaining <= 5 ? "text-destructive" : "text-primary",
          )}
        />
      </svg>
      <span className="text-[10px] font-medium tabular-nums">{remaining}</span>
    </span>
  )
}

/** The credentials card's shape, shown until the login's details arrive. */
function DetailSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="mx-1 h-3 w-16" />
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {["w-40", "w-28"].map((width) => (
          <div
            key={width}
            className="flex min-h-12 flex-col justify-center gap-1.5 border-t px-3 py-2 first:border-t-0"
          >
            <Skeleton className="h-3 w-12" />
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A code split in two halves, as authenticator apps show it. */
function CodeText({ code }: { code: string }) {
  const half = Math.ceil(code.length / 2)
  return (
    <span className="font-mono text-lg tracking-wider">
      {code.slice(0, half)}
      <span className="ml-1.5">{code.slice(half)}</span>
    </span>
  )
}

/**
 * One login of the page: its username, password, one-time code, addresses, notes and dates. The
 * password and code are read only when asked for; Apple asks for Touch ID first.
 */
export function DetailView({
  source,
  login,
  onBack,
  onEdit,
}: {
  source: SourceInfo
  login: LoginSummary
  /** Also where the view goes once the login was deleted. */
  onBack: () => void
  onEdit: () => void
}) {
  const ids = useMemo(
    () => ({ sourceId: source.id, loginId: login.id }),
    [source.id, login.id],
  )
  const apple = source.kind === "apple"
  const [details, setDetails] = useState<LoginDetails | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [code, setCode] = useState<OneTimeCode | null>(null)
  /** What waits for Touch ID or the backend right now. */
  const [waiting, setWaiting] = useState<"password" | "code" | null>(null)
  const [now, setNow] = useState(Date.now)
  /** Deleting asks twice: the first click arms the button. */
  const [removing, setRemoving] = useState<"armed" | "busy" | null>(null)
  const passwordRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    callBackground("popup.details", ids).then(setDetails, (error) =>
      setMessage(errorMessage(error)),
    )
  }, [ids])

  /** Runs a request, showing its error; null when it failed. */
  const run = useCallback(
    async <T,>(task: () => Promise<T>): Promise<T | null> => {
      setMessage(null)
      try {
        return await task()
      } catch (error) {
        setMessage(errorMessage(error))
        return null
      }
    },
    [],
  )

  const copyText = useCallback(
    async (text: string, secret: boolean) =>
      (await run(async () => {
        await callBackground("popup.copyText", { text, secret })
        return true
      })) === true,
    [run],
  )

  const readPassword = useCallback(async (): Promise<string | null> => {
    if (password !== null) return password
    setWaiting("password")
    const result = await run(() =>
      callBackground("popup.revealPassword", ids),
    ).finally(() => setWaiting(null))
    if (result) setPassword(result.password)
    return result?.password ?? null
  }, [password, run, ids])

  const copyPassword = useCallback(async () => {
    const value = await readPassword()
    return value !== null && copyText(value, true)
  }, [readPassword, copyText])

  const loadCode = useCallback(async () => {
    setWaiting("code")
    const result = await run(() =>
      callBackground("popup.oneTimeCode", ids),
    ).finally(() => setWaiting(null))
    setCode(result)
    setNow(Date.now())
  }, [run, ids])

  const copyCode = useCallback(
    async () => code !== null && copyText(code.code, true),
    [code, copyText],
  )

  // Bitwarden codes need no confirmation, so they show at once; Apple's wait for a click.
  const autoCode =
    details?.hasCode === true && !details.secretsWithheld && !apple
  useEffect(() => {
    if (autoCode) void loadCode()
  }, [autoCode, loadCode])

  const expiresAt = code?.expiresAt
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  // A code that ran out is replaced by the next one.
  useEffect(() => {
    if (expiresAt !== undefined && now >= expiresAt && waiting === null)
      void loadCode()
  }, [expiresAt, now, waiting, loadCode])

  useCopyThrough(
    passwordRef,
    useCallback(() => void copyPassword(), [copyPassword]),
  )
  useCopyThrough(
    codeRef,
    useCallback(() => void copyCode(), [copyCode]),
  )

  const togglePasskeyOnly = async () => {
    if (!details) return
    const passkeyOnly = !details.passkeyOnly
    const done = await run(async () => {
      await callBackground("apple.setPasskeyOnly", {
        loginId: login.id,
        passkeyOnly,
      })
      return true
    })
    if (done) setDetails({ ...details, passkeyOnly })
  }

  const remove = async () => {
    if (removing !== "armed") {
      setRemoving("armed")
      return
    }
    setRemoving("busy")
    const done = await run(async () => {
      await callBackground("popup.removeLogin", ids)
      return true
    })
    if (done) onBack()
    else setRemoving(null)
  }

  const name = details?.name || login.title
  const remaining =
    expiresAt === undefined
      ? null
      : Math.max(0, Math.ceil((expiresAt - now) / 1000))

  return (
    <div className="flex max-h-[600px] flex-col">
      <BackHeader title={t("popup.detail.title")} onBack={onBack}>
        {details?.editable && (
          <IconButton label={t("popup.detail.edit")} onClick={onEdit}>
            <PencilIcon />
          </IconButton>
        )}
      </BackHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        <div className="flex items-center gap-3 px-1">
          <SiteIcon host={login.host} text={name} className="size-10" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <BrandIcon kind={source.kind} className="size-3.5" />
              <span className="truncate">{sourceLabel(source)}</span>
            </span>
          </div>
        </div>
        {message && <p className="px-1 text-xs text-destructive">{message}</p>}
        {!details && !message && <DetailSkeleton />}
        {details && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            <Section title={t("popup.detail.credentials")}>
              <Field
                label={t("popup.detail.username")}
                actions={
                  details.username && (
                    <CopyButton
                      label={t("popup.copyUsername")}
                      copy={() => copyText(details.username, false)}
                    />
                  )
                }
              >
                {details.username || (
                  <span className="text-muted-foreground">
                    {t("common.noUsername")}
                  </span>
                )}
              </Field>
              {details.secretsWithheld ? (
                <p className="border-t px-3 py-3 text-xs text-muted-foreground first:border-t-0">
                  {t("popup.detail.withheld")}
                </p>
              ) : (
                <>
                  <Field
                    label={t("popup.detail.password")}
                    valueRef={passwordRef}
                    actions={
                      <>
                        <IconButton
                          label={
                            revealed
                              ? t("popup.detail.hidePassword")
                              : t("popup.detail.showPassword")
                          }
                          disabled={waiting === "password"}
                          onClick={() => {
                            if (revealed) setRevealed(false)
                            else
                              void readPassword().then(
                                (value) => value !== null && setRevealed(true),
                              )
                          }}
                        >
                          {revealed ? <EyeOffIcon /> : <EyeIcon />}
                        </IconButton>
                        <CopyButton
                          label={t("popup.copyPassword")}
                          disabled={waiting === "password"}
                          copy={copyPassword}
                        />
                      </>
                    }
                  >
                    {waiting === "password" && apple ? (
                      <span className="text-xs text-muted-foreground">
                        {t("popup.main.confirmTouchId")}
                      </span>
                    ) : revealed && password !== null ? (
                      <span className="font-mono select-all">
                        {[...password].map((char, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; their position is their identity.
                          <span key={index} className={charClass(char)}>
                            {char}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="font-mono tracking-wider">{MASK}</span>
                    )}
                  </Field>
                  {details.hasCode && (
                    <Field
                      label={t("popup.detail.code")}
                      valueRef={codeRef}
                      actions={
                        code ? (
                          <>
                            {remaining !== null && code.period ? (
                              <span className="flex size-8 items-center justify-center">
                                <Countdown
                                  remaining={remaining}
                                  period={code.period}
                                />
                              </span>
                            ) : (
                              <IconButton
                                label={t("popup.detail.refreshCode")}
                                disabled={waiting === "code"}
                                onClick={() => void loadCode()}
                              >
                                <RefreshCwIcon />
                              </IconButton>
                            )}
                            <CopyButton
                              label={t("popup.copyCode")}
                              copy={copyCode}
                            />
                          </>
                        ) : (
                          <IconButton
                            label={t("popup.detail.showCode")}
                            disabled={waiting === "code"}
                            onClick={() => void loadCode()}
                          >
                            <TimerIcon />
                          </IconButton>
                        )
                      }
                    >
                      {code ? (
                        <span className="select-all">
                          <CodeText code={code.code} />
                        </span>
                      ) : waiting === "code" && apple ? (
                        <span className="text-xs text-muted-foreground">
                          {t("popup.main.confirmTouchId")}
                        </span>
                      ) : (
                        <span className="font-mono tracking-wider">
                          {"••• •••"}
                        </span>
                      )}
                    </Field>
                  )}
                </>
              )}
            </Section>
            {details.uris.length > 0 && (
              <Section title={t("popup.detail.websites")}>
                {details.uris.map((uri, index) => {
                  const url = webUrl(uri)
                  return (
                    <Field
                      // biome-ignore lint/suspicious/noArrayIndexKey: addresses may repeat; their position is their identity.
                      key={index}
                      actions={
                        <>
                          {url && (
                            <IconButton
                              label={t("popup.detail.openWebsite")}
                              onClick={() => {
                                void browser.tabs.create({ url })
                                window.close()
                              }}
                            >
                              <ExternalLinkIcon />
                            </IconButton>
                          )}
                          <CopyButton
                            label={t("popup.detail.copyWebsite")}
                            copy={() => copyText(uri, false)}
                          />
                        </>
                      }
                    >
                      {uri}
                    </Field>
                  )
                })}
              </Section>
            )}
            {details.notes && (
              <Section title={t("popup.detail.notes")}>
                <Field
                  actions={
                    <CopyButton
                      label={t("popup.detail.copyNotes")}
                      copy={() => copyText(details.notes ?? "", true)}
                    />
                  }
                >
                  <span className="break-words whitespace-pre-wrap">
                    {details.notes}
                  </span>
                </Field>
              </Section>
            )}
            {(details.modified ??
              details.created ??
              details.passwordModified) !== undefined && (
              <div className="flex flex-col gap-0.5 px-1 text-xs text-muted-foreground">
                {details.modified !== undefined && (
                  <span>
                    {t("popup.detail.modified", {
                      date: formatDate(details.modified),
                    })}
                  </span>
                )}
                {details.created !== undefined && (
                  <span>
                    {t("popup.detail.created", {
                      date: formatDate(details.created),
                    })}
                  </span>
                )}
                {details.passwordModified !== undefined && (
                  <span>
                    {t("popup.detail.passwordModified", {
                      date: formatDate(details.passwordModified),
                    })}
                  </span>
                )}
              </div>
            )}
            {apple && (
              <Button
                variant="outline"
                onClick={() =>
                  void run(() =>
                    callBackground("apple.openPasswordsApp", {
                      site: login.host,
                    }),
                  )
                }
              >
                <ExternalLinkIcon />
                {t("popup.detail.openInPasswordsApp")}
              </Button>
            )}
            {apple && (
              <div className="flex flex-col gap-1.5">
                <Button
                  variant="outline"
                  onClick={() => void togglePasskeyOnly()}
                >
                  <FingerprintIcon />
                  {details.passkeyOnly
                    ? t("popup.detail.unmarkPasskeyOnly")
                    : t("popup.detail.markPasskeyOnly")}
                </Button>
                <p className="px-1 text-xs text-muted-foreground">
                  {details.passkeyOnly
                    ? t("popup.detail.passkeyOnlyMarked")
                    : t("popup.detail.passkeyOnlyHint")}
                </p>
              </div>
            )}
            {details.editable && (
              <div className="flex flex-col gap-1.5">
                <Button
                  variant={removing ? "destructive" : "outline"}
                  disabled={removing === "busy"}
                  onClick={() => void remove()}
                  onBlur={() =>
                    setRemoving((current) =>
                      current === "armed" ? null : current,
                    )
                  }
                >
                  <Trash2Icon />
                  {removing
                    ? t("popup.detail.confirmDelete")
                    : t("popup.detail.delete")}
                </Button>
                {removing && (
                  <p className="px-1 text-xs text-muted-foreground">
                    {t("popup.detail.deleteHint")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
