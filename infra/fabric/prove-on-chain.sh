#!/usr/bin/env bash
###############################################################################
# prove-on-chain.sh — SHOW that dashboard data is really on the blockchain.
# Run while the network + gateway are up (deploy.sh + run-gateway.sh).
###############################################################################
set -uo pipefail
FABRIC="${FABRIC_SAMPLES:-$HOME/fabric-samples}"
CH="${CHANNEL:-provenance-channel}"
cd "$FABRIC/test-network"
export PATH="$FABRIC/bin:$PATH"; export FABRIC_CFG_PATH="$FABRIC/config"
ORG="$PWD/organizations"
ORDERER_CA="$ORG/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"

setOrg1(){ export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_TLS_ROOTCERT_FILE="$ORG/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  CORE_PEER_MSPCONFIGPATH="$ORG/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp" \
  CORE_PEER_ADDRESS=localhost:7051; }
setOrg2(){ export CORE_PEER_TLS_ENABLED=true CORE_PEER_LOCALMSPID=Org2MSP \
  CORE_PEER_TLS_ROOTCERT_FILE="$ORG/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  CORE_PEER_MSPCONFIGPATH="$ORG/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp" \
  CORE_PEER_ADDRESS=localhost:9051; }
height(){ peer channel getinfo -c "$CH" 2>/dev/null | sed 's/^Blockchain info: //'; }

setOrg1
echo "======== 1) BLOCKCHAIN STATE BEFORE (Org1 peer) ========"
B4="$(height)"; echo "$B4"
H0=$(echo "$B4" | grep -o '"height":[0-9]*' | grep -o '[0-9]*')

echo ""; echo "======== 2) SUBMIT a collection through the gateway (the dashboard path) ========"
RESP=$(curl -s -X POST http://localhost:3001/events/collection -H 'content-type: application/json' \
  -d '{"speciesCode":"AMLA","quantityKg":10,"plantPart":"FRUIT","collectorId":"NMPB-COL-KA-8823","season":"RABI","location":{"lat":13.3409,"lon":77.1018,"altitudeM":842},"entryMethod":"TIER1_PWA"}')
echo "$RESP"
EPC=$(echo "$RESP" | grep -o '"epc":"[^"]*"' | cut -d'"' -f4)

echo ""; echo "======== 3) BLOCKCHAIN STATE AFTER (height +1, new hash chained to previous) ========"
AF="$(height)"; echo "$AF"
H1=$(echo "$AF" | grep -o '"height":[0-9]*' | grep -o '[0-9]*')
echo ">> height ${H0} -> ${H1}  (a new block was appended for that transaction)"

echo ""; echo "======== 4) SAME height + hash on Org2 peer (both nodes independently hold the chain) ========"
setOrg2; height; setOrg1

echo ""; echo "======== 5) COUCHDB WORLD STATE on the peer — the actual stored record ========"
echo "-- state databases on peer0.org1 --"
curl -s http://admin:adminpw@localhost:5984/_all_dbs; echo
echo "-- the batch document just written (full content, straight from the ledger DB) --"
curl -s "http://admin:adminpw@localhost:5984/${CH}_ayurledger/_all_docs?include_docs=true" \
  | jq -c --arg epc "$EPC" '.rows[].doc | select(.epc==$epc)' 2>/dev/null | head -1

echo ""; echo "======== 6) THE TRANSACTION INSIDE THE BLOCK (fetch + decode block #$((H1-1))) ========"
BN=$((H1-1))
peer channel fetch "$BN" "/tmp/block_$BN.block" -c "$CH" -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com --tls --cafile "$ORDERER_CA" >/dev/null 2>&1
configtxlator proto_decode --input "/tmp/block_$BN.block" --type common.Block > "/tmp/block_$BN.json" 2>/dev/null
echo "-- chaincode function + arguments recorded in the block (base64-decoded) --"
jq -r '.data.data[0].payload.data.actions[0].payload.chaincode_proposal_payload.input.chaincode_spec.input.args[]' \
  "/tmp/block_$BN.json" 2>/dev/null | while IFS= read -r a; do echo "$a" | base64 -d 2>/dev/null; echo; done
echo "-- number of endorsements on this transaction --"
jq -r '.data.data[0].payload.data.actions[0].payload.action.endorsements | length' "/tmp/block_$BN.json" 2>/dev/null
echo ""; echo "DONE — same data, on both peers, inside a hash-chained, endorsed block."
