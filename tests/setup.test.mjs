import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../setup.sh', import.meta.url));

for (const [name, processes, running, psExit] of [
	['Otty app path', '/Applications/Otty.app/Contents/MacOS/Otty', true, 0],
	['Otty app path with spaces', '/Volumes/Test Apps/Otty.app/Contents/MacOS/Otty', true, 0],
	['bare process name', 'Otty', true, 0],
	['lowercase process name', 'otty', true, 0],
	['no Otty app', '/bin/zsh\n/Applications/Otty.app/Contents/MacOS/otty-cli', false, 0],
	['failed process listing', '', false, 7],
]) test('setup protects Otty config: ' + name, () => {
	const dir = mkdtempSync(join(tmpdir(), 'pi-setup-test-'));
	const repo = join(dir, 'repo');
	const home = join(dir, 'home');
	const bin = join(dir, 'bin');
	const config = join(home, '.config/otty/config.toml');
	const theme = join(home, '.config/otty/themes/test.ottytheme');
	try {
		for (const path of [bin, join(repo, 'agents'), join(repo, 'otty/themes'), join(home, '.config/otty/themes')]) {
			mkdirSync(path, { recursive: true });
		}
		copyFileSync(script, join(repo, 'setup.sh'));
		for (const [path, content] of [
			['settings.json', '{}'], ['AGENTS.md', 'Test rules'],
			['agents/test.md', 'Test agent'], ['models.json', '{}'],
			['otty/config.toml', 'theme = "repo"\n'],
			['otty/themes/test.ottytheme', 'repo theme'],
		]) writeFileSync(join(repo, path), content);
		writeFileSync(config, 'theme = "current"\n');
		writeFileSync(theme, 'current theme');
		writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "%s\\n" "$MOCK_PROCESSES"\nexit "$MOCK_PS_EXIT"\n', { mode: 0o700 });
		writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
		// Keep real installers out of PATH; only the temporary home can change.
		const result = spawnSync('/bin/bash', [join(repo, 'setup.sh')], {
			encoding: 'utf8', timeout: 10000,
			env: { ...process.env, HOME: home, PATH: bin + ':/usr/bin:/bin',
				MOCK_PROCESSES: processes, MOCK_PS_EXIT: String(psExit) },
		});
		assert.ifError(result.error);
		assert.equal(result.status, psExit, result.stderr);
		if (running || psExit) {
			assert.equal(readFileSync(config, 'utf8'), 'theme = "current"\n');
			assert.equal(readFileSync(theme, 'utf8'), 'current theme');
			assert.equal(existsSync(config + '.bak'), false);
			if (running) assert.match(result.stdout, /Otty is running — skipped config\.toml/);
		} else {
			assert.equal(readFileSync(config, 'utf8'), 'theme = "repo"\n');
			assert.equal(readFileSync(config + '.bak', 'utf8'), 'theme = "current"\n');
			assert.equal(readFileSync(theme, 'utf8'), 'repo theme');
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
