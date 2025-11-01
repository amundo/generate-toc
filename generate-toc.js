// generate-toc.js
// Run with:
//   deno run --allow-read --allow-write --allow-env generate-toc.js
//
// Examples:
//   deno run -A generate-toc.js
//   deno run -A generate-toc.js --no-global
//
// Exclude files:
//   Global:  ~/.generate-toc-exclude
//   Local:   ./.generate-toc-exclude
//
// Rules:
//  - Lines starting with # are comments; blank lines are ignored
//  - Globs supported (**, *, ?, [set]) via std/path.globToRegExp
//  - Later rules override earlier ones
//  - Prefix a rule with '!' to re-include (negate) a prior match

import { join, relative, posix, globToRegExp } from "jsr:@std/path";

const VERSION = "v0.1.0";

// ---------------- CLI ----------------
function parseArgs(args) {
  const out = { noGlobal: false, root: "." };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-global") out.noGlobal = true;
    else out.root = a;
  }
  return out;
}

// ---------------- Exclude rules ----------------
function readLinesIfExists(path) {
  try {
    return Deno.readTextFileSync(path).split(/\r?\n/);
  } catch {
    return [];
  }
}

function loadExcludeRules({ noGlobal, rootDir }) {
  const rules = [];

  const localPath = join(rootDir, ".generate-toc-exclude");
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  const globalPath = home ? join(home, ".generate-toc-exclude") : "";

  // Global first, unless disabled
  if (!noGlobal && globalPath) {
    for (const line of readLinesIfExists(globalPath)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      rules.push(s);
    }
  }

  // Local second (overrides by order)
  for (const line of readLinesIfExists(localPath)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    rules.push(s);
  }

  // Precompile to regex
  const compiled = rules.map((rule) => {
    const neg = rule.startsWith("!");
    const pattern = neg ? rule.slice(1) : rule;
    // Normalize all globs to POSIX-like paths for consistent matching
    const rx = globToRegExp(pattern, { extended: true, globstar: true });
    return { neg, rx, raw: rule };
  });

  return compiled;
}

// Decide if a path (relative to root) is included
function isIncluded(relPath, compiledRules) {
  // All matching happens on POSIX-ish paths (foo/bar)
  const p = relPath.split("\\").join("/");

  let include = true; // default: include
  for (const { neg, rx } of compiledRules) {
    if (rx.test(p)) {
      include = neg ? true : false;
    }
  }
  return include;
}

// ---------------- Tree building ----------------
function createNode(name) {
  return { name, children: new Map(), files: [] };
}

function insertPath(root, pathParts) {
  if (pathParts.length === 0) return;
  if (pathParts.length === 1) {
    root.files.push(pathParts[0]);
    return;
  }
  const [dir, ...rest] = pathParts;
  if (!root.children.has(dir)) root.children.set(dir, createNode(dir));
  insertPath(root.children.get(dir), rest);
}

async function buildTree(rootDir, compiledRules) {
  const root = createNode("");

  async function walkDir(absDir, relDir) {
    for await (const entry of Deno.readDir(absDir)) {
      const rel = relDir ? posix.join(relDir, entry.name) : entry.name;

      // If excluded, skip completely (no descend)
      if (!isIncluded(rel, compiledRules)) continue;

      const abs = join(absDir, entry.name);
      if (entry.isDirectory) {
        // Insert the directory (only creates node when a child/file is inserted)
        await walkDir(abs, rel);
        // If the directory exists but had no children/files, nothing is inserted.
      } else if (entry.isFile) {
        insertPath(root, rel.split("/"));
      }
      // (symlinks are ignored)
    }
  }

  await walkDir(rootDir, "");
  return root;
}

// ---------------- Render HTML ----------------
function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderNode(node, basePath) {
  const dirs = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files = [...node.files].sort((a, b) => a.localeCompare(b));

  let html = "";
  if (dirs.length || files.length) html += "<ul>\n";

  for (const d of dirs) {
    const p = basePath ? `${basePath}/${d.name}` : d.name;
    html += `  <li class="dir"><span>${escapeHtml(d.name)}/</span>\n`;
    html += renderNode(d, p);
    html += "  </li>\n";
  }

  for (const f of files) {
    const p = basePath ? `${basePath}/${f}` : f;
    const href = encodeURI(p);
    html += `  <li class="file"><a href="${href}">${escapeHtml(f)}</a></li>\n`;
  }

  if (dirs.length || files.length) html += "</ul>\n";
  return html;
}

function wrapPage(inner) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Table of Contents</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; }
  h1 { margin-top: 0; font-size: 1.25rem; }
  ul { list-style: none; padding-left: 1rem; margin: 0.25rem 0; }
  li { margin: 0.15rem 0; }
  .dir > span { font-weight: 600; }
  a { text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer { margin-top: 2rem; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity: 0.7; }
</style>
<h1>Table of Contents</h1>
${inner || "<p><em>(no files)</em></p>"}
<footer>Generated by generate-toc ${VERSION}</footer>
</html>`;
}

// ---------------- Main ----------------
async function main() {
  const argv = parseArgs([...Deno.args]);
  const rootDir = argv.root;

  const compiledRules = loadExcludeRules({
    noGlobal: argv.noGlobal,
    rootDir,
  });

  const tree = await buildTree(rootDir, compiledRules);
  const tocHtml = renderNode(tree, "");
  const fullHtml = wrapPage(tocHtml);

  await Deno.writeTextFile("table-of-contents.html", fullHtml);
  console.log("Wrote table-of-contents.html");
}

if (import.meta.main) {
  await main();
}
