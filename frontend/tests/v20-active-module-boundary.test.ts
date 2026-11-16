import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const sdkRoot = fileURLToPath(new URL("../vendor/embed-browser-sdk/src/", import.meta.url));
const extensions = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

// Follow both static imports/re-exports and lazy import() entries. Testing only
// WorkbenchApp's markup would miss a retired drawer reintroduced in a child.
function activeModules(file: string, visited = new Set<string>()) {
  if (visited.has(file)) return visited;
  visited.add(file);
  if (!/\.[jt]sx?$/.test(file)) return visited;
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      const base = name === "@oneportal/embed-browser-sdk/child" ? join(sdkRoot, "child.ts")
        : name.startsWith("@/") ? join(sourceRoot, name.slice(2))
        : name.startsWith(".") ? resolve(dirname(file), name) : null;
      if (base) {
        const dependency = [...extensions.map(extension => base + extension), base.replace(/\.js$/, ".ts")]
          .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
        if (dependency) activeModules(dependency, visited);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return visited;
}

it("keeps the retired reference/Insight/Data Agent modules deleted from V20", () => {
  const active = [...activeModules(join(sourceRoot, "main.tsx"))]
    .map(file => relative(sourceRoot, file).replaceAll("\\", "/"));
  expect(active).toContain("workbench/WorkbenchApp.jsx");
  expect(active).toContain("workbench/pages/EditorPage.jsx");
  expect(active).toContain("workbench/pages/AdminStudioPage.jsx");
  for (const retired of [
    "workbench/WorkPanel.jsx", "workbench/WorkPanelResizer.tsx", "workbench/DataAgentFrame.tsx",
    "workbench/pages/InsightPanel.jsx", "workbench/pages/AdminInsightPreview.jsx",
    "workbench/pages/InsightCapabilityResult.tsx", "workbench/pages/insight-capability.css",
    "workbench/pages/AdminPage.jsx", "workbench/dataAgent.ts", "portal/agentFrame.ts", "config/yiwen.ts",
  ]) {
    expect(existsSync(join(sourceRoot, retired)), `Retired module was restored: ${retired}`).toBe(false);
    expect(active, `Retired module became reachable: ${retired}`).not.toContain(retired);
  }
  expect(active).toContain("portal/session.ts");
  expect(active).toContain("workbench/domain/dealer-history.ts");
  expect(active).toContain("../vendor/embed-browser-sdk/src/child.ts");
  for (const retired of ["data-agent-child.ts", "data-agent-host.ts", "data-agent.ts"]) {
    expect(existsSync(join(sdkRoot, retired))).toBe(false);
  }
});
