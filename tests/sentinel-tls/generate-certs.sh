#!/usr/bin/env bash
#
# Generates a throwaway CA plus server and client certificates for the local
# Redis Sentinel + TLS test fixture (docker-compose.test.yml `sentinel-tls`
# profile). The server certificate carries SANs for every name the fixture and
# the host-run test use to reach the nodes.
#
# These certificates are for LOCAL TESTING ONLY. Do not commit the generated
# files and never reuse them outside of tests.
#
# Usage: tests/sentinel-tls/generate-certs.sh [output-dir]
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$DIR/certs}"
mkdir -p "$OUT"

echo "Generating Redis Sentinel test certificates in $OUT"

# Certificate authority.
openssl genrsa -out "$OUT/ca.key" 4096 >/dev/null 2>&1
openssl req -x509 -new -nodes -key "$OUT/ca.key" -sha256 -days 3650 \
  -subj "/CN=Sockudo Sentinel Test CA" -out "$OUT/ca.crt" >/dev/null 2>&1

# Server certificate, shared by the master and the sentinels.
openssl genrsa -out "$OUT/redis.key" 2048 >/dev/null 2>&1
openssl req -new -key "$OUT/redis.key" -subj "/CN=sockudo-redis" \
  -out "$OUT/redis.csr" >/dev/null 2>&1
cat > "$OUT/redis.ext" <<'EOF'
subjectAltName=DNS:localhost,DNS:host.docker.internal,DNS:redis-master-tls,DNS:redis-sentinel-tls-1,DNS:redis-sentinel-tls-2,DNS:redis-sentinel-tls-3,IP:127.0.0.1
EOF
openssl x509 -req -in "$OUT/redis.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -CAcreateserial -days 3650 -sha256 -extfile "$OUT/redis.ext" \
  -out "$OUT/redis.crt" >/dev/null 2>&1

# Client certificate for mutual TLS (presented by the test and by sentinels).
openssl genrsa -out "$OUT/client.key" 2048 >/dev/null 2>&1
openssl req -new -key "$OUT/client.key" -subj "/CN=sockudo-client" \
  -out "$OUT/client.csr" >/dev/null 2>&1
openssl x509 -req -in "$OUT/client.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -CAcreateserial -days 3650 -sha256 -out "$OUT/client.crt" >/dev/null 2>&1

rm -f "$OUT"/*.csr "$OUT"/*.ext "$OUT"/*.srl
# Redis must be able to read the key files inside the container.
chmod 644 "$OUT"/*.crt "$OUT"/*.key

echo "Done. Certificates:"
ls -1 "$OUT"
