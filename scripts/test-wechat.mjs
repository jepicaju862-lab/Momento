// Bundles the WeChat candidate and bridge tests with an `obsidian` stub and runs them with node:test.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('.test-out', { recursive: true });
const outputs = [];
for (const name of ['wechat-candidates', 'wechat-bridge']) {
	const outfile = `.test-out/${name}.test.cjs`;
	await build({
		entryPoints: [`scripts/${name}.test.ts`],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node18',
		alias: { obsidian: resolve('scripts/obsidian-stub.ts') },
		logLevel: 'warning',
	});
	outputs.push(outfile);
}
const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
process.exit(result.status ?? 1);
