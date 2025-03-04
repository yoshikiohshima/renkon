import type {CallExpression, MemberExpression, VariableDeclarator, ObjectPattern, Node, Identifier, AssignmentProperty} from "acorn";
import {ancestor} from "acorn-walk";

type RewriteSpec = ({
    type: "range";
    start: number; 
    end: number; 
    name: string;
} | {
    type: "override",
    definition: string,
} | {
    type: "select",
    classType: "Behaviors" | "Events",
    init: {start:number, end:number};
    triggers: Array<{start:number, end:number}>;
    funcs: Array<{start:number, end:number}>;
});

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
        CallExpression(node, ancestors:Array<Node>) {
            const inFunction = hasFunctionDeclaration(node, ancestors);
            const isEvent = isNonTopEvent(node, ancestors);
            const isSelectCall = isSelect(node, ancestors);
            if (isSelectCall) {
                const rewrite = rewriteSelect(node, ancestors);
                console.log(rewrite);
                rewriteSpecs.push(rewrite);
            }
            if (isEvent && !inFunction) {
                rewriteSpecs.push({start: node.start, end: node.end, name: `_${baseId}_${rewriteSpecs.length}`, type: "range"});
            }
        },
        VariableDeclarator(node, ancestors:Array<Node>) {
            // associated VariableDeclaration should be the top level thing
            // that defines variables.
            // Then, make a subnode on the right hand side, and
            // generate specs for each propertyon the left hand side.
            if (isTopObjectDeclaration(node, ancestors) && node.init) {
                const baseName = `_${baseId}_${rewriteSpecs.length}`;
                rewriteSpecs.push({start: node.init.start, end: node.init.end, name: baseName, type: "range"});
                const id:ObjectPattern = node.id as ObjectPattern;
                const properties = id.properties;
                for (const property of properties) {
                    if (property.type === "RestElement") {
                        console.log("unsupported style of assignment");
                        continue;
                    }
                    const p:AssignmentProperty = property;
                    if (p.value.type === "Identifier" && p.key.type === "Identifier") {
                        rewriteSpecs.push({definition: `const ${p.value.name} = ${baseName}.${p.key.name}`, type: "override"});
                    } else {
                        console.log("unsupported style of assignment");
                    }
                }
            }
        }
    });
    return rewriteSpecs;
}

function rewriteSelect(node:CallExpression, _ancestors:Array<Node>):RewriteSpec {
    const triggers = [];
    const funcs = [];
    for (let i = 1; i < node.arguments.length; i += 2) {
        triggers.push({start: node.arguments[i].start, end: node.arguments[i].end});
    }
    for (let i = 2; i < node.arguments.length; i += 2) {
        funcs.push({start: node.arguments[i].start, end: node.arguments[i].end});
    }
    const init = {start: node.arguments[0].start, end: node.arguments[0].end};
    const classType: "Behaviors"|"Events" = (((node.callee) as MemberExpression).object as Identifier).name === "Events" ? "Events" : "Behaviors";
    return {type: "select", classType, init, triggers, funcs};
}

function isNonTopEvent(node:Node, ancestors:Array<Node>) {
    if (node.type !== "CallExpression") {return false;}
    const call = node = node as CallExpression;
    const callee = call.callee;
    return callee.type === "MemberExpression" 
        && callee.object.type === "Identifier"
        && (callee.object.name === "Events" || callee.object.name === "Behaviors")
        && callee.property.type === "Identifier"
        && ancestors.length > 2
        && ancestors[ancestors.length - 2].type !== "VariableDeclarator";
}

function isSelect(node:Node, _ancestors:Array<Node>) {
    if (node.type !== "CallExpression") {return false;}

    const call = node = node as CallExpression;
    const callee = call.callee;
    return callee.type === "MemberExpression" 
        && callee.object.type === "Identifier"
        && (callee.object.name === "Events" || callee.object.name === "Behaviors")
        && callee.property.type === "Identifier"
        && callee.property.name === "select"
}

function hasFunctionDeclaration(_node:Node, ancestors:Array<Node>) {
    return !!ancestors.find((a) => a.type === "ArrowFunctionExpression");
}

function isTopObjectDeclaration(node:VariableDeclarator, ancestors:Array<Node>) {
    return node.type === "VariableDeclarator" &&
        node.id.type === "ObjectPattern" &&
        ancestors.length === 3;
}

