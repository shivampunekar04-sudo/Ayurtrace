#!/usr/bin/env bash
###############################################################################
# deploy.sh — bring up the fabric-samples test-network (2 orgs + orderer,
# CouchDB), deploy the ayurledger chaincode as a Chaincode-as-a-Service, and
# run InitLedger. Idempotent: tears down any prior network first.
#
# Requires: setup-host.sh already run once; ~/fabric-samples installed;
#           ~/ayurledger-cc built (infra/fabric/build-package.sh).
#
# Env overrides: FABRIC_SAMPLES (default ~/fabric-samples),
#                CC_PKG (default ~/ayurledger-cc), CHANNEL (default provenance-channel)
###############################################################################
set -uo pipefail
FABRIC="${FABRIC_SAMPLES:-$HOME/fabric-samples}"
CC="${CC_PKG:-$HOME/ayurledger-cc}"
CHANNEL="${CHANNEL:-provenance-channel}"
cd "$FABRIC/test-network"
export PATH="$FABRIC/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC/config"

echo "### down + up ($CHANNEL, couchdb)"
./network.sh down >/dev/null 2>&1 || true
# network.sh down does NOT remove the standalone CCaaS containers (they are `docker run`,
# not part of the compose). Remove them so their names + stale package-id don't collide
# with this run's freshly-committed chaincode.
docker rm -f peer0org1_ayurledger_ccaas peer0org2_ayurledger_ccaas >/dev/null 2>&1 || true
./network.sh up createChannel -c "$CHANNEL" -s couchdb 2>&1 | tail -3

echo "### deploy CCaaS"
./network.sh deployCCAAS -ccn ayurledger -ccp "$CC" -c "$CHANNEL" 2>&1 | tail -4
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'ccaas|peer0|orderer|couchdb' | sort

echo "### InitLedger (dual-org endorsement)"
ORG="$PWD/organizations"
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$ORG/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$ORG/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051
init_once() {
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile "$ORG/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem" \
    -C "$CHANNEL" -n ayurledger \
    --peerAddresses localhost:7051 --tlsRootCertFiles "$ORG/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem" \
    -c '{"function":"InitLedger","Args":[]}' --waitForEvent 2>&1
}
# The CCaaS Node server needs a few seconds to boot + register; retry until ready.
for i in $(seq 1 12); do
  R="$(init_once)"
  if echo "$R" | grep -q 'status:200'; then echo "InitLedger committed (attempt $i)"; break; fi
  echo "  chaincode not ready (attempt $i)…"; sleep 5
done
echo "$R" | tail -1
sleep 2
echo "### Stats"
peer chaincode query -C "$CHANNEL" -n ayurledger -c '{"function":"Stats","Args":[]}'
echo ""
echo "DEPLOY DONE. Keep this Ubuntu terminal open — closing all WSL sessions stops the containers."
