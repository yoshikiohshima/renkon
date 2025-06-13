import {Parser, tokTypes} from "acorn";
import jsx from "acorn-jsx";
import type {CallExpression, Expression, Identifier, Options, Program} from "acorn";
import {checkAssignments} from "./assignments.js";
import {findDeclarations, findTopLevelDeclarations} from "./declarations.js";
import type {ImportReference} from "./imports.js";
import {findReferences} from "./references.js";
import { checkNested } from "./checkNested.js";
import { detype } from "./detype.js";
import { StreamTypeLabel } from "../combinators.js";
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
  topType: StreamTypeLabel;
  declarations: Identifier[]; // null for expressions that can’t declare top-level variables, a.k.a outputs
  references: Identifier[]; // the unbound references, a.k.a. inputs
  forceVars: Identifier[]; // reactive variable names that should still trigger evaluation when it is undefined.
  extraType: {gather?:string, isSelect?:boolean};
  sendTargets: Identifier[]; // A special case where a variable is used for Events.send destination
  imports: ImportReference[];
  blockId?: string,
  input: string;
}


export function findDecls(input:string):Array<{code:string, start:number, end:number, decls:string[]}> {
  const body = parseProgram(input);
  const list = (body as Program).body;
  return list.map((decl) => {
    const decls = decl.type === "VariableDeclaration" ? findTopLevelDeclarations(decl) : [];
    return {
      code: input.slice(decl.start, decl.end),
      start: decl.start,
      end: decl.end,
      decls
    }
  });
}

function isCompilerArtifact(b:Program):boolean {
  // A hack when the input program looks like:
  // Events.listener(...);
  // This "combinator" is called without the variable declaration on the left when the callback's job is to 
  // call preventDefault() but the event value itself is not used.
  // The resulting compilation is:
  // const _1_0 = Events.listener(...);
  // _1_0;
  // because the Events.combinator is extracted and the remaining part is replaced with the name of it.
  // this causes (for some reason) to make the length of the decls and the id go out of sync, and causes
  // duplicated names for nodes.
  // The following test detects if b is an expression statement with one variable whose name is _[0-9]
  if (b.type !== "Program") {return false;}
  if (b.body[0].type !== "ExpressionStatement") {return false;}
  if (b.body[0].expression.type !== "Identifier")  {return false;}
  return /^_[0-9]/.test(b.body[0].expression.name);
}

function topLevelType(b:Program):StreamTypeLabel {
  if (b.type !== "Program") {return "";}
  const body = b.body[0];
  if (body.type !== "VariableDeclaration") {return "";}
  if (body.declarations[0].type !== "VariableDeclarator") {return "";}
  if (body.declarations[0].id.type !== "Identifier") {return "";}
  if (body.declarations[0].init?.type !== "CallExpression") {return "";}

  const call = body.declarations[0].init as CallExpression;
  if (call.callee.type !== "MemberExpression") {return "";}
  if (call.callee.object.type !== "Identifier") {return "";}
  if (call.callee.object.name === "Events") {return "Event";}
  if (call.callee.object.name === "Behaviors") {return "Behavior";}
  return "";
}

/**
 * Parses the specified JavaScript code block, or if the inline option is true,
 * the specified inline JavaScript expression.
 */
export function parseJavaScript(input:string, initialId:number, flattened: boolean = false): JavaScriptNode[] {
  let decls;
  try {
    input = detype(input);
    decls = findDecls(input).map((d => d.code));
  } catch (error) {
     const e = error as unknown as SyntaxError & {pos:number};
     const message = e.message + ": error around -> " + `\n"${input.slice(e.pos - 30, e.pos + 30)}`;
     console.log(message);
     throw error;
  }

  const allReferences:JavaScriptNode[] = [];

  let id = initialId;

  for (const decl of decls) {
    id++;
    const b = parseProgram(decl);
    const [references, forceVars, sendTargets, extraType] = findReferences(b);
    checkAssignments(b, references, input);
    const declarations = findDeclarations(b, input);

    const rewriteSpecs = flattened ? [] : checkNested(b, id);

    if (isCompilerArtifact(b)) {continue;}

    if (rewriteSpecs.length === 0) {
      const myId = declarations[0]?.name ? declarations[0]?.name : (flattened ? `${initialId}` : `${id}`);
      const topType:StreamTypeLabel = topLevelType(b);

      allReferences.push({
        id: myId,
        body: b,
        declarations,
        references,
        forceVars,
        sendTargets,
        imports: [],
        extraType,
        topType,
        input: decl
      });
    } else {
      let newInput = decl;
      let newPart = "";
      let overridden = false;
      let again = false;
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
        } else if (spec.type === "select") {
            // for now, Behaviors.select has to be at the top level node decl.
            overridden = false;
            const sub = spec.triggers.map((spec) => newInput.slice(spec.start, spec.end));
            const trigger = `Events._or_index(${sub.join(", ")})`;
            const funcs = spec.funcs.map((spec) => newInput.slice(spec.start, spec.end));
            const init = newInput.slice(spec.init.start, spec.init.end);
            const newNewInput = `const ${declarations[0].name} = ${spec.classType}._select(${init}, ${trigger}, [${funcs}]);`;
            newInput = newNewInput;
            //const parsed = parseJavaScript(newPart + newNewInput, initialId, false);
            // console.log(parsed);
            //allReferences.push(...parsed);
            again = true;
            id++;
            break;
        }
      }
      const parsed = parseJavaScript(`${newPart}${overridden ? "" : "\n" + newInput}`, again ? id - 1 : id, !again);
      allReferences.push(...parsed);
    }
  }
  return allReferences;
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
