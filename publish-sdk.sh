#!/usr/bin/env bash
set -e

if [ -z "$NPM_TOKEN" ]; then
  echo "Error: NPM_TOKEN environment variable is not set."
  echo "Please export a GitHub PAT with read:packages and write:packages permissions."
  echo "Example: export NPM_TOKEN=ghp_xxxxxxxxxxxx"
  exit 1
fi

ORG="cloudbitsolutions-zara"
OLD_SCOPE="@kilocode"
NEW_SCOPE="@$ORG"

echo "Building SDK packages..."
bun turbo run build --filter=@kilocode/sdk --filter=@kilocode/zara-ui

# Temporary `.npmrc` for authentication
echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" > .npmrc
echo "@${ORG}:registry=https://npm.pkg.github.com" >> .npmrc

echo "Dynamically rewriting scope from $OLD_SCOPE to $NEW_SCOPE..."

# Helper function to replace scope in package.json
replace_scope() {
  local package_dir=$1
  if [ -f "$package_dir/package.json" ]; then
    # Create backup
    cp "$package_dir/package.json" "$package_dir/package.json.bak"
    # Replace the scope in the file
    sed -i '' "s/\"name\": \"$OLD_SCOPE\//\"name\": \"$NEW_SCOPE\//g" "$package_dir/package.json"
    # Also replace dependencies that point to internal packages (e.g. workspace dependencies)
    sed -i '' "s/\"$OLD_SCOPE\//\"$NEW_SCOPE\//g" "$package_dir/package.json"
  fi
}

restore_scope() {
  local package_dir=$1
  if [ -f "$package_dir/package.json.bak" ]; then
    mv "$package_dir/package.json.bak" "$package_dir/package.json"
  fi
}

PACKAGES=("packages/sdk" "packages/zara-ui")

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
rm .npmrc

echo "Successfully published to GitHub Packages!"
