import {Parser, tokTypes} from "acorn";
import jsx from "acorn-jsx";
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
  sendTargets: Identifier[]; // A special case where a variable is used for Events.send destination
  imports: ImportReference[];
  input: string;
}

function findDecls(input:string) {
  try {
    const body = parseProgram(input);
    const list = (body as Program).body;
    return list.map((decl) => input.slice(decl.start, decl.end));
  } catch (error) {
    const e = error as unknown as SyntaxError & {pos:number};
    console.log(e.message, ": error around -> ", `"${input.slice(e.pos - 30, e.pos + 30)}"`);
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
    const [references, forceVars, sendTargets] = findReferences(b);
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
        sendTargets,
        imports: [],
        expression: false,
        input: decl
      });
    } else {
      let newInput = decl;
      let newPart = "";
      let overridden = false;
      for (let i = 0; i < rewriteSpecs.length; i++) {
        const spec = rewriteSpecs[i];
        if (spec.type === "range") {
          const sub = newInput.slice(spec.start, spec.end);
          const varName = spec.name
          newPart += `const ${varName} = ${sub};\n`;
          let length = spec.end - spec.start;
          const newNewInput = `${newInput.slice(0, spec.start)}${spec.name.padEnd(length, " ")}${newInput.slice(spec.end)}`;
          if (newNewInput.length !== decl.length) {debugger}
          newInput = newNewInput
        } else if (spec.type === "override") {
          overridden = true;
          newPart += spec.definition + "\n";
        }
      }
      allReferences.push(...parseJavaScript(`${newPart}${overridden ? "" : "\n" + newInput}`, initialId, true));
    }
  }
  return allReferences as JavaScriptNode[];
}

export function parseProgram(input: string): Program {
  return Parser.parse(input, acornOptions);
}

export function parseJSX(input: string) {
  return Parser.extend(jsx()).parse(input, {ecmaVersion: 13});
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
