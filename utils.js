// utils.js
// Pure, framework-free helper functions shared by the browser app (app.js)
// and the Node test suite (tests/utils.test.js). No build step required:
// loaded via <script> in the browser, and via require() under Node.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".md", ".py", ".js", ".ts", ".jsx", ".tsx"];

  function isAllowedFileType(filename) {
    const ext = "." + String(filename).split(".").pop().toLowerCase();
    return ALLOWED_UPLOAD_EXTENSIONS.includes(ext);
  }

  function extractCodeSymbols(text, ext) {
    const symbols = { functions: [], classes: [], imports: [] };
    if (["py"].includes(ext)) {
      symbols.functions = [...text.matchAll(/def\s+(\w+)/g)].map(m => m[1]);
      symbols.classes = [...text.matchAll(/class\s+(\w+)/g)].map(m => m[1]);
      symbols.imports = [...text.matchAll(/(?:import|from)\s+([\w.]+)/g)].map(m => m[1]);
    } else if (["js", "ts", "jsx", "tsx"].includes(ext)) {
      symbols.functions = [...text.matchAll(/function\s+(\w+)/g)].map(m => m[1]);
      symbols.classes = [...text.matchAll(/class\s+(\w+)/g)].map(m => m[1]);
      symbols.imports = [...text.matchAll(/import .*?from\s+['"](.+?)['"]/g)].map(m => m[1]);
    }
    return symbols;
  }

  function cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  function cryptoRandomId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  return {
    ALLOWED_UPLOAD_EXTENSIONS,
    isAllowedFileType,
    extractCodeSymbols,
    cosineSimilarity,
    cryptoRandomId,
    escapeHtml
  };
});
