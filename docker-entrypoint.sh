#!/bin/sh
set -eu

# Zeabur's existing Canvas service exposes port 8080. Keep the Go API private
# and serve the Next.js application on the public port.
PORT=8081 /app/server &
API_PID=$!

cd /app/web
API_BASE_URL=http://127.0.0.1:8081 PORT=8080 node server.js &
WEB_PID=$!

shutdown() {
  trap - INT TERM
  kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
wait "$API_PID" 2>/dev/null || true
wait "$WEB_PID" 2>/dev/null || true
exit 1
