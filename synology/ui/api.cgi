#!/bin/sh
# DSM CGI: passes the request to cgi.js (session check + proxy to the server)
for n in /var/packages/Node.js_v20/target/usr/local/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$n" ] && exec "$n" /var/packages/UploadPortal/target/app/cgi.js
done
printf 'Status: 500\r\nContent-Type: application/json\r\n\r\n{"error":"Node.js v20 is not installed"}'
