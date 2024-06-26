
import type {Node} from "acorn";
import {simple} from "acorn-walk";
// import {isPathImport, relativePath, resolvePath, resolveRelativePath} from "../path.js";
import {Sourcemap} from "../sourcemap.js";
import type {JavaScriptNode} from "./parse.js";
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

function rewriteFollowedByCalls(
  output: Sourcemap,
  body: Node,
): void {
  simple(body, {
    CallExpression(node) {
      if (node.callee.type === "MemberExpression" 
      && node.callee.object.type === "Identifier"
      && node.callee.object.name === "Events"
      && node.callee.property.type === "Identifier") {
        if (node.callee.property.name === "fby") {
          output.insertLeft(node.arguments[1].start, '"');
          output.insertRight(node.arguments[1].end, '"');
         } else if (node.callee.property.name === "delay") {
          output.insertLeft(node.arguments[0].start, '"');
          output.insertRight(node.arguments[0].end, '"');
         }
        }
    }
  });
}
