#!/bin/sh
# Sets up this Mac for Keyward: lets the extension reach the Passwords helper that comes with macOS.
#
# A browser starts a native helper only for the extensions that a host manifest in its
# NativeMessagingHosts folder names. Apple's own manifest names only Apple's extensions, so this
# writes keyward.passwords.json, which names Keyward and points at the same helper, into the
# user's own folder of Chrome and of the other Chromium browsers found. It needs no administrator
# password and installs nothing.
#
# Usage:
#   setup.sh [--user-data-dir DIR] EXTENSION_ID...   write the manifest
#   setup.sh [--user-data-dir DIR] --uninstall       remove it
#
# --user-data-dir writes only to DIR/NativeMessagingHosts, for a browser started with that option.

set -eu

# The host name Keyward connects to; src/lib/providers/apple/helper-port.ts names it as well.
HOST=keyward.passwords
SUPPORT="$HOME/Library/Application Support"
# Data folders of Chromium browsers under Application Support. Chrome's is written even when that
# folder is missing, since other browsers built on Chromium, such as ego, read it too.
BROWSERS='Google/Chrome
Google/Chrome Beta
Google/Chrome Dev
Google/Chrome Canary
Chromium
Microsoft Edge
Microsoft Edge Beta
Microsoft Edge Dev
Microsoft Edge Canary
BraveSoftware/Brave-Browser
BraveSoftware/Brave-Browser-Beta
BraveSoftware/Brave-Browser-Nightly
Vivaldi
Arc/User Data'

fail() {
  echo "Keyward: $*" >&2
  exit 1
}

is_extension_id() {
  case "$1" in
    *[!a-p]*) return 1 ;;
  esac
  [ ${#1} -eq 32 ]
}

# Apple's own manifest says where the helper is; the paths after it are for a Mac without one.
helper_path() {
  for candidate in \
    "$(plutil -extract path raw /Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json 2>/dev/null || true)" \
    /System/Cryptexes/App/System/Library/CoreServices/PasswordManagerBrowserExtensionHelper.app/Contents/MacOS/PasswordManagerBrowserExtensionHelper \
    /System/Library/CoreServices/PasswordManagerBrowserExtensionHelper.app/Contents/MacOS/PasswordManagerBrowserExtensionHelper; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

host_folders() {
  if [ -n "$user_data_dir" ]; then
    echo "$user_data_dir/NativeMessagingHosts"
    return
  fi
  printf '%s\n' "$BROWSERS" | while IFS= read -r browser; do
    if [ "$browser" = "Google/Chrome" ] || [ -d "$SUPPORT/$browser" ]; then
      echo "$SUPPORT/$browser/NativeMessagingHosts"
    fi
  done
}

user_data_dir=""
uninstall=false
origins=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user-data-dir)
      [ $# -ge 2 ] || fail "--user-data-dir needs a folder."
      user_data_dir=$2
      shift 2
      ;;
    --uninstall)
      uninstall=true
      shift
      ;;
    -*) fail "Unknown option: $1" ;;
    *)
      is_extension_id "$1" || fail "Not an extension ID: $1"
      origins="$origins${origins:+,}\"chrome-extension://$1/\""
      shift
      ;;
  esac
done

[ "$(uname -s)" = Darwin ] || fail "Passwords is only available on macOS."

if [ "$uninstall" = true ]; then
  host_folders | while IFS= read -r folder; do
    if [ -f "$folder/$HOST.json" ]; then
      rm "$folder/$HOST.json"
      echo "Removed $folder/$HOST.json"
    fi
  done
  echo "Keyward can no longer reach Passwords."
  exit 0
fi

[ -n "$origins" ] || fail "Give the extension ID that Keyward's setup page shows."
helper=$(helper_path) ||
  fail "The Passwords helper was not found. It comes with macOS 14 and later."

manifest=$(printf '{"name":"%s","description":"Lets Keyward reach the Passwords helper that comes with macOS","path":"%s","type":"stdio","allowed_origins":[%s]}' \
  "$HOST" "$helper" "$origins")
host_folders | while IFS= read -r folder; do
  mkdir -p "$folder"
  printf '%s\n' "$manifest" >"$folder/$HOST.json"
  echo "Wrote $folder/$HOST.json"
done
echo "Done. Go back to Keyward; its setup page continues by itself."
