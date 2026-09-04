#!/usr/bin/env bash
###############################################################################
# build-package.sh — produce a self-contained Chaincode-as-a-Service package
# for the ayurledger chaincode, ready to deploy to a Hyperledger Fabric peer.
#
# WHY THIS EXISTS
#   chaincode/ayurledger imports @ayurtrace/contracts and @ayurtrace/seed via
#   local `file:` deps that do NOT exist inside a Fabric build container, and it
#   is authored ESM while the Fabric v2.5 chaincode runtime is Node 18 (no
#   require(ESM)). This script vendors those two packages and compiles the whole
#   thing to CommonJS so the package is fully standalone.
#
#   It also patches ONE line for on-peer execution: contract.ts imports Context
#   as `import type` (erased), which makes fabric-contract-api miscount the
#   injected ctx as a client parameter ("Expected 1 parameters, but 0 supplied").
#   We rewrite it to a value import so emitDecoratorMetadata records the real
#   Context class and the framework filters it out. Original source is untouched.
#
# OUTPUT: $HOME/ayurledger-cc  (dist + vendored deps + Dockerfile + package.json)
# USAGE : ./build-package.sh [path-to-ayurtrace-repo]   (default: ../../ of this file)
###############################################################################
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:-$(cd "$HERE/../.." && pwd)}"
OUT="$HOME/ayurledger-cc"
# Prefer a global/local `tsc` (fast); fall back to npx if none is installed.
# Install a global one once with:  sudo npm install -g typescript@5.6.3
TSC="$(command -v tsc || echo 'npx -y -p typescript@5.6.3 tsc')"

echo "REPO=$REPO"
echo "OUT =$OUT"
[ -d "$REPO/chaincode/ayurledger/src" ] || { echo "chaincode source not found under $REPO"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT/vendor/contracts" "$OUT/vendor/seed"

cjs_tsconfig() { # $1=rootdir-less package dir ; writes a NodeNext->CJS tsconfig
  cat > "$1/tsconfig.json" <<EOF
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
  "outDir": "dist", "rootDir": "src", "declaration": true, "esModuleInterop": true,
  "skipLibCheck": true, "strict": false ${2:-} }, "include": ["src/**/*"] }
EOF
}

echo "### 1) @ayurtrace/contracts -> CJS"
cp -r "$REPO/packages/contracts/src" "$OUT/vendor/contracts/src"
echo '{ "name":"@ayurtrace/contracts","version":"1.0.0","type":"commonjs","main":"dist/index.js","types":"dist/index.d.ts","license":"MIT" }' > "$OUT/vendor/contracts/package.json"
cjs_tsconfig "$OUT/vendor/contracts"
( cd "$OUT/vendor/contracts" && $TSC -p tsconfig.json >/dev/null 2>&1; )
test -f "$OUT/vendor/contracts/dist/index.js" || { echo "FAIL contracts build"; exit 1; }

echo "### 2) @ayurtrace/seed -> CJS"
cp -r "$REPO/seed/src" "$OUT/vendor/seed/src"
echo '{ "name":"@ayurtrace/seed","version":"1.0.0","type":"commonjs","main":"dist/index.js","types":"dist/index.d.ts","license":"MIT" }' > "$OUT/vendor/seed/package.json"
cjs_tsconfig "$OUT/vendor/seed" ', "baseUrl":".", "paths": { "@ayurtrace/contracts": ["../contracts/src/index.ts"] }'
( cd "$OUT/vendor/seed" && $TSC -p tsconfig.json >/dev/null 2>&1; )
test -f "$OUT/vendor/seed/dist/index.js" || { echo "FAIL seed build"; exit 1; }

echo "### 3) chaincode -> CJS (with Context value-import patch)"
cp -r "$REPO/chaincode/ayurledger/src" "$OUT/src"
# --- the one-line on-peer fix (see header) ---
sed -i "s#^import type { Context } from 'fabric-contract-api';#import { Context } from 'fabric-contract-api';#" "$OUT/src/contract.ts"

cat > "$OUT/package.json" <<'EOF'
{
  "name": "ayurledger",
  "version": "1.0.0",
  "description": "AyurTrace MPR chaincode - EPCIS 2.0 enforcement for Hyperledger Fabric v2.5.",
  "type": "commonjs",
  "main": "dist/index.js",
  "engines": { "node": ">=16" },
  "scripts": {
    "start": "fabric-chaincode-node start",
    "start:server": "fabric-chaincode-node server --chaincode-address=$CHAINCODE_SERVER_ADDRESS --chaincode-id=$CHAINCODE_ID"
  },
  "dependencies": {
    "@ayurtrace/contracts": "file:./vendor/contracts",
    "@ayurtrace/seed": "file:./vendor/seed",
    "fabric-contract-api": "^2.5.4",
    "fabric-shim": "^2.5.4"
  },
  "license": "MIT"
}
EOF
cat > "$OUT/tsconfig.json" <<'EOF'
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
  "outDir": "dist", "rootDir": "src", "declaration": false, "strict": false, "esModuleInterop": true,
  "skipLibCheck": true, "experimentalDecorators": true, "emitDecoratorMetadata": true,
  "forceConsistentCasingInFileNames": true, "baseUrl": ".",
  "paths": { "@ayurtrace/contracts": ["./vendor/contracts/src/index.ts"], "@ayurtrace/seed": ["./vendor/seed/src/index.ts"] } },
  "include": ["src/**/*"] }
EOF

# Dockerfile for Chaincode-as-a-Service (server mode)
cat > "$OUT/Dockerfile" <<'EOF'
ARG CC_SERVER_PORT=9999
FROM node:18.20-bullseye-slim
WORKDIR /usr/src/app
COPY package.json ./
COPY vendor ./vendor
RUN npm install --omit=dev --no-audit --no-fund
COPY dist ./dist
ENV CC_SERVER_PORT=${CC_SERVER_PORT}
EXPOSE ${CC_SERVER_PORT}
CMD ["npm", "run", "start:server"]
EOF
printf 'node_modules\nsrc\ntsconfig.json\n.git\n' > "$OUT/.dockerignore"

( cd "$OUT" && npm install --no-audit --no-fund >/dev/null 2>&1; )
( cd "$OUT" && $TSC -p tsconfig.json >/dev/null 2>&1; )
test -f "$OUT/dist/index.js" || { echo "FAIL chaincode build"; exit 1; }

echo "### 4) smoke test (load + verify contract export)"
( cd "$OUT" && node -e "const m=require('./dist/index.js'); if(!Array.isArray(m.contracts)||!m.contracts.length) throw new Error('no contracts'); console.log('OK contracts=['+m.contracts.map(c=>c.name).join(',')+']');" ) || exit 1
echo "BUILD OK -> $OUT"
