#!/usr/bin/env bash
###############################################################################
# run-gateway.sh — start the NestJS gateway against the LIVE Fabric peer
# (LEDGER_BACKEND=fabric), using the Org1 User1 identity from the test-network.
#
# Prereqs: deploy.sh has the network up + chaincode committed + InitLedger done;
#          the monorepo is built under $GW (default ~/ayurtrace/apps/gateway).
# Serves the dashboards + REST API on http://localhost:$PORT (default 3001).
###############################################################################
set -uo pipefail
GW="${GW:-$HOME/ayurtrace/apps/gateway}"
TN="${FABRIC_SAMPLES:-$HOME/fabric-samples}/test-network"
O="$TN/organizations/peerOrganizations/org1.example.com"

CERT="$(ls "$O/users/User1@org1.example.com/msp/signcerts/"*.pem 2>/dev/null | head -1)"
KEY="$(ls "$O/users/User1@org1.example.com/msp/keystore/"* 2>/dev/null | head -1)"
TLS="$O/peers/peer0.org1.example.com/tls/ca.crt"
for f in "$CERT" "$KEY" "$TLS"; do
  [ -f "$f" ] || { echo "missing crypto material: $f  (is the network up?)"; exit 1; }
done

export LEDGER_BACKEND=fabric
export FABRIC_PEER_ENDPOINT="localhost:7051"
export FABRIC_PEER_HOST_ALIAS="peer0.org1.example.com"
export FABRIC_TLS_CERT_PATH="$TLS"
export FABRIC_CERT_PATH="$CERT"
export FABRIC_KEY_PATH="$KEY"
export FABRIC_MSP_ID="Org1MSP"
export FABRIC_CHANNEL="provenance-channel"
export FABRIC_CHAINCODE="ayurledger"
export PORT="${PORT:-3001}"

echo "Gateway -> peer $FABRIC_PEER_ENDPOINT ($FABRIC_MSP_ID), channel $FABRIC_CHANNEL/$FABRIC_CHAINCODE"
echo "Identity cert: $CERT"
cd "$GW"
exec node dist/main.js
