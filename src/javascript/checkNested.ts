import type {CallExpression, MemberExpression, VariableDeclarator, ObjectPattern, ArrayPattern, Node, Identifier, AssignmentProperty, Program} from "acorn";
import {ancestor} from "acorn-walk";
import {isCombinatorOf} from "./references";

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


export function checkNested(
    body: Node,
    baseId: number
): Array<RewriteSpec> {
    const rewriteSpecs:Array<RewriteSpec> = [];
    if (body.type === "Program" && (body as Program).body[0].type === "FunctionDeclaration") return rewriteSpecs;
    ancestor(body, {
        CallExpression(node, ancestors:Array<Node>) {
            const inFunction = hasFunctionDeclaration(node, ancestors);
            const isEmbeddedCombinator = isNonTopCombinator(node, ancestors);
            const isSelectCall = isSelect(node, ancestors);
            const isOrCall = isOr(node, ancestors);
            if (isSelectCall) {
                const rewrite = rewriteSelect(node, ancestors);
                rewriteSpecs.unshift(rewrite);
            }
            if (isOrCall) {
                const rewrites = rewriteOr(node, baseId, rewriteSpecs);
                rewriteSpecs.push(...rewrites);
            }
            if (isEmbeddedCombinator && !inFunction) {
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
            if (isTopArrayDeclaration(node, ancestors) && node.init) {
                const baseName = `_${baseId}_${rewriteSpecs.length}`;
                rewriteSpecs.push({start: node.init.start, end: node.init.end, name: baseName, type: "range"});
                const id:ArrayPattern = node.id as ArrayPattern;
                const elements = id.elements;

                for (let ind = 0; ind < elements.length; ind++) {
                    const element = elements[ind];
                    if (!element) {return;}
                    if (element.type === "RestElement") {
                        console.log("unsupported style of assignment");
                        continue;
                    }
                    const p = element;
                    if (p.type === "Identifier") {
                        rewriteSpecs.push({definition: `const ${p.name} = ${baseName}[${ind}]`, type: "override"});
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

function rewriteOr(node:CallExpression, baseId:number, rewriteSpecs:Array<RewriteSpec>):Array<RewriteSpec> {
    const triggers:Array<RewriteSpec> = [];
    for (let i = 0; i < node.arguments.length; i++) {
        const child = node.arguments[i];
        if (child.type === "Identifier") {continue;}
        const maybeName = `_${baseId}_${triggers.length + rewriteSpecs.length}`;
        triggers.push({
            type: "range",
            name: maybeName,
            start: child.start,
            end: child.end});
    }
    return triggers;
}

function isNonTopCombinator(node:Node, ancestors:Array<Node>) {
    if (node.type !== "CallExpression") {return false;}
    return isCombinatorOf(node as CallExpression, "Any", "any") && ancestors.length > 2
        && ancestors[ancestors.length - 2].type !== "VariableDeclarator"
}

function isSelect(node:Node, _ancestors:Array<Node>) {
    if (node.type !== "CallExpression") {return false;}
    return isCombinatorOf(node as CallExpression, "Any", ["select"]);
}

function isOr(node:Node, _ancestors:Array<Node>) {
    if (node.type !== "CallExpression") {return false;}
    return isCombinatorOf(node as CallExpression, "Any", ["or", "_or_index", "some"]);
}

function hasFunctionDeclaration(_node:Node, ancestors:Array<Node>) {
    return !!ancestors.find((a) => a.type === "ArrowFunctionExpression");
}

function isTopObjectDeclaration(node:VariableDeclarator, ancestors:Array<Node>) {
    return node.type === "VariableDeclarator" &&
        node.id.type === "ObjectPattern" &&
        ancestors.length === 3;
}

function isTopArrayDeclaration(node:VariableDeclarator, ancestors:Array<Node>) {
    return node.type === "VariableDeclarator" &&
        node.id.type === "ArrayPattern" &&
        ancestors.length === 3;
}
