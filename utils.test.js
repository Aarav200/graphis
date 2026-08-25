// tests/utils.test.js
// Run with: node --test
// Uses Node's built-in test runner (Node 18+) — no npm install required,
// which matters for this project since the whole point of the stack is
// zero-dependency, zero-build-step deployment.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowedFileType,
  extractCodeSymbols,
  cosineSimilarity,
  cryptoRandomId,
  escapeHtml
} = require("../utils.js");

test("isAllowedFileType accepts every documented extension", () => {
  ["paper.pdf", "notes.md", "script.py", "app.js", "types.ts", "comp.jsx", "comp.tsx"]
    .forEach(name => assert.equal(isAllowedFileType(name), true, name));
});

test("isAllowedFileType rejects unsupported extensions", () => {
  ["archive.zip", "image.png", "data.csv", "noextension"]
    .forEach(name => assert.equal(isAllowedFileType(name), false, name));
});

test("extractCodeSymbols parses Python def/class/import", () => {
  const src = `import os\nfrom collections import Counter\n\nclass Parser:\n    def run(self):\n        pass\n\ndef helper():\n    pass\n`;
  const result = extractCodeSymbols(src, "py");
  assert.deepEqual(result.functions.sort(), ["helper", "run"].sort());
  assert.deepEqual(result.classes, ["Parser"]);
  // The regex matches both "from X" and "import Y" tokens independently,
  // so "from collections import Counter" yields both names — that's
  // intentional (it still surfaces Counter as a used symbol).
  assert.deepEqual(result.imports.sort(), ["Counter", "collections", "os"].sort());
});

test("extractCodeSymbols parses JS function/class/import", () => {
  const src = `import React from 'react';\nimport { useState } from 'react';\n\nclass Widget {}\n\nfunction useThing() {}\n`;
  const result = extractCodeSymbols(src, "js");
  assert.deepEqual(result.functions, ["useThing"]);
  assert.deepEqual(result.classes, ["Widget"]);
  assert.deepEqual(result.imports, ["react", "react"]);
});

test("extractCodeSymbols returns empty arrays for unsupported extensions", () => {
  const result = extractCodeSymbols("anything", "pdf");
  assert.deepEqual(result, { functions: [], classes: [], imports: [] });
});

test("cosineSimilarity of identical vectors is 1", () => {
  const v = [1, 2, 3];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
});

test("cosineSimilarity of orthogonal vectors is 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity handles missing, empty, or mismatched-length input safely", () => {
  assert.equal(cosineSimilarity(null, [1, 2]), 0);
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
});

test("cryptoRandomId returns unique-looking, non-empty ids", () => {
  const a = cryptoRandomId();
  const b = cryptoRandomId();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test("escapeHtml neutralizes all HTML-significant characters", () => {
  assert.equal(
    escapeHtml(`<script>alert("x")</script>&'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;"
  );
});

test("escapeHtml is a no-op on plain text", () => {
  assert.equal(escapeHtml("Aditi Rao"), "Aditi Rao");
});
