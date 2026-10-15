#!/bin/sh
# Shared variables for the package scripts
PKG_NAME="UploadPortal"
PKG_DEST="${SYNOPKG_PKGDEST:-/var/packages/${PKG_NAME}/target}"
PKG_VAR="${SYNOPKG_PKGVAR:-/var/packages/${PKG_NAME}/var}"
CONFIG_FILE="${PKG_VAR}/config.env"
PID_FILE="${PKG_VAR}/server.pid"
LOG_FILE="${PKG_VAR}/server.log"
PORT=8090

find_node() {
    for n in /var/packages/Node.js_v20/target/usr/local/bin/node /usr/local/bin/node /usr/bin/node; do
        [ -x "$n" ] && { echo "$n"; return 0; }
    done
    command -v node 2>/dev/null
}

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}
