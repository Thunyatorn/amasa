#!/bin/sh
# The one start command for the machine (Dockerfile CMD): seed once, then run the payments service
# (loopback only, port 4100) and the web app (port 3000) side by side. If either stops, stop the other
# and exit non-zero so the host restarts the machine.
set -eu

export DATABASE_PATH="${DATABASE_PATH:-/data/amasa.db}"
export PAYMENTS_DB_PATH="${PAYMENTS_DB_PATH:-/data/payments.db}"
mkdir -p "$(dirname "$DATABASE_PATH")" "$(dirname "$PAYMENTS_DB_PATH")"

# First boot only: the store needs the celebrity market's prices (it answers 503 without them). Not on
# every boot, because the seed puts the demo autonomy state back to its starting point.
marker="$(dirname "$DATABASE_PATH")/.seeded"
if [ ! -f "$marker" ]; then
  echo "first boot: seeding the demo data"
  pnpm seed
  touch "$marker"
fi

# Each service runs as one plain node process, so stopping it really stops it.
(cd services/payments && PORT=4100 exec node --import tsx src/server.ts) &
payments=$!
(cd apps/web && exec node ./node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000) &
web=$!

stop() { kill "$payments" "$web" 2>/dev/null || true; }
trap 'stop; wait; exit 143' TERM INT

while kill -0 "$payments" 2>/dev/null && kill -0 "$web" 2>/dev/null; do sleep 1; done
echo "a process exited; stopping the other one"
stop
wait || true
exit 1
