#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJ_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
APP_INFO_PLIST="$PROJ_ROOT/mobile/ios/EduMobile/Info.plist"
RELEASE_SCRIPT="$SCRIPT_DIR/testflight.sh"

bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_INFO_PLIST")
if [[ "$bundle_version" != '$(CURRENT_PROJECT_VERSION)' ]]; then
    printf 'expected CFBundleVersion to inherit CURRENT_PROJECT_VERSION, got %s\n' "$bundle_version" >&2
    exit 1
fi

if grep -Eq '\|[[:space:]]*tail([[:space:]]|$)' "$RELEASE_SCRIPT"; then
    printf 'release script must not pipe build or upload output through tail\n' >&2
    exit 1
fi

if ! grep -Fq 'SKIP_BUILD_BUMP' "$RELEASE_SCRIPT"; then
    printf 'release script must support archiving an already committed build number\n' >&2
    exit 1
fi

transporter_branch=$(awk '
    /^[[:space:]]*transporter\)/ { capture=1 }
    capture { print }
    capture && /^[[:space:]]*;;/ { exit }
' "$RELEASE_SCRIPT")
if ! grep -Eq 'exit[[:space:]]+2' <<<"$transporter_branch"; then
    printf 'transporter handoff must exit pending instead of reporting upload success\n' >&2
    exit 1
fi

printf 'TestFlight configuration checks passed\n'
