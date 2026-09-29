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

const FN_TYPES = new Set([
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
  "generator_function_declaration",
]);

function enclosingCallerName(node: SyntaxNode, source: string): string | null {
  const anc = findAncestor(node, FN_TYPES);
  if (!anc) return null;
  if (anc.type === "method_definition") {
    const name = childByField(anc, "name");
    return name ? textSlice(source, name) : null;
  }
  if (
    anc.type === "function_declaration" ||
    anc.type === "generator_function_declaration"
  ) {
    const name = childByField(anc, "name");
    return name ? textSlice(source, name) : null;
  }
  // arrow / function expression — try variable declarator parent
  const decl = findAncestor(anc, new Set(["variable_declarator"]));
  if (decl) {
    const name = childByField(decl, "name");
    return name ? textSlice(source, name) : null;
  }
  return null;
}

function extractCallName(callNode: SyntaxNode, source: string): string | null {
  const fn = childByField(callNode, "function");
  if (!fn) return null;
  if (fn.type === "identifier") return textSlice(source, fn);
  if (fn.type === "member_expression") {
    const prop = childByField(fn, "property");
    return prop ? textSlice(source, prop) : null;
  }
  return null;
}

function collectImports(root: SyntaxNode, source: string): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === "import_statement") {
      const sourceNode = childByField(node, "source");
      const mod = sourceNode
        ? textSlice(source, sourceNode).replace(/^['"]|['"]$/g, "")
        : "";
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (!c) continue;
        if (c.type === "import_clause") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const part = c.namedChild(j);
            if (!part) continue;
            if (part.type === "identifier") {
              imports.push({
                sourceModule: mod,
                localName: textSlice(source, part),
                importedName: "default",
              });
            } else if (part.type === "namespace_import") {
              const id = part.namedChildren.find(
                (n): n is Node => n != null && n.type === "identifier"
              );
              if (id) {
                imports.push({
                  sourceModule: mod,
                  localName: textSlice(source, id),
                  importedName: "*",
                });
              }
            } else if (part.type === "named_imports") {
              for (let k = 0; k < part.namedChildCount; k++) {
                const spec = part.namedChild(k);
                if (!spec || spec.type !== "import_specifier") continue;
                const name = childByField(spec, "name");
                const alias = childByField(spec, "alias");
                if (!name) continue;
                const imported = textSlice(source, name);
                imports.push({
                  sourceModule: mod,
                  localName: alias ? textSlice(source, alias) : imported,
                  importedName: imported,
                });
              }
            }
          }
        }
      }
    } else if (node.type === "export_statement") {
      // re-exports ignored for v1
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) walk(c);
    }
  };

  walk(root);
  return imports;
}

export function extractTypeScript(
  tree: Tree,
  source: string
): ExtractResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];
  const root = tree.rootNode;

  const walk = (node: SyntaxNode, className: string | null) => {
    switch (node.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          const name = textSlice(source, nameNode);
          const params = childByField(node, "parameters");
          const ret = childByField(node, "return_type");
          symbols.push({
            name,
            kind: "function",
            container: className,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: ret ? textSlice(source, ret).replace(/^:\s*/, "") : null,
          });
          if (params) {
            for (let i = 0; i < params.namedChildCount; i++) {
              const p = params.namedChild(i);
              if (!p) continue;
              if (p.type === "required_parameter" || p.type === "optional_parameter") {
                const pn = childByField(p, "pattern") ?? p.namedChild(0);
                const pt = childByField(p, "type");
                if (pn && pn.type === "identifier") {
                  symbols.push({
                    name: textSlice(source, pn),
                    kind: "parameter",
                    container: name,
                    range: nodeRange(p),
                    signature: null,
                    typeText: pt ? textSlice(source, pt).replace(/^:\s*/, "") : null,
                  });
                }
              }
            }
          }
        }
        break;
      }
      case "lexical_declaration":
      case "variable_declaration": {
        for (let i = 0; i < node.namedChildCount; i++) {
          const d = node.namedChild(i);
          if (!d || d.type !== "variable_declarator") continue;
          const nameNode = childByField(d, "name");
          const value = childByField(d, "value");
          if (!nameNode || nameNode.type !== "identifier") continue;
          const name = textSlice(source, nameNode);
          if (
            value &&
            (value.type === "arrow_function" ||
              value.type === "function_expression" ||
              value.type === "generator_function")
          ) {
            symbols.push({
              name,
              kind: "function",
              container: className,
              range: nodeRange(value),
              signature: textSlice(source, d).split("\n")[0]?.slice(0, 200) ?? null,
              typeText: null,
            });
          } else {
            const typeNode = childByField(d, "type");
            symbols.push({
              name,
              kind: "variable",
              container: className,
              range: nodeRange(d),
              signature: textSlice(source, d).split("\n")[0]?.slice(0, 200) ?? null,
              typeText: typeNode
                ? textSlice(source, typeNode).replace(/^:\s*/, "")
                : null,
            });
          }
        }
        break;
      }
      case "class_declaration":
      case "abstract_class_declaration": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          const name = textSlice(source, nameNode);
          symbols.push({
            name,
            kind: "class",
            container: className,
            range: nodeRange(node),
            signature: `class ${name}`,
            typeText: name,
          });
          const body = childByField(node, "body");
          if (body) {
            for (let i = 0; i < body.namedChildCount; i++) {
              const m = body.namedChild(i);
              if (m) walk(m, name);
            }
          }
          return; // children walked with class context
        }
        break;
      }
      case "method_definition": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          const name = textSlice(source, nameNode);
          symbols.push({
            name,
            kind: "method",
            container: className,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: null,
          });
        }
        break;
      }
      case "interface_declaration": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          symbols.push({
            name: textSlice(source, nameNode),
            kind: "interface",
            container: null,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: textSlice(source, nameNode),
          });
        }
        break;
      }
      case "type_alias_declaration": {
        const nameNode = childByField(node, "name");
        const value = childByField(node, "value");
        if (nameNode) {
          symbols.push({
            name: textSlice(source, nameNode),
            kind: "type",
            container: null,
            range: nodeRange(node),
            signature: textSlice(source, node).split("\n")[0]?.slice(0, 200) ?? null,
            typeText: value ? textSlice(source, value).slice(0, 300) : null,
          });
        }
        break;
      }
      case "enum_declaration": {
        const nameNode = childByField(node, "name");
        if (nameNode) {
          symbols.push({
            name: textSlice(source, nameNode),
            kind: "type",
            container: null,
            range: nodeRange(node),
            signature: `enum ${textSlice(source, nameNode)}`,
            typeText: textSlice(source, nameNode),
          });
        }
        break;
      }
      case "call_expression": {
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
      case "new_expression": {
        const ctor = childByField(node, "constructor");
        if (ctor && ctor.type === "identifier") {
          calls.push({
            calleeName: textSlice(source, ctor),
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
  const imports = collectImports(root, source);
  return { symbols, calls, imports };
}
