import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import {Sourcemap} from "./sourcemap.ts";
//import {fullAncestor} from "acorn-typescript";

/*
*
* */

export function detype(input:string) {
    const ts = tsPlugin();
    const node = acorn.Parser.extend(ts as any).parse(input, {
        sourceType: 'module',
        ecmaVersion: 'latest',
        locations: true
    });

    const output = new Sourcemap(input).trim();

    removeTypeNode(output, node);

    return String(output);
}

function removeTypeNode(output:Sourcemap, node:any, parent?:any) {
  if (Array.isArray(node)) {
    node.forEach((a2) => removeTypeNode(output, a2, parent));
    return;
  }
  if (typeof node === "object" && node !== null && typeof node.type === "string") {
    if (node.type.startsWith("TS")) {
      output.delete(node.start, node.end);
      return;
    }
    if (parent?.type === "Program" && node.type === "ImportDeclaration") {
      output.delete(node.start, node.end);
      return;
    }
    for (let k2 in node) {
      let v2 = node[k2];
      removeTypeNode(output, v2, node);
    }
  }
}
/*
function removeTypeNode(output:Sourcemap, node:any) {
  fullAncestor(node, (node, state, ancestors) => {
    if (node.type.startsWith("TS")) {
      output.delete(node.start, node.end);
      return;
        }
        for (let k in node) {
            let v = node[k as keyof typeof node];
            removeTypeNode(output, v);
        }
    }
}
 */
