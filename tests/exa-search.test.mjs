import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../skills/tavily-search/scripts/exa-search.mjs', import.meta.url));
const fakeKey = 'fake-exa-key-for-tests';
const response = { results: [{ url: 'https://example.com', highlights: ['Evidence'] }], costDollars: { total: 0.007 } };
function run(args, overrides = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'exa-search-test-'));
	const log = join(dir, 'call.json');
	writeFileSync(join(dir, 'curl'), `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
 fs.writeFileSync(process.env.MOCK_LOG, JSON.stringify({args: process.argv.slice(2), input}));
 if (process.env.MOCK_EXIT) {
  console.error(process.env.MOCK_ERROR);
  process.exit(Number(process.env.MOCK_EXIT));
 }
 process.stdout.write(process.env.MOCK_BODY + '\\n' + process.env.MOCK_STATUS);
});
`, { mode: 0o700 });
	try {
		const result = spawnSync('node', [script, ...args], {
			encoding: 'utf8', timeout: 10000,
			env: { ...process.env, PATH: dir + ':' + process.env.PATH, EXA_API_KEY: fakeKey,
				MOCK_LOG: log, MOCK_BODY: JSON.stringify(response), MOCK_STATUS: '200',
				MOCK_EXIT: '', MOCK_ERROR: '', ...overrides },
		});
		assert.ifError(result.error);
		return { ...result, call: existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : null };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('uses direct HTTPS, bounded search, and credentials only through stdin', () => {
	const query = '中文 "quoted" query\nwith another line';
	const result = run([query]);
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), response);
	assert(!JSON.stringify(result.call.args).includes(fakeKey));
	assert.equal(result.call.args[0], '--disable');
	assert(!result.call.args.includes('--insecure'));
	assert(!result.call.args.includes('--location'));
	assert(result.call.input.includes('https://api.exa.ai/search'));
	assert(result.call.input.includes('x-api-key: ' + fakeKey));
	const line = result.call.input.split('\n').find(x => x.startsWith('data = '));
	assert.deepEqual(JSON.parse(JSON.parse(line.slice(7))), { query, type: 'auto', numResults: 5, contents: { highlights: true } });
});

for (const [name, args, env] of [
	['missing key', ['query'], { EXA_API_KEY: '' }],
	['invalid key', ['query'], { EXA_API_KEY: 'invalid\r\nheader' }],
	['control character in key', ['query'], { EXA_API_KEY: 'invalid\x01key' }],
	['empty query', ['   '], {}],
	['extra arguments', ['one', 'two'], {}],
]) test('rejects ' + name + ' without invoking curl', () => {
	const result = run(args, env);
	assert.equal(result.status, 1);
	assert.equal(result.call, null);
	assert.equal(result.stdout, '');
});

test('reports HTTP failures without exposing credentials', () => {
	const result = run(['query'], { MOCK_STATUS: '401', MOCK_BODY: JSON.stringify({ error: 'Rejected ' + fakeKey }) });
	assert.equal(result.status, 1);
	assert.equal(result.stdout, '');
	assert(result.stderr.includes('Exa HTTP 401'));
	assert(result.stderr.includes('<redacted>'));
	assert(!result.stderr.includes(fakeKey));
});

test('reports curl failures without exposing credentials', () => {
	const result = run(['query'], { MOCK_EXIT: '7', MOCK_ERROR: 'Connection failed ' + fakeKey });
	assert.equal(result.status, 1);
	assert(!result.stderr.includes(fakeKey));
	assert.equal(result.stdout, '');
});

for (const body of ['not JSON', 'null', '{}']) test('rejects malformed response ' + body, () => {
	const result = run(['query'], { MOCK_BODY: body });
	assert.equal(result.status, 1);
	assert.equal(result.stdout, '');
	assert(result.stderr.includes('Invalid Exa response'));
});

test('returns empty results without inventing hits', () => {
	const result = run(['query'], { MOCK_BODY: '{"results":[]}' });
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), { results: [] });
});
