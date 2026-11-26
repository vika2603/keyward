#!/bin/sh
# Sets up this Mac for Keyward: lets the extension reach the Passwords helper that comes with macOS.
#
# A browser starts a native helper only for the extensions that a host manifest names, and looks
# for the user's manifests in the NativeMessagingHosts folder of its own data folder. Apple's
# manifest names only Apple's extensions, so this writes keyward.passwords.json, which names
# Keyward and points at the same helper, into the data folder of one browser: Chrome unless
# --browser names another. ego lite reads Chrome's folder rather than its own (checked on ego lite
# 0.6.3.17), so the default sets it up too. It needs no administrator password and installs
# nothing.
#
# Usage:
#   setup.sh [--browser NAME | --user-data-dir DIR] EXTENSION_ID...   write the manifest
#   setup.sh [--browser NAME | --user-data-dir DIR] --uninstall       remove it
#
# NAME is chrome (the default), dia, edge or brave. --user-data-dir names the data folder of
# a browser started with that option.

set -eu

# The host name Keyward connects to; src/lib/providers/apple/helper-port.ts names it as well.
HOST=keyward.passwords
SUPPORT="$HOME/Library/Application Support"

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

# A browser's data folder under Application Support. The names match SETUP_BROWSERS in
# src/lib/providers/apple/setup-command.ts.
browser_folder() {
  case "$1" in
    chrome) echo "Google/Chrome" ;;
    dia) echo "Dia" ;;
    edge) echo "Microsoft Edge" ;;
    brave) echo "BraveSoftware/Brave-Browser" ;;
    *) return 1 ;;
  esac
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

browser=chrome
user_data_dir=""
uninstall=false
origins=""
while [ $# -gt 0 ]; do
  case "$1" in
    --browser)
      [ $# -ge 2 ] || fail "--browser needs a name: chrome, dia, edge or brave."
      browser=$2
      shift 2
      ;;
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

case "$(uname -s)" in
  Darwin) ;;
  Linux) fail "Apple offers no Passwords helper for Linux, so there is nothing to set up." ;;
  *) fail "This script sets up macOS only." ;;
esac

if [ -n "$user_data_dir" ]; then
  data_dir=$user_data_dir
else
  folder=$(browser_folder "$browser") ||
    fail "$browser is not a browser this can set up. Use chrome, dia, edge or brave."
  data_dir="$SUPPORT/$folder"
fi
hosts_dir="$data_dir/NativeMessagingHosts"
manifest_path="$hosts_dir/$HOST.json"

if [ "$uninstall" = true ]; then
  rm -f "$manifest_path"
  echo OK
  exit 0
fi

# A Mac with only ego lite has no Chrome folder yet for ego to read.
if [ "$browser" = chrome ] && [ -z "$user_data_dir" ] && [ -d "$SUPPORT/Citro Labs/ego lite" ]; then
  mkdir -p "$data_dir"
fi
[ -d "$data_dir" ] || fail "No browser data was found in $data_dir. Is the browser installed and opened once?"

[ -n "$origins" ] || fail "Give the extension ID that Keyward's connect page shows."
helper=$(helper_path) ||
  fail "The Passwords helper was not found. It comes with macOS 14 and later."

mkdir -p "$hosts_dir"
printf '{"name":"%s","description":"Lets Keyward reach the Passwords helper that comes with macOS","path":"%s","type":"stdio","allowed_origins":[%s]}\n' \
  "$HOST" "$helper" "$origins" >"$manifest_path"
echo OK
