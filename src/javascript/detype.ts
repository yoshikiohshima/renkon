import * as acorn from 'acorn';
import tsPlugin from 'acorn-typescript';
import {Sourcemap} from "./sourcemap.ts";

/*
*
* */

export function detype(input:string) {
    const ts = tsPlugin();
    const node = acorn.Parser.extend(ts).parse(input, {
        sourceType: 'module',
        ecmaVersion: 'latest',
        locations: true
    });

    const output = new Sourcemap(input).trim();

    removeTypeNode(output, node);

    return String(output);
}

function removeTypeNode(output:Sourcemap, node:acorn.Node) {
    if (node.type.startsWith("TS")) {
        output.delete(node.start, node.end);
        return;
    }
    for (let k in node) {
        let v = node[k];
        if (Array.isArray(v)) {
            v.forEach(a => removeTypeNode(output, a));
            continue;
        }
        if (typeof v === "object" && v !== null && v instanceof acorn.Node) {
            removeTypeNode(output, v);
            continue;
        }
    }

}

    
