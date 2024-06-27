import type {CallExpression, Node} from "acorn";
import {ancestor} from "acorn-walk";

type RewriteSpec = {
    start: number; 
    end: number; 
    name: string
};

/** Throws a SyntaxError for any illegal assignments. */
export function checkNested(node: Node, baseId: number){
    return rewriteNestedCalls(node, baseId);
}

function rewriteNestedCalls(
    body: Node,
    baseId: number
): Array<RewriteSpec> {
    const rewriteSpecs:Array<RewriteSpec> = [];
    ancestor(body, {
        CallExpression(node) {
            if (isEvent(node)) {
                rewriteSpecs.push({start: node.start, end: node.end, name: `_${baseId}_${rewriteSpecs.length}`});
            }
        }
    });
    return rewriteSpecs;
}

function isEvent(node:Node) {
    if (node.type !== "CallExpression") {return false;}
    const call = node = node as CallExpression;
    const callee = call.callee;
    return callee.type === "MemberExpression" 
        && callee.object.type === "Identifier"
        && (callee.object.name === "Events" || callee.object.name === "Behaviors")
        && callee.property.type === "Identifier";
}
