import type {CallExpression, Expression, Identifier, Node, Pattern, VariableDeclaration} from "acorn";
import {ancestor} from "acorn-walk";
import {defaultGlobals} from "./globals.js";
import {syntaxError} from "./syntaxError.js";
import { Sourcemap } from "../sourcemap.js";
import { JavaScriptNode } from "./parse.js";

type RewriteSpec = {
    start: number; 
    end: number; 
    name: string
};

/** Throws a SyntaxError for any illegal assignments. */
export function checkNested(node: Node, baseId: string){
    return rewriteNestedCalls(node);
}

function rewriteNestedCalls(
    body: Node,
): Array<RewriteSpec> {
    const rewriteSpecs:Array<RewriteSpec> = [];
    let nextId = 0;
    ancestor(body, {
        CallExpression(node) {
            if (isEvent(node)) {
                rewriteSpecs.push({start: node.start, end: node.end, name: `_${nextId++}`});
            }
        }
    });
    return rewriteSpecs;
}

function isEvent(node:Node) {
    if (node.type !== "CallExpression") {return false;}
    const call = node = node as CallExpression;
    return call.callee.type === "MemberExpression" 
        && call.callee.object.type === "Identifier"
        && call.callee.object.name === "Events"
        && call.callee.property.type === "Identifier";
}
