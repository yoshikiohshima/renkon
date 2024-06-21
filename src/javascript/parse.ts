import {Parser, tokTypes} from "acorn";
import type {Expression, Identifier, Options, Program} from "acorn";
import {checkAssignments} from "./assignments.js";
import {findDeclarations} from "./declarations.js";
import type {ImportReference} from "./imports.js";
import {findReferences} from "./references.js";
// import {syntaxError} from "./syntaxError.js";

export interface ParseOptions {
  /** The path to the source within the source root. */
  // path: string;
  /** If true, treat the input as an inline expression instead of a fenced code block. */
  inline?: boolean;
}

export const acornOptions: Options = {
  ecmaVersion: 13,
  sourceType: "module"
};

export interface JavaScriptNode {
  id: string,
  body: Program;
  declarations: Identifier[]; // null for expressions that can’t declare top-level variables, a.k.a outputs
  references: Identifier[]; // the unbound references, a.k.a. inputs
  forceVars: Identifier[]; // reactive variable names that should still trigger evaluation when it is undefined.
  imports: ImportReference[];
  input: string;
}

function findDecls(input:string) {
  const body = parseProgram(input);
  const list = (body as Program).body;

  return list.map((decl) => input.slice(decl.start, decl.end));
}

/**
 * Parses the specified JavaScript code block, or if the inline option is true,
 * the specified inline JavaScript expression.
 */
export function parseJavaScript(input: string, initialId = 0): JavaScriptNode[] {
  const decls = findDecls(input);

  const allReferences = decls.map((decl) => {
    const b = parseProgram(decl);
    const [references, forceVars] = findReferences(b);
    checkAssignments(b, references, input);
    const declarations = findDeclarations(b, input);
    const id = declarations.length > 0 ? declarations[0].name : `${initialId++}`
    return {
      id,
      body: b,
      declarations,
      references,
      forceVars,
      imports: [],
      expression: false,
      input: decl
    };
  });
  return allReferences as JavaScriptNode[];
}

export function parseProgram(input: string): Program {
  return Parser.parse(input, acornOptions);
}

/**
 * Parses a single expression; like parseExpressionAt, but returns null if
 * additional input follows the expression.
 */
export function maybeParseExpression(input: string): Expression | null {
  const parser = new (Parser as any)(acornOptions, input, 0); // private constructor
  parser.nextToken();
  try {
    const node = parser.parseExpression();
    return parser.type === tokTypes.eof ? node : null;
  } catch {
    return null;
  }
}
