
import type {FunctionDeclaration, Identifier, Node, Statement, Program, ExportNamedDeclaration} from "acorn";
import {simple} from "acorn-walk";
// import {isPathImport, relativePath, resolvePath, resolveRelativePath} from "../path.js";
import {Sourcemap} from "./sourcemap.js";
import {JavaScriptNode, parseJavaScript} from "./parse.js";
import {globals} from "./globals";
import { ComponentType } from "../combinators.js";

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
  output.insertLeft(0, `, topType: "${node.topType}"`);
  output.insertLeft(0, `{id: "${node.id}"`); // at the moment we assume there is only one
  output.insertRight(node.input.length, `\nreturn ${only};`);
  output.insertRight(node.input.length, "\n}};\n");
  return String(output);
}

export function getFunctionBody(input: string):ComponentType {
  const compiled = parseJavaScript(input, 0, true);
  const node = compiled[0].body.body[0] as FunctionDeclaration;
  const params = getParams(node);
  const rawTypes = getTypes(node);
  let types:Map<string, "Event"|"Behavior"> | null = null;
  if (rawTypes !== null) {
    types = new Map([...rawTypes].map(
      (pair) => (
        [pair[0], pair[1].startsWith("Event") ? "Event" : "Behavior"])
      )
    )
  }
  const body = node.body.body;
  const last = body[body.length - 1];
  const returnValues = getReturn(last);
  const output = new Sourcemap(input).trim();

  output.delete(0, body[0].start);

  if (returnValues) {
    output.delete(last.start, input.length);
  } else {
    output.delete(last.end, input.length);
  }

  return {params, types, rawTypes, returnValues, output: String(output)}
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

export function getTypes(node: FunctionDeclaration):(Map<string, string>|null) {
  if (node.params.length < 2) {return null;}
  // The second argument has to be in the form of default
  // initializer with object expression:
  // _types = {a: "Event", b:"Behavior"}
  const param = node.params[1];
  if (param.type !== "AssignmentPattern") {return null;}
  if (param.left.type !== "Identifier") {return null;}
  if (param.right.type !== "ObjectExpression") {return null;}
  const types:Map<string, string> = new Map();
  for (const prop of param.right.properties) {
    if (!prop) {continue;}
    if (prop.type !== "Property") {continue;}
    if (prop.key.type !== "Identifier") {continue;}
    if (prop.value.type !== "Literal") {continue;}
    if (typeof prop.value.value !== "string") {continue;}
    types.set(prop.key.name, prop.value.value);
  }
  return types;
}

function getReturn(returnNode: Statement):{[key:string]:string}|null {
  if (returnNode.type !== "ReturnStatement") {
    console.log("function body does not end with a return statement.");
    return null;
  }
  const returnValue = returnNode.argument;
  if (returnValue && returnValue.type === "ArrayExpression") {
    console.log("array form no longer supported");
    return null;
  }
  if (returnValue && returnValue.type === "ObjectExpression") {
    const result:any = {};
    for (const prop of returnValue.properties) {
      if (!prop) {
        console.error("the return statemenet can only return an object with nodes.");
        return null;
      }
      if (prop.type !== "Property") {
        console.error("the return statemenet can only return an object with nodes.");
        return null;
      }
      if (prop.key.type !== "Identifier" || prop.value.type !== "Identifier") {
        console.error("the return statemenet can only return an object with nodes.");
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
  if ((body as Program).body[0].type === "FunctionDeclaration") {return;}
  if ((body as Program).body[0].type === "ExportNamedDeclaration") {
    const exp = (body as Program).body[0] as ExportNamedDeclaration;
    if (exp?.declaration?.type === "FunctionDeclaration") {return;}
  }
  simple(body, {
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
        if (callee.object.name === "Events") {
          output.insertRight(callee.object.end, ".create(Renkon)");
          if (callee.property.type === "Identifier") {
            const selector = callee.property.name;
            if (["delay", "calm"].includes(selector)) {
              quote(node.arguments[0], output);
            } else if (["or", "_or_index", "some"].includes(selector)) {
              for (const arg of node.arguments) {
                quote(arg, output);            
              }
            } else if (selector === "send") {
              quote(node.arguments[0], output);
            } else if (["collect", "_select"].includes(selector)) {
              output.insertLeft(node.arguments[0].start, "(() => (");
              output.insertRight(node.arguments[0].end, "))");
              quote(node.arguments[1], output);
            }
          }
        } else if (callee.object.name === "Behaviors") {
          output.insertRight(callee.object.end, ".create(Renkon)");
          if (callee.property.type === "Identifier") {
            const selector = callee.property.name;
            if (["delay", "calm"].includes(selector)) {
              quote(node.arguments[0], output);
            } else if (["collect", "_select"].includes(selector)) {
              output.insertLeft(node.arguments[0].start, "(() => (");
              output.insertRight(node.arguments[0].end, "))");
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
