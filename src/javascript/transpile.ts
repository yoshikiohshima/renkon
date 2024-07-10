
import type {FunctionDeclaration, Identifier, Node, Statement} from "acorn";
import {simple} from "acorn-walk";
// import {isPathImport, relativePath, resolvePath, resolveRelativePath} from "../path.js";
import {Sourcemap} from "../sourcemap.js";
import {JavaScriptNode, parseJavaScript} from "./parse.js";
import {defaultGlobals} from "./globals";
import {renkonGlobals} from "./renkonGlobals";

export interface TranspileOptions {
  id: string;
}

export function transpileJavaScript(node: JavaScriptNode): string {
  const outputs = Array.from(new Set<string>(node.declarations?.map((r) => r.name)));
  const inputs = Array.from(new Set<string>(node.references.map((r) => r.name)))
    .filter((n) => !defaultGlobals.has(n) && !renkonGlobals.has(n));
  const forceVars = Array.from(new Set<string>(node.forceVars.map((r) => r.name)))
    .filter((n) => !defaultGlobals.has(n) && !renkonGlobals.has(n));
  // if (hasImportDeclaration(node.body)) async = true;
  const output = new Sourcemap(node.input).trim();
  // rewriteImportDeclarations(output, node.body, resolveImport);
  // rewriteImportExpressions(output, node.body, resolveImport);
  rewriteFollowedByCalls(output, node.body);
  // rewriteFileExpressions(output, node.files, path);
  output.insertLeft(0, `, body: (${inputs}) => {\n`);
  output.insertLeft(0, `, outputs: ${JSON.stringify(outputs)}`);
  output.insertLeft(0, `, inputs: ${JSON.stringify(inputs)}`);
  output.insertLeft(0, `, forceVars: ${JSON.stringify(forceVars)}`);
  output.insertLeft(0, `define({id: "${node.id}"`); // at the moment we assume there is only one
  output.insertRight(node.input.length, `\nreturn {${outputs}};`);
  output.insertRight(node.input.length, "\n}});\n");
  return String(output);
}

export function getFunctionBody(input: string) {
  const compiled = parseJavaScript(input, 0, true);
  const node = compiled[0].body.body[0] as FunctionDeclaration;
  const params = node.params.map((p) => (p as Identifier).name);
  const body = node.body.body;
  const last = body[body.length - 1];
  const returnArray = getArray(last);
  const output = new Sourcemap(input).trim();

  output.delete(0, body[0].start);
  output.delete(last.start, input.length);

  return {params, returnArray, output: String(output)}
}

function getArray(returnNode: Statement) {
  if (returnNode.type !== "ReturnStatement") {
    console.error("cannot convert");
    return null;
  }
  const array = returnNode.argument;
  if (!array || array.type !== "ArrayExpression") {
    console.error("cannot convert");
    return null;
  }
  for (const elem of array.elements) {
    if (!elem || elem.type !== "Identifier") {
      console.error("cannot convert");
      return null;
    }
  }
  return array.elements.map((e) => (e as Identifier).name);
}


function rewriteFollowedByCalls(
  output: Sourcemap,
  body: Node,
): void {
  simple(body, {
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "MemberExpression" 
      && callee.object.type === "Identifier"
      && callee.object.name === "Events"
      && callee.property.type === "Identifier") {
        if (callee.property.name === "fby") {
          output.insertLeft(node.arguments[1].start, '"');
          output.insertRight(node.arguments[1].end, '"');
        } else if (callee.property.name === "delay") {
          output.insertLeft(node.arguments[0].start, '"');
          output.insertRight(node.arguments[0].end, '"');
        } else if (callee.property.name === "or") {
          for (const arg of node.arguments) {
            output.insertLeft(arg.start, '"');
            output.insertRight(arg.end, '"');            
          }
        }
      }
    }
  });
}
