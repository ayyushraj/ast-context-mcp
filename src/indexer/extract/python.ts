import type { Node, Tree } from "web-tree-sitter";
import {
  nodeRange,
  textSlice,
  type ExtractResult,
  type ExtractedCall,
  type ExtractedImport,
  type ExtractedSymbol,
} from "./types.js";

type SyntaxNode = Node;

function childByField(node: SyntaxNode, field: string): SyntaxNode | null {
  return node.childForFieldName(field);
}

function findAncestor(
  node: SyntaxNode,
  types: Set<string>
): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (types.has(cur.type)) return cur;
    cur = cur.parent;
  }
  return null;
}

const FN_TYPES = new Set(["function_definition"]);

function enclosingCallerName(node: SyntaxNode, source: string): string | null {
  const anc = findAncestor(node, FN_TYPES);
  if (!anc) return null;
  const name = childByField(anc, "name");
  return name ? textSlice(source, name) : null;
}

function extractCallName(callNode: SyntaxNode, source: string): string | null {
  const fn = childByField(callNode, "function");
  if (!fn) return null;
  if (fn.type === "identifier") return textSlice(source, fn);
  if (fn.type === "attribute") {
    const attr = childByField(fn, "attribute");
    return attr ? textSlice(source, attr) : null;
  }
  return null;
}

function collectImports(root: SyntaxNode, source: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === "import_from_statement") {
      const named = node.namedChildren.filter((n): n is Node => n != null);
      const moduleNode =
        named.find(
          (n) => n.type === "dotted_name" || n.type === "relative_import"
        ) ?? null;
      const mod = moduleNode ? textSlice(source, moduleNode) : "";
      for (const c of named) {
        if (c === moduleNode) continue;
        if (c.type === "dotted_name" || c.type === "identifier") {
          const name = textSlice(source, c);
          imports.push({
            sourceModule: mod,
            localName: name,
            importedName: name,
          });
        } else if (c.type === "aliased_import") {
          const names = c.namedChildren.filter(
            (n): n is Node =>
              n != null &&
              (n.type === "dotted_name" || n.type === "identifier")
          );
          const imported = names[0] ? textSlice(source, names[0]) : "";
          const local = names[1] ? textSlice(source, names[1]) : imported;
          imports.push({
            sourceModule: mod,
            localName: local,
            importedName: imported,
          });
        } else if (c.type === "wildcard_import") {
          imports.push({
            sourceModule: mod,
            localName: "*",
            importedName: "*",
          });
        }
      }
    } else if (node.type === "import_statement") {
      const named = node.namedChildren.filter((n): n is Node => n != null);
      const dotted = named.find((n) => n.type === "dotted_name");
      const aliased = named.find((n) => n.type === "aliased_import");
      if (aliased) {
        const names = aliased.namedChildren.filter(
          (n): n is Node =>
            n != null && (n.type === "dotted_name" || n.type === "identifier")
        );
        const mod = names[0] ? textSlice(source, names[0]) : "";
        const local = names[1] ? textSlice(source, names[1]) : mod;
        imports.push({
          sourceModule: mod,
          localName: local,
          importedName: null,
        });
      } else if (dotted) {
        const mod = textSlice(source, dotted);
        imports.push({
          sourceModule: mod,
          localName: mod.split(".").pop() ?? mod,
          importedName: null,
        });
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };

  walk(root);
  return imports;
}

export function extractPython(tree: Tree, source: string): ExtractResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];
  const root = tree.rootNode;

  const walk = (node: SyntaxNode, className: string | null) => {
    switch (node.type) {
      case "function_definition": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          const name = textSlice(source, nameNode);
          const params = childByField(node, "parameters");
          const ret = childByField(node, "return_type");
          symbols.push({
            name,
            kind: className ? "method" : "function",
            container: className,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: ret ? textSlice(source, ret) : null,
          });
          if (params) {
            for (let i = 0; i < params.namedChildCount; i++) {
              const p = params.namedChild(i);
              if (!p) continue;
              if (p.type === "identifier") {
                symbols.push({
                  name: textSlice(source, p),
                  kind: "parameter",
                  container: name,
                  range: nodeRange(p),
                  signature: null,
                  typeText: null,
                });
              } else if (p.type === "typed_parameter" || p.type === "default_parameter" || p.type === "typed_default_parameter") {
                const id =
                  p.namedChildren.find(
                    (n): n is Node => n != null && n.type === "identifier"
                  ) ?? null;
                const typeNode = childByField(p, "type");
                if (id) {
                  symbols.push({
                    name: textSlice(source, id),
                    kind: "parameter",
                    container: name,
                    range: nodeRange(p),
                    signature: null,
                    typeText: typeNode ? textSlice(source, typeNode) : null,
                  });
                }
              }
            }
          }
        }
        break;
      }
      case "class_definition": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          const name = textSlice(source, nameNode);
          const bases = childByField(node, "superclasses");
          symbols.push({
            name,
            kind: "class",
            container: className,
            range: nodeRange(node),
            signature: `class ${name}`,
            typeText: bases
              ? textSlice(source, bases).replace(/^\(|\)$/g, "")
              : name,
          });
          const body = childByField(node, "body");
          if (body) {
            for (let i = 0; i < body.namedChildCount; i++) {
              const m = body.namedChild(i);
              if (m) walk(m, name);
            }
          }
          return;
        }
        break;
      }
      case "assignment":
      case "annotated_assignment": {
        const left = childByField(node, "left") ?? node.namedChild(0);
        const typeNode = childByField(node, "type");
        if (left && left.type === "identifier") {
          symbols.push({
            name: textSlice(source, left),
            kind: "variable",
            container: className,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: typeNode ? textSlice(source, typeNode) : null,
          });
        }
        break;
      }
      case "call": {
        const callee = extractCallName(node, source);
        if (callee) {
          calls.push({
            calleeName: callee,
            range: nodeRange(node),
            callerName: enclosingCallerName(node, source),
          });
        }
        break;
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c, className);
    }
  };

  walk(root, null);
  return { symbols, calls, imports: collectImports(root, source) };
}
