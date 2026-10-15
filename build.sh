#!/usr/bin/env bash
# Builds dist/UploadPortal-<version>.spk for installation via Synology Package Center.
# Works on macOS and Linux (used by the GitHub Actions release workflow).
set -euo pipefail
cd "$(dirname "$0")"

PKG_VERSION="$(node -p "require('./package.json').version")"
# Monotonic build number in Dutch time (consistent with earlier builds, so upgrades are never seen as downgrades)
BUILD_NO="${BUILD_NUMBER:-$(TZ=Europe/Amsterdam date +%y%m%d%H%M)}"
VERSION="${PKG_VERSION}-${BUILD_NO}"
BUILD=build
OUT="dist/UploadPortal-${PKG_VERSION}.spk"
export COPYFILE_DISABLE=1   # no macOS ._ files in tarballs

# --- portable helpers -------------------------------------------------------
replace() { # replace <file> <search> <replacement>
  local tmp; tmp="$(mktemp)"
  sed "s|$2|$3|g" "$1" > "$tmp" && cat "$tmp" > "$1" && rm -f "$tmp"
}
md5_of() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }
sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
if tar --version 2>/dev/null | grep -q GNU; then
  TAR_OWNER=(--owner=0 --group=0 --numeric-owner)
else
  TAR_OWNER=(--uid 0 --gid 0)
fi

rm -rf "$BUILD" && mkdir -p "$BUILD/pkg/app" "$BUILD/spk" dist

# --- package.tgz (installed as /var/packages/UploadPortal/target) ----------
cp server.js cgi.js package.json package-lock.json "$BUILD/pkg/app/"
cp -R public "$BUILD/pkg/app/public"
(cd "$BUILD/pkg/app" && npm ci --omit=dev --no-audit --no-fund --silent)

cp -R synology/ui "$BUILD/pkg/ui"
# Never put style.css or other loose css/js directly in ui/ — DSM loads those into the whole desktop.
cp public/style.css "$BUILD/pkg/ui/web/upload-portal.css"
cp public/common.js "$BUILD/pkg/ui/web/common.js"
replace "$BUILD/pkg/ui/index.html" "__VERSION__" "$VERSION"
mkdir -p "$BUILD/pkg/ui/images"
cp synology/icons/icon_*.png "$BUILD/pkg/ui/images/"
cp synology/UploadPortal.sc "$BUILD/pkg/"

for f in "$BUILD"/pkg/ui/*; do
  case "$(basename "$f")" in config|index.html|api.cgi|images|web) ;; *) echo "ERROR: unexpected file in ui/: $f"; exit 1 ;; esac
done

chmod -R u+rwX,go+rX "$BUILD/pkg"
chmod 755 "$BUILD/pkg/ui/api.cgi"
tar --no-xattrs "${TAR_OWNER[@]}" -czf "$BUILD/spk/package.tgz" -C "$BUILD/pkg" .

# --- SPK --------------------------------------------------------------------
cp -R synology/scripts synology/conf "$BUILD/spk/"
chmod 755 "$BUILD/spk/scripts/"*
cp synology/icons/icon_64.png "$BUILD/spk/PACKAGE_ICON.PNG"
cp synology/icons/icon_256.png "$BUILD/spk/PACKAGE_ICON_256.PNG"
cp synology/INFO.in "$BUILD/spk/INFO"
replace "$BUILD/spk/INFO" "__VERSION__" "$VERSION"
replace "$BUILD/spk/INFO" "__CHECKSUM__" "$(md5_of "$BUILD/spk/package.tgz")"

rm -f "$OUT"
tar --no-xattrs "${TAR_OWNER[@]}" -cf "$OUT" -C "$BUILD/spk" INFO package.tgz scripts conf PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG
echo "$(sha256_of "$OUT")  $(basename "$OUT")" > "$OUT.sha256"
rm -rf "$BUILD"
echo "Built: $OUT ($(du -h "$OUT" | cut -f1)) — version ${VERSION}"
