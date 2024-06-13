/*
import {join} from "node:path/posix";
import type {Node} from "acorn";
import type {CallExpression} from "acorn";
import type {ExportAllDeclaration, ExportNamedDeclaration, ImportDeclaration, ImportExpression} from "acorn";
import {simple} from "acorn-walk";
import {isPathImport, relativePath, resolveLocalPath} from "../path.js";
import {parseProgram} from "./parse.js";
import {getStringLiteralValue, isStringLiteral} from "./source.js";
import {syntaxError} from "./syntaxError.js";
*/
export interface ImportReference {
  /** The relative path to the import from the referencing source. */
  name: string;
  /** Is this a reference to a local module, or a non-local (e.g., npm) one? */
  type: "local" | "global";
  /** Is this a static import declaration, or a dynamic import expression? */
  method: "static" | "dynamic";
}
