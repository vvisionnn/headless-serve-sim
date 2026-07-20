import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

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

function propertyName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteral(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function propertyOwner(expression: ts.Expression): ts.Expression | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.expression;
  if (ts.isElementAccessExpression(expression)) return expression.expression;
  return null;
}

function importedModule(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return null;
  const first = node.arguments[0];
  if (!first || !ts.isStringLiteral(first)) return null;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return first.text;
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") return first.text;
  return null;
}

function isChildProcessModule(value: string | null): boolean {
  return value === "child_process" || value === "node:child_process";
}

function isNamedCall(node: ts.CallExpression, owner: string, names: readonly string[]): boolean {
  const property = propertyName(node.expression);
  const expression = propertyOwner(node.expression);
  return (
    property !== null &&
    names.includes(property) &&
    expression !== null &&
    ts.isIdentifier(expression) &&
    expression.text === owner
  );
}

function callsCreateNodeHostCommands(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === "createNodeHostCommands";
  return propertyName(node.expression) === "createNodeHostCommands";
}

function hasExplicitFakeOverrides(node: ts.CallExpression): boolean {
  const first = node.arguments[0];
  return !!first && ts.isObjectLiteralExpression(first) && first.properties.length > 0;
}

export function findHostCommandSeamViolations(
  inputs: readonly SourceInput[],
): HostCommandSeamViolation[] {
  const violations: HostCommandSeamViolation[] = [];

  for (const input of inputs) {
    const path = normalized(input.path);
    if (!isRuntimeSource(path)) continue;
    const sourceFile = ts.createSourceFile(
      path,
      input.source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node: ts.Node, rule: HostCommandSeamViolation["rule"], message: string) => {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        path,
        line: position.line + 1,
        column: position.character + 1,
        rule,
        message,
      });
    };

    const visit = (node: ts.Node): void => {
      if (
        !isNodeAdapter(path) &&
        !isOrdinaryTest(path) &&
        isChildProcessModule(importedModule(node))
      ) {
        report(
          node,
          "child-process-import",
          "Import HostCommands instead of importing child_process directly.",
        );
      }

      if (ts.isCallExpression(node)) {
        if (
          !isNodeAdapter(path) &&
          !isOrdinaryTest(path) &&
          isNamedCall(node, "Bun", ["spawn", "spawnSync"])
        ) {
          report(node, "direct-bun-spawn", "Route process creation through HostCommands.");
        }
        if (
          !isNodeAdapter(path) &&
          !isOrdinaryTest(path) &&
          isNamedCall(node, "process", ["kill"])
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
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
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
