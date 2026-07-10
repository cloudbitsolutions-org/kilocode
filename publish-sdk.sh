#!/usr/bin/env bash
set -e

if [ -z "$NPM_TOKEN" ]; then
  echo "Error: NPM_TOKEN environment variable is not set."
  echo "Please export a GitHub PAT with read:packages and write:packages permissions."
  echo "Example: export NPM_TOKEN=ghp_xxxxxxxxxxxx"
  exit 1
fi

ORG="cloudbitsolutions-org"
OLD_SCOPE="@kilocode"
NEW_SCOPE="@$ORG"

echo "Building SDK packages..."
export KILO_CONSOLE_BASE="/console/"
export KILO_ASSISTANT_UI_BASE="/assistant-ui/"
bun turbo run build --filter=@kilocode/sdk --filter=@kilocode/zara-ui --filter=@kilocode/kilo-console

echo "Building CLI binary packages (this may take a minute)..."
(cd packages/opencode && bun run script/build.ts)

# Temporary `.npmrc` for authentication
echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > ~/.npmrc
echo "@${ORG}:registry=https://npm.pkg.github.com" >> ~/.npmrc

echo "Dynamically rewriting scope from $OLD_SCOPE to $NEW_SCOPE..."

# Helper function to replace scope in package.json
replace_scope() {
  local package_dir=$1
  if [ -f "$package_dir/package.json" ]; then
    # Create backup
    cp "$package_dir/package.json" "$package_dir/package.json.bak"
    # Process dependencies (remove workspace:*, resolve catalog:)
    node -e "
      const fs = require('fs');
      const file = '$package_dir/package.json';
      const rootFile = 'package.json';
      const pkg = JSON.parse(fs.readFileSync(file));
      const rootPkg = JSON.parse(fs.readFileSync(rootFile));
      const catalog = rootPkg.workspaces?.catalog || {};
      function resolveDeps(deps) {
        if (!deps) return;
        for (const dep in deps) {
          if (deps[dep].startsWith('workspace:')) {
            delete deps[dep];
          } else if (deps[dep] === 'catalog:') {
            deps[dep] = catalog[dep] || '*';
          }
        }
      }
      resolveDeps(pkg.dependencies);
      resolveDeps(pkg.devDependencies);
      resolveDeps(pkg.peerDependencies);
      pkg.private = false;
      if (pkg.repository && typeof pkg.repository === 'object') {
        pkg.repository.url = 'git+https://github.com/cloudbitsolutions-org/kilocode.git';
      } else if (typeof pkg.repository === 'string') {
        pkg.repository = 'git+https://github.com/cloudbitsolutions-org/kilocode.git';
      }
      let newContent = JSON.stringify(pkg, null, 2);
      newContent = newContent.replace(/\"name\": \"$OLD_SCOPE\//g, '\"name\": \"$NEW_SCOPE\/');
      newContent = newContent.replace(/\"$OLD_SCOPE\//g, '\"$NEW_SCOPE\/');
      fs.writeFileSync(file, newContent);
    "
  fi
}

restore_scope() {
  local package_dir=$1
  if [ -f "$package_dir/package.json.bak" ]; then
    mv "$package_dir/package.json.bak" "$package_dir/package.json"
  fi
}

PACKAGES=(
  "packages/sdk/js"
  "packages/zara-ui"
  "packages/kilo-console"
  "packages/opencode/dist/@kilocode/cli-linux-arm64"
  "packages/opencode/dist/@kilocode/cli-linux-x64"
)

# Rename scopes
for pkg in "${PACKAGES[@]}"; do
  replace_scope "$pkg"
done

# Publish
for pkg in "${PACKAGES[@]}"; do
  echo "Publishing $pkg..."
  cd "$pkg"
  npm publish --registry=https://npm.pkg.github.com
  cd -
done

# Restore original scopes
for pkg in "${PACKAGES[@]}"; do
  restore_scope "$pkg"
done

# Clean up .npmrc
rm ~/.npmrc

echo "Successfully published to GitHub Packages!"
