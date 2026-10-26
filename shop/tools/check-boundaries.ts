import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface Violation {
  file: string;
  importPath: string;
  reason: string;
}

// Matches: import x from "a" | import type {x} from "a" | export {x} from "a"
//          import "a"        | import("a")
const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function importsOf(source: string): string[] {
  const found: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function check(root: string, owner: string, file: string, spec: string): string | null {
  const target = resolve(dirname(file), spec);
  const rel = relative(root, target).split(sep);

  if (rel[0] === "..") return "reaches outside src";
  if (rel[0] === "platform") return null;
  if (rel[0] !== "modules") return "reaches outside src/modules and src/platform";

  const targetModule = rel[1];
  if (!targetModule) return "imports a folder, not a file";
  if (targetModule === owner) return null;
  if (rel.length === 3 && rel[2] === "index.ts") return null;

  return `reaches into module "${targetModule}" past its index.ts`;
}

export function findViolations(root: string): Violation[] {
  const modulesDir = join(root, "modules");
  const violations: Violation[] = [];

  for (const file of walk(modulesDir)) {
    const owner = relative(modulesDir, file).split(sep)[0] ?? "";
    const source = stripComments(readFileSync(file, "utf8"));

    for (const spec of importsOf(source)) {
      if (!spec.startsWith(".")) continue;
      const reason = check(root, owner, file, spec);
      if (reason) {
        violations.push({
          file: relative(root, file).split(sep).join("/"),
          importPath: spec,
          reason,
        });
      }
    }
  }
  return violations;
}

// Run directly: node tools/check-boundaries.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const violations = findViolations(root);
  for (const v of violations) {
    console.log(`${v.file} -> ${v.importPath}   (${v.reason})`);
  }
  if (violations.length === 0) console.log("boundaries: clean");
  process.exit(violations.length === 0 ? 0 : 1);
}