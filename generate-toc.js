// generate-toc.js
// Run with:
//   deno run --allow-read --allow-write --allow-env generate-toc.js
//   deno run -A generate-toc.js --no-global
//
// Exclude files:
//   Global:  ~/.generate-toc-exclude
//   Local:   ./.generate-toc-exclude
//
// Rules:
//  - Comments (# …) and blank lines are ignored
//  - Globs via std/path.globToRegExp with globstar (**)
//  - Later rules override earlier ones (local overrides global)
//  - Negate with '!pattern' to re-include something
//  - Friendly dir rules: a trailing slash like ".git/" means
//    "any .git directory at any depth and its contents"

import { join, globToRegExp } from "jsr:@std/path";

const VERSION = "v0.2.0";

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

// Expand a single rule into one or more compiled regexes
function expandGlobRule(rule) {
  const neg = rule.startsWith("!");
  const rawPat = neg ? rule.slice(1) : rule;
  const pat = rawPat.trim();

  const flags = { extended: true, globstar: true };

  // If the rule ends with '/', treat it as a directory rule and expand it
  // to cover the directory itself and all contents at any depth.
  if (pat.endsWith("/")) {
    const dir = pat;                // e.g., ".git/"
    const dirNoSlash = pat.slice(0, -1); // ".git"

    return [
      { neg, rx: globToRegExp(`**/${dir}**`, flags), raw: rule },     // any children
      { neg, rx: globToRegExp(`${dir}**`, flags), raw: rule },        // at root children
      { neg, rx: globToRegExp(`**/${dirNoSlash}`, flags), raw: rule },// the dir itself (any depth)
      { neg, rx: globToRegExp(dirNoSlash, flags), raw: rule },        // the dir itself at root
    ];
  }

  return [{ neg, rx: globToRegExp(pat, flags), raw: rule }];
}
