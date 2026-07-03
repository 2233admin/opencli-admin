#!/usr/bin/env node
// Design-system token scan gate (DESIGN_SYSTEM.md T1).
// Node >= 18, zero dependencies, ESM.
//
// Scans frontend/src for .tsx/.ts/.css and flags hardcoded values that
// bypass the token system (arbitrary px sizes, arbitrary rounded values,
// near-black hex, banned Tailwind color families, arbitrary rgba shadows).
//
// A line containing the literal string `tokens-allow` is skipped entirely
// (used for deliberate, decided exceptions — see DESIGN_SYSTEM.md).
//
// Exit code: 1 if any error-level rule fires, 0 otherwise. Warnings never
// affect the exit code.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = join(__filename, "..");
const FRONTEND_ROOT = join(SCRIPT_DIR, "..");
const SRC_ROOT = join(FRONTEND_ROOT, "src");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

// Files exempt from scanning entirely (relative to src/, POSIX-style).
const FILE_EXEMPTIONS = new Set(["index.css", "vite-env.d.ts"]);

const ALLOW_MARKER = "tokens-allow";

/** @typedef {{ file: string, line: number, rule: string, match: string, message: string, level: "error" | "warn" }} Finding */

/** @type {Finding[]} */
const findings = [];

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

// (a) text-[10px] / text-[11px] / text-[12px] -> named token classes exist.
const RULE_TEXT_PX_TOKENIZED = {
  id: "text-px-tokenized",
  level: "error",
  regex: /text-\[(10|11|12)px\]/g,
  message: () => "用 text-3xs / text-2xs / text-xs",
};

// (b) rounded-[...] arbitrary values.
const RULE_ROUNDED_ARBITRARY = {
  id: "rounded-arbitrary",
  level: "error",
  regex: /rounded-\[[^\]]+\]/g,
  message: () => "归入 rounded-xs(2px)/sm(4px)/md(6px)/lg(8px)",
};

// (c) Near-black hex literals that should be ops-black/panel/raised tokens.
const NEAR_BLACK_HEXES = [
  "050505",
  "050607",
  "050708",
  "060606",
  "060608",
  "070809",
  "090b0c",
  "0a0a0a",
  "0a0a0c",
  "0a0d10",
  "0b0b0b",
  "0b0b0f",
  "0b0c0e",
  "0c0d10",
  "101418",
];
const RULE_NEAR_BLACK_HEX = {
  id: "near-black-hex",
  level: "error",
  // Word-boundary-ish: hex preceded by # and not immediately followed by
  // another hex digit (so we don't partial-match a longer hex string).
  regex: new RegExp(`#(${NEAR_BLACK_HEXES.join("|")})\\b`, "gi"),
  message: () => "用 bg-ops-black/panel/raised 或 var(--oc-bg/surface/raised)",
};

// (d) Banned Tailwind color families across all color-bearing utility prefixes.
const BANNED_COLOR_MAP = {
  blue: "primary",
  green: "emerald",
  yellow: "amber",
  cyan: "sky",
  purple: "violet",
  indigo: "violet",
  fuchsia: "violet",
  rose: "red",
  slate: "zinc",
  gray: "zinc",
  neutral: "zinc",
  stone: "zinc",
};
const COLOR_PREFIXES =
  "bg|text|border|ring|from|to|via|divide|fill|stroke|outline|shadow|accent|caret|decoration";
const BANNED_COLORS = Object.keys(BANNED_COLOR_MAP).join("|");
const RULE_BANNED_COLOR_FAMILY = {
  id: "banned-color-family",
  level: "error",
  regex: new RegExp(
    `\\b(${COLOR_PREFIXES})-(${BANNED_COLORS})-\\d+`,
    "g"
  ),
  message: (match) => {
    const m = match.match(new RegExp(`^(${COLOR_PREFIXES})-(${BANNED_COLORS})-\\d+$`));
    const family = m ? m[2] : null;
    const target = family ? BANNED_COLOR_MAP[family] : "对应 token 色系";
    return `禁用色系, 映射: ${family ?? "?"}→${target}`;
  },
};

