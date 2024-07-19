import {Parser, tokTypes} from "acorn";
import type {Expression, Identifier, Options, Program} from "acorn";
import {checkAssignments} from "./assignments.js";
import {findDeclarations} from "./declarations.js";
import type {ImportReference} from "./imports.js";
import {findReferences} from "./references.js";
import { checkNested } from "./checkNested.js";
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
  try {
    const body = parseProgram(input);
    const list = (body as Program).body;
    return list.map((decl) => input.slice(decl.start, decl.end));
  } catch (error) {
    console.log(error.message, ": error around -> ", `"${input.slice(error.pos - 30, error.pos + 30)}"`);
    return [];
  }
}

/**
 * Parses the specified JavaScript code block, or if the inline option is true,
 * the specified inline JavaScript expression.
 */
export function parseJavaScript(input:string, initialId:number, flattened: boolean = false): JavaScriptNode[] {
  const decls = findDecls(input);

  const allReferences = [];

  let id = initialId;

  for (const decl of decls) {
    id++;
    const b = parseProgram(decl);
    const [references, forceVars] = findReferences(b);
    checkAssignments(b, references, input);
    const declarations = findDeclarations(b, input);
    
    const rewriteSpecs = flattened ? [] : checkNested(b, id);

    if (rewriteSpecs.length === 0) {
      const myId = declarations[0]?.name || `${id}`;
      allReferences.push({
        id: myId,
        body: b,
        declarations,
        references,
        forceVars,
        imports: [],
        expression: false,
        input: decl
      });
    } else {
      let newInput = decl;
      let newPart = "";
      for (let i = 0; i < rewriteSpecs.length; i++) {
        const spec = rewriteSpecs[i];
        const sub = newInput.slice(spec.start, spec.end);
        const varName = spec.name
        newPart += `const ${varName} = ${sub};\n`;
        let length = spec.end - spec.start;
        const newNewInput = `${newInput.slice(0, spec.start)}${spec.name.padEnd(length, " ")}${newInput.slice(spec.end)}`;
        if (newNewInput.length !== decl.length) {debugger}
        newInput = newNewInput
      }
      allReferences.push(...parseJavaScript(`${newPart}\n${newInput}`, initialId, true));
    }
  }
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
