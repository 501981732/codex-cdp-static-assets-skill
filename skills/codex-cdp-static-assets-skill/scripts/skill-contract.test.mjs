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

test('skill defines one-authorization automated widget capture with explicit boundaries', async () => {
  const [skill, readme, readmeEnglish, boundaries, runbook, scopeConfig] = await Promise.all([
    readFile(new URL('../SKILL.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../../README.en.md', import.meta.url), 'utf8'),
    readFile(new URL('../references/cdp-boundaries.md', import.meta.url), 'utf8'),
    readFile(new URL('../references/workshop-runbook.md', import.meta.url), 'utf8'),
    readFile(new URL('../references/scope-config.md', import.meta.url), 'utf8'),
  ]);
  const combined = [skill, readme, readmeEnglish, boundaries, runbook, scopeConfig].join('\n');
  const allowedOperations = boundaries.match(/## Allowed operations([\s\S]*?)(?=\n## |$)/)?.[1] || '';

  for (const required of [
    'take_snapshot',
    'click',
    'drag',
    'fill',
    'press_key',
    'single consolidated authorization',
    'editor-mounted',
    'viewport-visible',
    'config-opened',
    'data-bound',
    'preview-visible',
    'component-assets.json',
    'text/html',
    'body-unavailable',
  ]) {
    assert.equal(combined.includes(required), true, `missing automated capture contract: ${required}`);
  }

  for (const requiredBoundary of [
    'Never use `evaluate_script`',
    'Never set `requestFilePath`',
    'never refetch',
    'unknown host',
  ]) {
    assert.equal(combined.includes(requiredBoundary), true, `missing workflow boundary: ${requiredBoundary}`);
  }

  for (const allowedTool of ['take_snapshot', 'click', 'drag', 'fill', 'press_key']) {
    assert.equal(allowedOperations.includes(allowedTool), true, `allowed operations omit ${allowedTool}`);
  }
  for (const prohibitedTool of ['evaluate_script', 'requestFilePath']) {
    assert.equal(allowedOperations.includes(prohibitedTool), false, `prohibited tool appears in allowed operations: ${prohibitedTool}`);
  }

  const affirmativeCheckpointRequirements = [];
  for (const document of [skill, readme, readmeEnglish, runbook]) {
    const headings = [...document.matchAll(/^#{2,6}\s+(.+)$/gm)];
    const sections = headings.map((heading, index) => ({
      title: heading[1],
      body: document.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? document.length),
    }));
    for (const section of sections) {
      if (/(?:manual|passive|人工|被动)/i.test(section.title)) continue;
      for (const match of section.body.matchAll(/P[12]\s*(?:完成|complete)/gi)) {
        const preceding = section.body.slice(Math.max(0, match.index - 100), match.index);
        if (/(?:无需|不再|不得|禁止|does not|do not|never|no longer)[^\n]{0,80}$/i.test(preceding)) continue;
        affirmativeCheckpointRequirements.push(`${section.title}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(
    affirmativeCheckpointRequirements,
    [],
    `normal flow still requires per-widget confirmation: ${affirmativeCheckpointRequirements.join(' | ')}`,
  );
});