// (e) shadow-[...rgba(...)...] arbitrary shadows.
const RULE_SHADOW_RGBA_ARBITRARY = {
  id: "shadow-rgba-arbitrary",
  level: "error",
  regex: /shadow-\[[^\]]*rgba[^\]]*\]/g,
  message: () => "用 shadow-panel/overlay/drag",
};

// (warn) Other text-[Npx] arbitrary values not covered by rule (a), e.g.
// text-[9px], text-[8px], text-[12.5px], text-[13px], text-[15px].
const RULE_TEXT_PX_LEGACY = {
  id: "text-px-legacy",
  level: "warn",
  regex: /text-\[[\d.]+px\]/g,
  message: () => "T5 遗留债, 新代码用 token 档",
};

// Error rules run first; if an error rule already claimed a span on this
// line for text-[...], we still want the warn rule to skip text-[10/11/12px]
// since that's already reported by rule (a). We handle this by having the
// warn regex simply exclude 10/11/12 via a negative check after matching.
function isTokenizedPx(pxValue) {
  return pxValue === "10" || pxValue === "11" || pxValue === "12";
}

const ERROR_RULES = [
  RULE_TEXT_PX_TOKENIZED,
  RULE_ROUNDED_ARBITRARY,
  RULE_NEAR_BLACK_HEX,
  RULE_BANNED_COLOR_FAMILY,
  RULE_SHADOW_RGBA_ARBITRARY,
];

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      if (SCAN_EXTENSIONS.has(extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function isExempt(filePath) {
  const rel = relative(SRC_ROOT, filePath).split(sep).join("/");
  // Whole-file exemption applies to top-level src/index.css and
  // src/vite-env.d.ts (and any same-named file, matched by basename).
  const base = rel.split("/").pop();
  return FILE_EXEMPTIONS.has(base ?? "");
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r\n|\n/);
  const relPath = relative(FRONTEND_ROOT, filePath).split(sep).join("/");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;

    // Error rules.
    for (const rule of ERROR_RULES) {
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(line)) !== null) {
        findings.push({
          file: relPath,
          line: i + 1,
          rule: rule.id,
          match: m[0],
          message: rule.message(m[0]),
          level: "error",
        });
        if (m[0].length === 0) rule.regex.lastIndex++;
      }
    }

    // Warn rule: legacy text-[Npx], excluding the tokenized 10/11/12px
    // values already caught above (avoid double-reporting the same span).
    RULE_TEXT_PX_LEGACY.regex.lastIndex = 0;
    let wm;
    while ((wm = RULE_TEXT_PX_LEGACY.regex.exec(line)) !== null) {
      const valueMatch = wm[0].match(/text-\[([\d.]+)px\]/);
      const px = valueMatch ? valueMatch[1] : "";
      if (isTokenizedPx(px)) continue; // already an error via rule (a)
      findings.push({
        file: relPath,
        line: i + 1,
        rule: RULE_TEXT_PX_LEGACY.id,
        match: wm[0],
        message: RULE_TEXT_PX_LEGACY.message(),
        level: "warn",
      });
      if (wm[0].length === 0) RULE_TEXT_PX_LEGACY.regex.lastIndex++;
    }
  }
}

function main() {
  let root;
  try {
    root = statSync(SRC_ROOT);
  } catch {
    console.error(`token gate: src root not found at ${SRC_ROOT}`);
    process.exit(1);
    return;
  }
  if (!root.isDirectory()) {
    console.error(`token gate: ${SRC_ROOT} is not a directory`);
    process.exit(1);
    return;
  }

  const files = walk(SRC_ROOT).filter((f) => !isExempt(f));
  for (const file of files) {
    scanFile(file);
  }

  // Stable, readable ordering: by file, then line, then rule.
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0;
  });

  let errorCount = 0;
  let warnCount = 0;

  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else warnCount++;
    console.log(
      `${f.file}:${f.line}: [${f.rule}] 命中 \`${f.match}\` → ${f.message}`
    );
  }

  console.log("");
  console.log(`${errorCount} errors, ${warnCount} warnings`);

  if (errorCount === 0) {
    console.log("token gate: clean");
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
