import type {CallExpression, VariableDeclarator, ObjectPattern, Node, AssignmentProperty} from "acorn";
import {ancestor} from "acorn-walk";

type RewriteSpec = ({
    type: "range";
    start: number; 
    end: number; 
    name: string;
} | {
    type: "override",
    definition: string,
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

function hasFunctionDeclaration(_node:Node, ancestors:Array<Node>) {
    return !!ancestors.find((a) => a.type === "ArrowFunctionExpression");
}

function isTopObjectDeclaration(node:VariableDeclarator, ancestors:Array<Node>) {
    return node.type === "VariableDeclarator" &&
        node.id.type === "ObjectPattern" &&
        ancestors.length === 3;
}
