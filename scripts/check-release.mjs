import { access, readFile } from 'node:fs/promises';

const releaseAssets = ['main.js', 'styles.css', 'manifest.json'];

await Promise.all(releaseAssets.map((asset) => access(asset)));

const bundle = await readFile('main.js', 'utf8');
const dynamicScriptPatterns = [
  /\.createElement\(\s*["'`]script["'`]\s*\)/g,
  /\.createElementNS\([^)]*,\s*["'`]script["'`]\s*\)/g,
  /\.createEl\(\s*["'`]script["'`]/g,
];

const findings = dynamicScriptPatterns.flatMap((pattern) => bundle.match(pattern) ?? []);

if (findings.length > 0) {
  throw new Error(
    `Release bundle contains ${findings.length} dynamic <script> element creation(s).`,
  );
}

console.log(`Release checks passed for ${releaseAssets.join(', ')}.`);
