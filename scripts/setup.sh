#!/bin/sh
# Sets up this Mac for Keyward: lets the extension reach the Passwords helper that comes with macOS.
#
# A browser starts a native helper only for the extensions that a host manifest names, and looks
# for the user's manifests in the NativeMessagingHosts folder of its own data folder. Apple's
# manifest names only Apple's extensions, so this writes keyward.passwords.json, which names
# Keyward and points at the same helper, into the data folder of each Chromium browser that has the
# extension installed: a browser's usual folder under Application Support, or the folder that a
# running browser was started with through --user-data-dir. It needs no administrator password and
# installs nothing.
#
# Usage:
#   setup.sh [--user-data-dir DIR] EXTENSION_ID...   write the manifest
#   setup.sh [--user-data-dir DIR] --uninstall       remove it
#
# --user-data-dir writes to DIR/NativeMessagingHosts alone, without looking for the extension.

set -eu

# The host name Keyward connects to; src/lib/providers/apple/helper-port.ts names it as well.
HOST=keyward.passwords
SUPPORT="$HOME/Library/Application Support"
# The usual data folders of Chromium browsers under Application Support.
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
Arc/User Data
Citro Labs/ego lite'

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

# The data folders of running browsers that were started with --user-data-dir.
running_data_dirs() {
  ps -axww -o command= | sed -n 's/.* --user-data-dir=//p' | sed 's/ --.*//'
}

# Every existing data folder to look in, each once.
data_dirs() {
  {
    printf '%s\n' "$BROWSERS" | while IFS= read -r browser; do
      echo "$SUPPORT/$browser"
    done
    running_data_dirs
  } | awk '!seen[$0]++' | while IFS= read -r dir; do
    if [ -d "$dir" ]; then echo "$dir"; fi
  done
}

# Whether a profile in the data folder has one of the extensions: one from a store is kept under
# Extensions/ID, and an unpacked one is named in the profile's preferences.
has_extension() {
  for profile in "$1"/*/; do
    for id in $ids; do
      if [ -d "$profile/Extensions/$id" ]; then return 0; fi
      for prefs in "$profile/Preferences" "$profile/Secure Preferences"; do
        if [ -f "$prefs" ] && grep -q -F "$id" "$prefs"; then return 0; fi
      done
    done
  done
  return 1
}

# The folders to write the manifest to, or to remove it from.
host_folders() {
  if [ -n "$user_data_dir" ]; then
    echo "$user_data_dir/NativeMessagingHosts"
    return
  fi
  data_dirs | while IFS= read -r dir; do
    if [ "$uninstall" = true ] || has_extension "$dir"; then
      echo "$dir/NativeMessagingHosts"
    fi
  done
}

user_data_dir=""
uninstall=false
ids=""
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
      ids="$ids $1"
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

folders=$(host_folders)
[ -n "$folders" ] ||
  fail "No browser on this Mac has Keyward with this ID. For a browser started with --user-data-dir, run this again with that option."

manifest=$(printf '{"name":"%s","description":"Lets Keyward reach the Passwords helper that comes with macOS","path":"%s","type":"stdio","allowed_origins":[%s]}' \
  "$HOST" "$helper" "$origins")
printf '%s\n' "$folders" | while IFS= read -r folder; do
  mkdir -p "$folder"
  printf '%s\n' "$manifest" >"$folder/$HOST.json"
  echo "Wrote $folder/$HOST.json"
done
echo "Done. Go back to Keyward; its setup page continues by itself."
