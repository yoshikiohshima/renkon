import {join} from "node:path/posix";
import type {Node} from "acorn";
import type {CallExpression} from "acorn";
import type {ExportAllDeclaration, ExportNamedDeclaration, ImportDeclaration, ImportExpression} from "acorn";
import {simple} from "acorn-walk";
import {isPathImport, relativePath, resolveLocalPath} from "../path.js";
import {parseProgram} from "./parse.js";
import {getStringLiteralValue, isStringLiteral} from "./source.js";
import {syntaxError} from "./syntaxError.js";

export interface ImportReference {
  /** The relative path to the import from the referencing source. */
  name: string;
  /** Is this a reference to a local module, or a non-local (e.g., npm) one? */
  type: "local" | "global";
  /** Is this a static import declaration, or a dynamic import expression? */
  method: "static" | "dynamic";
}

export type ImportNode = ImportDeclaration | ImportExpression;
export type ExportNode = ExportAllDeclaration | ExportNamedDeclaration;

/**
 * Finds all export declarations in the specified node. (This is used to
 * disallow exports within JavaScript code blocks.) Note that this includes both
 * "export const foo" declarations and "export {foo} from bar" declarations.
 */
export function findExports(body: Node): ExportNode[] {
  const exports: ExportNode[] = [];

  simple(body, {
    ExportAllDeclaration: findExport,
    ExportNamedDeclaration: findExport
  });

  function findExport(node: ExportNode) {
    exports.push(node);
  }

  return exports;
}

/** Returns true if the body includes an import declaration. */
export function hasImportDeclaration(body: Node): boolean {
  let has = false;

  simple(body, {
    ImportDeclaration() {
      has = true;
    }
  });

  return has;
}

/**
 * Finds all imports (both static and dynamic, local and global) with
 * statically-analyzable sources in the specified node. Note: this includes only
 * direct imports, not transitive imports. Note: this also includes exports, but
 * exports are only allowed in JavaScript modules (not in Markdown).
 */
export function findImports(body: Node, path: string, input: string): ImportReference[] {
  return [];
}

export function isImportMetaResolve(node: CallExpression): boolean {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "MetaProperty" &&
    node.callee.object.meta.name === "import" &&
    node.callee.object.property.name === "meta" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "resolve" &&
    node.arguments.length > 0
  );
}

export function isJavaScript(path: string): boolean {
  return /\.(m|c)?js$/i.test(path);
}

const parseImportsCache = new Map<string, Promise<ImportReference[]>>();

export async function parseImports(root: string, path: string): Promise<ImportReference[]> {
    return [];
}
