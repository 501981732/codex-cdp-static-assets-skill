import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('skill uses autoConnect as its only Chrome connection path', async () => {
  const files = await Promise.all([
    readFile(new URL('../SKILL.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.en.md', import.meta.url), 'utf8'),
    readFile(new URL('../references/mcp-autoconnect.md', import.meta.url), 'utf8'),
  ]);
  const combined = files.join('\n');
  for (const required of ['--autoConnect', 'chrome://inspect/#remote-debugging', 'list_network_requests', 'get_network_request', 'import-mcp-response.mjs']) {
    assert.equal(combined.includes(required), true, `missing autoConnect requirement: ${required}`);
  }
  for (const removed of ['127.0.0.1:9222', '--remote-debugging-port', 'capture-static-assets.mjs']) {
    assert.equal(combined.includes(removed), false, `legacy connection path remains: ${removed}`);
  }
});

test('skill keeps the passive capture boundary and operator checkpoints', async () => {
  const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  for (const required of ['never refetch', 'Never set `requestFilePath`', 'body-unavailable', 'P1 完成', '全部完成']) {
    assert.equal(`${skill}\n${readme}`.includes(required), true, `missing workflow boundary: ${required}`);
  }
});
