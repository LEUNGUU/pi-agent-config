import { spawnSync } from 'node:child_process';

const key = process.env.EXA_API_KEY;
const redact = (text) => key ? text.replaceAll(key, '<redacted>').replaceAll(JSON.stringify(key).slice(1, -1), '<redacted>') : text;
function fail(message) {
	console.error(redact(message).slice(0, 1000));
	process.exit(1);
}

const [query, ...extra] = process.argv.slice(2);
if (!query?.trim() || extra.length) fail('Usage: node exa-search.mjs "query"');
if (!key || /[\x00-\x1f\x7f]/.test(key)) fail('Set a valid EXA_API_KEY environment variable before searching.');

// shortcut: auto mode and five results; add controls only when a caller needs a different search.
const payload = { query, type: 'auto', numResults: 5, contents: { highlights: true } };
const config = [
	'url = "https://api.exa.ai/search"',
	'request = "POST"',
	'header = ' + JSON.stringify('x-api-key: ' + key),
	'header = "Content-Type: application/json"',
	'data = ' + JSON.stringify(JSON.stringify(payload)),
	'write-out = ' + JSON.stringify('\n%{http_code}'),
].join('\n') + '\n';

// curl works here where Node fetch timed out; stdin keeps the key out of process arguments.
const result = spawnSync('curl', ['--disable', '--silent', '--show-error', '--max-time', '30', '--config', '-'], {
	input: config,
	encoding: 'utf8',
	timeout: 35000,
	maxBuffer: 4 * 1024 * 1024,
});
if (result.error || result.status !== 0) fail(result.stderr || result.error?.message || 'curl failed.');

const boundary = result.stdout.lastIndexOf('\n');
if (boundary < 0) fail('Invalid curl response: HTTP status missing.');
const body = result.stdout.slice(0, boundary);
const status = result.stdout.slice(boundary + 1).trim();
if (status !== '200') fail('Exa HTTP ' + status + ': ' + body);

let data;
try { data = JSON.parse(body); } catch { fail('Invalid Exa response: expected JSON.'); }
if (!Array.isArray(data?.results)) fail('Invalid Exa response: results array missing.');
process.stdout.write(redact(body) + '\n');
