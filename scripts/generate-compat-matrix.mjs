#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const registryPath = path.resolve(repoRoot, args.registry ?? "docs/specs/compat-matrix.json");
const docPath = path.resolve(repoRoot, args.doc ?? "docs/content/docs/reference/compatibility.mdx");
const checkOnly = Boolean(args.check);

const startMarker = "{/* compat-matrix:start */}";
const endMarker = "{/* compat-matrix:end */}";

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }
    if (arg === "--registry" || arg === "--doc") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function supportCell(sdk, capabilityKey) {
  const value = sdk.support?.[capabilityKey];
  if (value === undefined || value === null || value === false || value === "") {
    return "Not supported";
  }
  return String(value);
}

function validateRegistry(registry) {
  if (registry.schema !== "sockudo.compatibility.matrix.v1") {
    throw new Error(`invalid registry schema: ${registry.schema}`);
  }
  if (!Array.isArray(registry.capabilities) || registry.capabilities.length === 0) {
    throw new Error("compatibility registry must define capabilities");
  }
  if (!Array.isArray(registry.sdks) || registry.sdks.length === 0) {
    throw new Error("compatibility registry must define SDKs");
  }

  const capabilityKeys = new Set(registry.capabilities.map((capability) => capability.key));
  for (const sdk of registry.sdks) {
    for (const key of Object.keys(sdk.support ?? {})) {
      if (!capabilityKeys.has(key)) {
        throw new Error(`${sdk.id} references unknown capability ${key}`);
      }
    }
  }

  const requiredReleaseOrder = [
    "server-defaults-off",
    "sockudo-js",
    "sockudo-ai-transport",
    "other-client-sdks",
    "server-http-sdks",
  ];
  if (JSON.stringify(registry.releaseOrder) !== JSON.stringify(requiredReleaseOrder)) {
    throw new Error(`releaseOrder must be ${requiredReleaseOrder.join(" -> ")}`);
  }
}

function renderMatrix(registry) {
  const capabilityHeaders = registry.capabilities.map((capability) => capability.label);
  const headers = ["Server / flags", "SDK", "Package", "SDK version", ...capabilityHeaders];
  const separator = headers.map(() => "---");
  const rows = registry.sdks.map((sdk) => [
    `${sdk.serverVersion} / ${sdk.featureFlag}`,
    sdk.name,
    sdk.package,
    sdk.publishedVersion,
    ...registry.capabilities.map((capability) => supportCell(sdk, capability.key)),
  ]);

  const table = [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");

  const notes = registry.sdks
    .filter((sdk) => sdk.notes)
    .map((sdk) => `- \`${sdk.id}\`: ${sdk.notes}`)
    .join("\n");

  const supportWindow = registry.supportWindow ?? {};
  const baselines = (registry.serverBaselines ?? [])
    .map(
      (baseline) =>
        `- Server ${baseline.version}, wire ${baseline.wireProtocol}, profiles ${baseline.profiles.join(", ")}: ${baseline.policy}`,
    )
    .join("\n");

  const releaseOrder = (registry.releaseOrder ?? [])
    .map((step, index) => `${index + 1}. \`${step}\``)
    .join("\n");

  return [
    startMarker,
    "",
    "_Generated from `docs/specs/compat-matrix.json` by `node scripts/generate-compat-matrix.mjs`. Do not edit this block by hand._",
    "",
    "### Server baselines",
    "",
    baselines,
    "",
    "### Supported-since matrix",
    "",
    table,
    "",
    "### Registry notes",
    "",
    notes,
    "",
    "### Support window",
    "",
    `- Server: ${supportWindow.server}`,
    `- SDKs: ${supportWindow.clients}`,
    `- Deprecations: ${supportWindow.deprecations}`,
    "",
    "### Release order",
    "",
    releaseOrder,
    "",
    `Last release-order rehearsal: ${registry.rehearsal?.lastRecorded} (${registry.rehearsal?.mode}), recorded in \`${registry.rehearsal?.artifact}\`.`,
    "",
    endMarker,
  ].join("\n");
}

function replaceGeneratedBlock(document, generated) {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return `${document.trimEnd()}\n\n## Generated SDK Compatibility Matrix\n\n${generated}\n`;
  }

  return `${document.slice(0, start)}${generated}${document.slice(end + endMarker.length)}`;
}

const registry = readJson(registryPath);
validateRegistry(registry);

const generated = renderMatrix(registry);
const currentDocument = fs.readFileSync(docPath, "utf8");
const nextDocument = replaceGeneratedBlock(currentDocument, generated);

if (checkOnly) {
  if (currentDocument !== nextDocument) {
    console.error(`${path.relative(repoRoot, docPath)} is out of date; run node scripts/generate-compat-matrix.mjs`);
    process.exit(1);
  }
  console.log(`${path.relative(repoRoot, docPath)} matches ${path.relative(repoRoot, registryPath)}`);
} else {
  fs.writeFileSync(docPath, nextDocument);
  console.log(`updated ${path.relative(repoRoot, docPath)}`);
}
