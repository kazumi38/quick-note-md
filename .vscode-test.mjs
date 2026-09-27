import { defineConfig } from '@vscode/test-cli';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: dirname(fileURLToPath(import.meta.url)),
	mocha: { timeout: 15000 },
});
