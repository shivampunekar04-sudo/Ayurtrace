#!/usr/bin/env bash
###############################################################################
# invoke-examples.sh — demonstrate on-peer MPR enforcement:
#   1. a VALID Ashwagandha collection  -> commits, mints an EPC
#   2. an OUT-OF-ZONE collection        -> ZONE_VIOLATION, does NOT commit
#   3. a WRONG-PLANT-PART collection    -> PART_VIOLATION, does NOT commit
# Run after deploy.sh. Requires jq.
###############################################################################
set -uo pipefail
FABRIC="${FABRIC_SAMPLES:-$HOME/fabric-samples}"
CHANNEL="${CHANNEL:-provenance-channel}"
cd "$FABRIC/test-network"
export PATH="$FABRIC/bin:$PATH"; export FABRIC_CFG_PATH="$FABRIC/config"
ORG="$PWD/organizations"
export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$ORG/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$ORG/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051

invoke() {
  peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile "$ORG/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem" \
    -C "$CHANNEL" -n ayurledger \
    --peerAddresses localhost:7051 --tlsRootCertFiles "$ORG/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem" \
    --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG/peerOrganizations/org2.example.com/tlsca/tlsca.org2.example.com-cert.pem" \
    -c "$(jq -n --arg a "$1" '{function:"SubmitCollection", Args:[$a]}')" --waitForEvent 2>&1
}
query() { peer chaincode query -C "$CHANNEL" -n ayurledger -c "$1" 2>&1; }

echo "### 1) VALID (zone 7) -> expect commit + EPC"
invoke '{"speciesCode":"ASWG","quantityKg":60,"plantPart":"ROOT","collectorId":"NMPB-COL-KA-8823","season":"RABI","location":{"lat":13.3409,"lon":77.1018,"altitudeM":842},"entryMethod":"TIER1_PWA","photoIpfsCID":"QmDemoA"}'
echo ""
echo "### 2) OUT-OF-ZONE (Mumbai) -> expect ZONE_VIOLATION"
invoke '{"speciesCode":"ASWG","quantityKg":20,"plantPart":"ROOT","collectorId":"NMPB-COL-KA-8823","season":"RABI","location":{"lat":19.0760,"lon":72.8777,"altitudeM":14},"entryMethod":"TIER1_PWA"}'
echo ""
echo "### 3) WRONG PART (leaf) -> expect PART_VIOLATION"
invoke '{"speciesCode":"ASWG","quantityKg":10,"plantPart":"LEAF","collectorId":"NMPB-COL-KA-8823","season":"RABI","location":{"lat":13.3409,"lon":77.1018,"altitudeM":842},"entryMethod":"TIER1_PWA"}'
echo ""
echo "### Stats + batches"
query '{"function":"Stats","Args":[]}'
query '{"function":"ListBatches","Args":[]}' | head -c 800; echo
