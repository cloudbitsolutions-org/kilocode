const fs = require('fs');

const ORG = 'cloudbitsolutions-org';
const PACKAGES = [
  'sdk',
  'zara-ui',
  'kilo-console',
  'cli-linux-arm64',
  'cli-linux-x64'
];

async function run() {
  const token = process.env.NPM_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  
  if (!token) {
    console.error("Error: NPM_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable is not set.");
    console.error("Please export a GitHub PAT with read:packages and delete:packages permissions.");
    process.exit(1);
  }

  for (const pkgName of PACKAGES) {
    console.log(`\nFetching versions for @${ORG}/${pkgName}...`);
    const url = `https://api.github.com/orgs/${ORG}/packages/npm/${pkgName}/versions`;
    
    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!res.ok) {
        if (res.status === 404) {
          console.log(`Package ${pkgName} not found or no versions exist.`);
          continue;
        }
        console.error(`Failed to fetch versions for ${pkgName}: ${res.status}`);
        const text = await res.text();
        console.error(text);
        continue;
      }

      const versions = await res.json();
      
      if (versions.length === 0) {
        console.log(`No versions found for ${pkgName}.`);
        continue;
      }

      console.log(`Found ${versions.length} versions for ${pkgName}. Deleting...`);
      
      for (const version of versions) {
        console.log(`  Deleting version ${version.name} (ID: ${version.id})...`);
        const delUrl = `${url}/${version.id}`;
        
        const delRes = await fetch(delUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });

        if (delRes.ok || delRes.status === 204) {
          console.log(`  ✓ Successfully deleted version ${version.name}.`);
        } else {
          console.error(`  ✗ Failed to delete version ${version.name}: ${delRes.status}`);
          const text = await delRes.text();
          console.error(`    ${text}`);
        }
      }
    } catch (error) {
      console.error(`Error processing ${pkgName}:`, error);
    }
  }
}

run();
