
import type {FunctionDeclaration, Identifier, Node, Statement, Program} from "acorn";
import {simple} from "acorn-walk";
// import {isPathImport, relativePath, resolvePath, resolveRelativePath} from "../path.js";
import {Sourcemap} from "./sourcemap.js";
import {JavaScriptNode, parseJavaScript} from "./parse.js";
import {globals} from "./globals";

export interface TranspileOptions {
  id: string;
}

export function transpileJavaScript(node: JavaScriptNode): string {
  const outputs = Array.from(new Set<string>(node.declarations?.map((r) => r.name)));
  const only = outputs.length === 0 ? "" : outputs[0];
  const inputs = Array.from(new Set<string>(node.references.map((r) => r.name)))
      .filter((n) => {
        return globals[n] !== false &&
          !(node.sendTargets.findIndex((s) => s.name === n) >= 0)
      });
  const forceVars = Array.from(new Set<string>(node.forceVars.map((r) => r.name)))
    .filter((n) => globals[n] !== false);
  // if (hasImportDeclaration(node.body)) async = true;
  const output = new Sourcemap(node.input).trim();
  // rewriteImportDeclarations(output, node.body, resolveImport);
  // rewriteImportExpressions(output, node.body, resolveImport);
  rewriteExport(output, node.body);
  rewriteRenkonCalls(output, node.body);
  // rewriteFileExpressions(output, node.files, path);
  output.insertLeft(0, `, body: (${inputs}) => {\n`);
  output.insertLeft(0, `, outputs: ${JSON.stringify(only)}`);
  output.insertLeft(0, `, inputs: ${JSON.stringify(inputs)}`);
  output.insertLeft(0, `, forceVars: ${JSON.stringify(forceVars)}`);
  output.insertLeft(0, `, blockId: "${node.blockId}"`);
  output.insertLeft(0, `, topType: "${node.topType}"`);
  output.insertLeft(0, `{id: "${node.id}"`); // at the moment we assume there is only one
  output.insertRight(node.input.length, `\nreturn ${only};`);
  output.insertRight(node.input.length, "\n}};\n");
  return String(output);
}

export function getFunctionBody(input: string, forMerge: boolean) {
  const compiled = parseJavaScript(input, 0, true);
  const node = compiled[0].body.body[0] as FunctionDeclaration;
  const params = getParams(node);
  const body = node.body.body;
  const last = body[body.length - 1];
  const returnValues = forMerge ? [] : getReturn(last);
  const output = new Sourcemap(input).trim();

  output.delete(0, body[0].start);
  output.delete(last.start, input.length);

  return {params, returnValues, output: String(output)}
}

function getParams(node: FunctionDeclaration):Array<string> {
  if (node.params.length === 0) {return [];}
  if (node.params[0].type === "Identifier") {
    return node.params.map((p) => (p as Identifier).name);
  }
  if (node.params[0].type === "ObjectPattern") {
    const result:Array<string> = [];
    for (const prop of node.params[0].properties) {
      if (!prop) {
        console.error("cannot convert");
        return [];
      }
      if (prop.type !== "Property") {
        console.error("cannot convert");
        return [];
      }
      if (prop.key.type !== "Identifier" || prop.value.type !== "Identifier") {
        console.error("cannot convert");
        return [];
      }
      result.push(prop.key.name);
    }
    return result;
  }
  return [];
}

function getReturn(returnNode: Statement) {
  if (returnNode.type !== "ReturnStatement") {
    console.error("cannot convert");
    return null;
  }
  const returnValue = returnNode.argument;
  if (returnValue && returnValue.type === "ArrayExpression") {
    for (const elem of returnValue.elements) {
      if (!elem || elem.type !== "Identifier") {
        console.error("cannot convert");
        return null;
      }
    }
    return returnValue.elements.map((e) => (e as Identifier).name);
  }
  if (returnValue && returnValue.type === "ObjectExpression") {
    const result:any = {};
    for (const prop of returnValue.properties) {
      if (!prop) {
        console.error("cannot convert");
        return null;
      }
      if (prop.type !== "Property") {
        console.error("cannot convert");
        return null;
      }
      if (prop.key.type !== "Identifier" || prop.value.type !== "Identifier") {
        console.error("cannot convert");
        return null;
      }
      result[prop.key.name] = prop.value.name;
    }
    return result;
  }
  return null;
}

function quote(node:Node, output:Sourcemap) {
  output.insertLeft(node.start, '"');
  output.insertRight(node.end, '"');
}

function rewriteExport(
  output: Sourcemap,
  body: Program,
): void {
  const first = body.body[0];
  if (first.type !== "ExportNamedDeclaration") {return;}
  const start = first.start;
  const end = start + "export ".length;

  output.replaceLeft(start, end, "");
}

function rewriteRenkonCalls(
  output: Sourcemap,
  body: Node,
): void {
  simple(body, {
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
        if (callee.object.name === "Events") {
          output.insertRight(callee.object.end, ".create(Renkon)");
          if (callee.property.type === "Identifier") {
            const selector = callee.property.name;
            if (selector === "delay") {
              quote(node.arguments[0], output);
            } else if (["or", "_or_index", "some"].includes(selector)) {
              for (const arg of node.arguments) {
                quote(arg, output);            
              }
            } else if (selector === "send") {
              quote(node.arguments[0], output);
            } else if (["collect", "_select"].includes(selector)) {
              quote(node.arguments[1], output);
            }
          }
        } else if (callee.object.name === "Behaviors") {
          output.insertRight(callee.object.end, ".create(Renkon)");
          if (callee.property.type === "Identifier") {
            const selector = callee.property.name;
            if (["collect", "_select"].includes(selector)) {
              quote(node.arguments[1], output);
            } else if (["or", "_or_index", "some"].includes(selector)) {
              for (const arg of node.arguments) {
                quote(arg, output);            
              }
            }
          }
        }
      }
    }
  });
}
