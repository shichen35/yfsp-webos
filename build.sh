#!/usr/bin/env bash
#
# Build + package .ipk (and its Homebrew Channel manifest) into out/
#
#   bash build.sh                 # local build, placeholder version 1.0.0
#   VERSION=1.0.2 bash build.sh   # what the release workflow runs
#
# The real version lives in the git tag (v1.0.2) that triggers
# .github/workflows/release.yml; the version fields checked into appinfo.json
# and both package.json files are placeholders. VERSION is synced into all
# three before packaging, so the .ipk filename, the webOS-reported version and
# the in-app "版本" label (__APP_VERSION__) always match.
VERSION="${VERSION:-1.0.0}"

set -euo pipefail
cd "$(dirname "$0")"

# 1. Sync VERSION into webOS metadata and the service manifest.
node - "$VERSION" <<'EOF'
const fs = require('fs');
const version = process.argv[2];
for (const file of [
  'app/webos-meta/appinfo.json',
  'service/com.yfsp.app.service/package.json',
]) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}
EOF
# npm version also keeps package-lock.json in step.
(cd app && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)

# 2. Frontend build (target chrome108, base './' — see app/vite.config.js).
(cd app && npm run build)

# 3. Merge webOS metadata (appinfo.json + icons) into the build output, and
#    ship the third-party license notices inside the package.
cp -r app/webos-meta/. app/dist/
cp THIRD_PARTY_NOTICES.md app/dist/

# 4. Package app + service into a single .ipk. ares-package comes from the
#    @webos-tools/cli dev dependency in app/, so npm ci is all CI needs.
mkdir -p out
app/node_modules/.bin/ares-package --no-minify app/dist service/com.yfsp.app.service -o out

IPK="out/com.yfsp.app_${VERSION}_all.ipk"
echo "packaged: ${IPK}"

# 5. Homebrew Channel-style manifest, uploaded next to the .ipk by the release
#    workflow. ipkUrl points at the release asset of tag v$VERSION.
REPO="${GITHUB_REPOSITORY:-shichen35/yfsp-webos}"
node - "$IPK" "$VERSION" "$REPO" <<'EOF'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [ipk, version, repo] = process.argv.slice(2);
const app = JSON.parse(fs.readFileSync('app/webos-meta/appinfo.json', 'utf8'));
const buf = fs.readFileSync(ipk);
const manifest = {
  id: app.id,
  version,
  type: app.type,
  title: app.title,
  iconUri: `https://raw.githubusercontent.com/${repo}/main/app/webos-meta/largeIcon.png`,
  sourceUrl: `https://github.com/${repo}`,
  rootRequired: false,
  ipkUrl: `https://github.com/${repo}/releases/download/v${version}/${path.basename(ipk)}`,
  ipkSize: buf.length,
  ipkHash: { sha256: crypto.createHash('sha256').update(buf).digest('hex') },
};
const out = `out/${app.id}.manifest.json`;
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${out}`);
EOF
