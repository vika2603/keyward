import {
  ChevronRightIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN } from "@/components/keyward/loading"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { t } from "@/lib/i18n"
import type {
  LoginDetails,
  LoginSummary,
  OneTimeCode,
  VaultInfo,
} from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import {
  CopyButton,
  CustomFieldRow,
  DeleteButton,
  Field,
  formatDate,
  IconButton,
  InfoRow,
  MaskText,
  RevealButton,
  SecretText,
  Section,
  toggled,
} from "./detail-parts"
import { BackHeader } from "./header"

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

/** What a code looks like before it is shown; as wide as the code itself. */
const CODE_MASK = "••••••"

/**
 * One login of the page: its username, password, one-time code, addresses, notes, custom fields and
 * history. The password and code are read only when asked for; Apple asks for Touch ID first.
 */
export function DetailView({
  vault,
  login,
  onBack,
  onEdit,
  onPasswordHistory,
}: {
  vault: VaultInfo
  login: LoginSummary
  /** Also where the view goes once the login was deleted. */
  onBack: () => void
  onEdit: () => void
  onPasswordHistory: () => void
}) {
  const ids = useMemo(
    () => ({ vaultId: vault.id, loginId: login.id }),
    [vault.id, login.id],
  )
  const apple = vault.kind === "apple"
  const [details, setDetails] = useState<LoginDetails | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [code, setCode] = useState<OneTimeCode | null>(null)
  const [codeShown, setCodeShown] = useState(false)
  /** Indexes of the hidden custom fields the user revealed. */
  const [shownFields, setShownFields] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  /** What waits for Touch ID or the provider right now. */
  const [waiting, setWaiting] = useState<"password" | "code" | null>(null)
  const [now, setNow] = useState(Date.now)
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

  const loadCode = useCallback(async (): Promise<OneTimeCode | null> => {
    setWaiting("code")
    const result = await run(() =>
      callBackground("popup.oneTimeCode", ids),
    ).finally(() => setWaiting(null))
    setCode(result)
    setNow(Date.now())
    return result
  }, [run, ids])

  const copyCode = useCallback(async () => {
    const current = code ?? (await loadCode())
    return current !== null && copyText(current.code, true)
  }, [code, loadCode, copyText])

  const togglePassword = async () => {
    if (revealed) {
      setRevealed(false)
      return
    }
    const value = await readPassword()
    if (value !== null) setRevealed(true)
  }

  const toggleCode = async () => {
    if (codeShown) {
      setCodeShown(false)
      return
    }
    const current = code ?? (await loadCode())
    if (current) setCodeShown(true)
  }

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

  /** True once the login is gone; false when the request failed and its error shows. */
  const remove = async () =>
    (await run(async () => {
      await callBackground("popup.removeLogin", ids)
      onBack()
      return true
    })) === true

  const name = details?.name || login.title
  const customFields = details?.customFields ?? []
  const pastPasswordCount = details?.pastPasswordCount ?? 0
  const remaining =
    expiresAt === undefined
      ? null
      : Math.max(0, Math.ceil((expiresAt - now) / 1000))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
          <span className="min-w-0 truncate text-base font-medium">{name}</span>
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
                        <RevealButton
                          shown={revealed}
                          showLabel={t("popup.detail.showPassword")}
                          hideLabel={t("popup.detail.hidePassword")}
                          disabled={waiting === "password"}
                          onClick={() => void togglePassword()}
                        />
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
                      <SecretText value={password} />
                    ) : (
                      <MaskText />
                    )}
                  </Field>
                  {details.hasCode && (
                    <Field
                      label={t("popup.detail.code")}
                      valueRef={codeRef}
                      actions={
                        <>
                          {code &&
                            (remaining !== null && code.period ? (
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
                            ))}
                          <RevealButton
                            shown={codeShown}
                            showLabel={t("popup.detail.showCode")}
                            hideLabel={t("popup.detail.hideCode")}
                            disabled={waiting === "code"}
                            onClick={() => void toggleCode()}
                          />
                          <CopyButton
                            label={t("popup.copyCode")}
                            disabled={waiting === "code"}
                            copy={copyCode}
                          />
                        </>
                      }
                    >
                      {waiting === "code" && apple ? (
                        <span className="text-xs text-muted-foreground">
                          {t("popup.main.confirmTouchId")}
                        </span>
                      ) : (
                        <span className="select-all">
                          <CodeText
                            code={code && codeShown ? code.code : CODE_MASK}
                          />
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
            {customFields.length > 0 && (
              <Section title={t("popup.detail.customFields")}>
                {customFields.map((field, index) => (
                  <CustomFieldRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: field names may repeat; their position is their identity.
                    key={index}
                    field={field}
                    shown={shownFields.has(index)}
                    onToggle={() =>
                      setShownFields((shown) => toggled(shown, index))
                    }
                    copyText={copyText}
                  />
                ))}
              </Section>
            )}
            <Section title={t("popup.detail.info")}>
              <InfoRow label={t("popup.detail.vault")}>
                <BrandIcon kind={vault.kind} className="size-3.5 shrink-0" />
                <span className="truncate">{vaultLabel(vault)}</span>
              </InfoRow>
              {details.modified !== undefined && (
                <InfoRow label={t("popup.detail.modified")}>
                  {formatDate(details.modified)}
                </InfoRow>
              )}
              {details.created !== undefined && (
                <InfoRow label={t("popup.detail.created")}>
                  {formatDate(details.created)}
                </InfoRow>
              )}
              {details.passwordModified !== undefined && (
                <InfoRow label={t("popup.detail.passwordModified")}>
                  {formatDate(details.passwordModified)}
                </InfoRow>
              )}
              {pastPasswordCount > 0 && (
                <button
                  type="button"
                  onClick={onPasswordHistory}
                  className="flex min-h-10 w-full items-center gap-3 border-t px-3 py-2 text-left text-sm outline-none first:border-t-0 last:rounded-b-xl hover:bg-muted focus-visible:bg-muted"
                >
                  <span className="flex-1">
                    {t("popup.detail.passwordHistory")}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {pastPasswordCount}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </button>
              )}
            </Section>
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
            {details.editable && (
              <DeleteButton
                hint={t("popup.detail.deleteHint")}
                onDelete={remove}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
