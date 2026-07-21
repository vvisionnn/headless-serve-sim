import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseSync, Visitor, type Argument, type CallExpression } from "oxc-parser";

export interface SourceInput {
  path: string;
  source: string;
}

export interface HostCommandSeamViolation {
  path: string;
  line: number;
  column: number;
  rule:
    | "child-process-import"
    | "direct-bun-spawn"
    | "direct-process-kill"
    | "real-adapter-in-test";
  message: string;
}

const SOURCE_ROOT = "packages/headless-serve-sim/src/";
const NODE_ADAPTER = `${SOURCE_ROOT}runtime/node-host-commands.ts`;
const HOST_COMMAND_CONTRACT_TEST = `${SOURCE_ROOT}__tests__/host-commands.test.ts`;

function normalized(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isRuntimeSource(path: string): boolean {
  const value = normalized(path);
  return (
    value.startsWith(SOURCE_ROOT) &&
    !value.includes("/src/system-tests/") &&
    /\.[cm]?[jt]sx?$/.test(value)
  );
}

function isNodeAdapter(path: string): boolean {
  return normalized(path) === NODE_ADAPTER;
}

function isOrdinaryTest(path: string): boolean {
  const value = normalized(path);
  return value.includes("/src/__tests__/") && value !== HOST_COMMAND_CONTRACT_TEST;
}

function isChildProcessModule(value: string | null): boolean {
  return value === "child_process" || value === "node:child_process";
}

function stringValue(expression: Argument | undefined): string | null {
  return expression?.type === "Literal" && typeof expression.value === "string"
    ? expression.value
    : null;
}

function calledMember(node: CallExpression, owner: string, names: readonly string[]): boolean {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return false;
  const property =
    callee.property.type === "Identifier"
      ? callee.property.name
      : callee.property.type === "Literal" && typeof callee.property.value === "string"
        ? callee.property.value
        : null;
  return callee.object.name === owner && property !== null && names.includes(property);
}

function callsCreateNodeHostCommands(node: CallExpression): boolean {
  if (node.callee.type === "Identifier") return node.callee.name === "createNodeHostCommands";
  if (node.callee.type !== "MemberExpression") return false;
  const property = node.callee.property;
  return (
    (property.type === "Identifier" && property.name === "createNodeHostCommands") ||
    (property.type === "Literal" && property.value === "createNodeHostCommands")
  );
}

function hasExplicitFakeOverrides(node: CallExpression): boolean {
  const first = node.arguments[0];
  return first?.type === "ObjectExpression" && first.properties.length > 0;
}

function sourcePosition(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const lastNewline = prefix.lastIndexOf("\n");
  return {
    line: prefix.split("\n").length,
    column: offset - lastNewline,
  };
}

export function findHostCommandSeamViolations(
  inputs: readonly SourceInput[],
): HostCommandSeamViolation[] {
  const violations: HostCommandSeamViolation[] = [];

  for (const input of inputs) {
    const path = normalized(input.path);
    if (!isRuntimeSource(path)) continue;
    const { program } = parseSync(path, input.source);

    const report = (
      node: { start: number },
      rule: HostCommandSeamViolation["rule"],
      message: string,
    ) => {
      const position = sourcePosition(input.source, node.start);
      violations.push({
        path,
        line: position.line,
        column: position.column,
        rule,
        message,
      });
    };

    const reportChildProcessImport = (node: { start: number }, moduleName: string | null) => {
      if (!isNodeAdapter(path) && !isOrdinaryTest(path) && isChildProcessModule(moduleName)) {
        report(
          node,
          "child-process-import",
          "Import HostCommands instead of importing child_process directly.",
        );
      }
    };

    new Visitor({
      ImportDeclaration(node) {
        reportChildProcessImport(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        reportChildProcessImport(node, node.source?.value ?? null);
      },
      ExportAllDeclaration(node) {
        reportChildProcessImport(node, node.source.value);
      },
      TSImportEqualsDeclaration(node) {
        const reference = node.moduleReference;
        reportChildProcessImport(
          node,
          reference.type === "TSExternalModuleReference" ? reference.expression.value : null,
        );
      },
      ImportExpression(node) {
        reportChildProcessImport(node, stringValue(node.source));
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        ) {
          reportChildProcessImport(node, stringValue(node.arguments[0]));
        }
        if (
          !isNodeAdapter(path) &&
          !isOrdinaryTest(path) &&
          calledMember(node, "Bun", ["spawn", "spawnSync"])
        ) {
          report(node, "direct-bun-spawn", "Route process creation through HostCommands.");
        }
        if (
          !isNodeAdapter(path) &&
          !isOrdinaryTest(path) &&
          calledMember(node, "process", ["kill"])
        ) {
          report(node, "direct-process-kill", "Route process signals through HostCommands.");
        }
        if (
          isOrdinaryTest(path) &&
          callsCreateNodeHostCommands(node) &&
          !hasExplicitFakeOverrides(node)
        ) {
          report(
            node,
            "real-adapter-in-test",
            "Ordinary tests must use scripted commands or explicit fake Node adapter overrides.",
          );
        }
      },
    }).visit(program);
  }

  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  );
}

function collectFiles(directory: string, workspaceRoot: string, output: SourceInput[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "system-tests") continue;
      collectFiles(path, workspaceRoot, output);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      output.push({
        path: normalized(relative(workspaceRoot, path)),
        source: readFileSync(path, "utf8"),
      });
    }
  }
}

export function scanHostCommandSeam(workspaceRoot = process.cwd()): HostCommandSeamViolation[] {
  const inputs: SourceInput[] = [];
  collectFiles(resolve(workspaceRoot, SOURCE_ROOT), workspaceRoot, inputs);
  return findHostCommandSeamViolations(inputs);
}

export function formatHostCommandSeamViolations(
  violations: readonly HostCommandSeamViolation[],
): string {
  return violations
    .map(
      (violation) =>
        `${violation.path}:${violation.line}:${violation.column} ` +
        `[${violation.rule}] ${violation.message}`,
    )
    .join("\n");
}

if (import.meta.main) {
  const violations = scanHostCommandSeam();
  if (violations.length > 0) {
    console.error(formatHostCommandSeamViolations(violations));
    process.exitCode = 1;
  }
}
