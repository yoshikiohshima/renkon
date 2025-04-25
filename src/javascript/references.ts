import type {
  AnonymousFunctionDeclaration,
  ArrowFunctionExpression,
  BlockStatement,
  CallExpression,
  CatchClause,
  Class,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  Literal,
  Node,
  Pattern,
  Program
} from "acorn";
import {ancestor, simple} from "acorn-walk";
import {globals} from "./globals.js";

// Based on https://github.com/ForbesLindesay/acorn-globals
// Portions copyright 2014 Forbes Lindesay.
// https://github.com/ForbesLindesay/acorn-globals/blob/master/LICENSE

type FunctionNode = FunctionExpression | FunctionDeclaration | ArrowFunctionExpression | AnonymousFunctionDeclaration;

function isScope(node: Node): node is FunctionNode | Program {
  return (
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "Program"
  );
}

// prettier-ignore
function isBlockScope(node: Node): node is FunctionNode | Program | BlockStatement | ForInStatement | ForOfStatement | ForStatement {
  return (
    node.type === "BlockStatement" ||
    node.type === "SwitchStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement" ||
    node.type === "ForStatement" ||
    isScope(node)
  );
}

export function isCombinatorOf(node:CallExpression, cls: "Events"|"Behaviors"|"Any", sels: string[]|"any"):boolean {
  const callee = node.callee;
  const names = cls === "Any" ? ["Behaviors", "Events"] : [cls];
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    if (names.includes(callee.object.name)) {
      if (callee.property.type === "Identifier" && (sels === "any" || sels.includes(callee.property.name))) {
        return true;
      }
    }
  }
  return false;
}

export function findReferences(node: Node, {filterDeclaration = () => true}: {
    filterDeclaration?: (identifier: {name: string}) => any;
  } = {}
): [Identifier[], Identifier[], Identifier[], {gather?:string, isSelect?:boolean}] {
  const locals = new Map<Node, Set<string>>();
  const references: Identifier[] = [];
  const sendTarget: Identifier[] = [];

  function hasLocal(node: Node, name: string): boolean {
    const l = locals.get(node);
    return l ? l.has(name) : false;
  }

  function declareLocal(node: Node, id: {name: string}): void {
    if (!filterDeclaration(id)) return;
    const l = locals.get(node);
    if (l) l.add(id.name);
    else locals.set(node, new Set([id.name]));
  }

  function declareClass(node: Class) {
    if (node.id) declareLocal(node, node.id);
  }

  function declareFunction(node: FunctionNode) {
    node.params.forEach((param) => declarePattern(param, node));
    if (node.id) declareLocal(node, node.id);
    if (node.type !== "ArrowFunctionExpression") declareLocal(node, {name: "arguments"});
  }

  function declareCatchClause(node: CatchClause) {
    if (node.param) declarePattern(node.param, node);
  }

  function declarePattern(node: Pattern, parent: Node) {
    switch (node.type) {
      case "Identifier":
        declareLocal(parent, node);
        break;
      case "ObjectPattern":
        node.properties.forEach((node) => declarePattern(node.type === "Property" ? node.value : node, parent));
        break;
      case "ArrayPattern":
        node.elements.forEach((node) => node && declarePattern(node, parent));
        break;
      case "RestElement":
        declarePattern(node.argument, parent);
        break;
      case "AssignmentPattern":
        declarePattern(node.left, parent);
        break;
    }
  }

  ancestor(node, {
    VariableDeclaration(node, _state, parents) {
      let parent: Node | null = null;
      for (let i = parents.length - 1; i >= 0 && parent === null; --i) {
        if (node.kind === "var" ? isScope(parents[i]) : isBlockScope(parents[i])) {
          parent = parents[i];
        }
      }
      node.declarations.forEach((declaration) => declarePattern(declaration.id, parent!));
    },
    FunctionDeclaration(node, _state, parents) {
      let parent: Node | null = null;
      for (let i = parents.length - 2; i >= 0 && parent === null; --i) {
        if (isScope(parents[i])) {
          parent = parents[i];
        }
      }
      if (node.id) declareLocal(parent!, node.id);
      declareFunction(node);
    },
    FunctionExpression: declareFunction,
    ArrowFunctionExpression: declareFunction,
    ClassDeclaration(node, _state, parents) {
      let parent: Node | null = null;
      for (let i = parents.length - 2; i >= 0 && parent === null; --i) {
        if (isScope(parents[i])) {
          parent = parents[i];
        }
      }
      if (node.id) declareLocal(parent!, node.id);
    },
    ClassExpression: declareClass,
    CatchClause: declareCatchClause,
    ImportDeclaration(node, _state, [root]) {
      node.specifiers.forEach((specifier) => declareLocal(root, specifier.local));
    },
    CallExpression(node) {
      if (isCombinatorOf(node, "Events", ["send"])) {
        const arg = node.arguments[0];
        if (arg.type === "Identifier") {
          sendTarget.push(arg);
        }
      }
    }
  });

  function identifier(node: Identifier, _state: never, parents: Node[]) {
    const name = node.name;
    if (name === "undefined") return;
    for (let i = parents.length - 2; i >= 0; --i) {
      if (hasLocal(parents[i], name)) {
        return;
      }
    }
    if (globals[name] !== false) {
      references.push(node);
    }
  }

  ancestor(node, {
    Pattern(node, state, parents) {
      if (node.type === "Identifier") {
        identifier(node, state, parents);
      }
    },
    Identifier: identifier
  });

  const forceVars:Identifier[] = [];
  const extraType:{gather?:string, isSelect?:boolean} = {};

  simple(node, {
    CallExpression(node) {
      if (isCombinatorOf(node, "Events", ["or", "_or_index", "some"])) {
        for (const arg of node.arguments) {
          if (arg.type === "Identifier") {
            forceVars.push(arg);
          }
        }
      } else if (isCombinatorOf(node, "Behaviors", ["collect"])) {
        const arg = node.arguments[1];
        if (arg.type === "Identifier") {
          forceVars.push(arg);
        }
      } else if (isCombinatorOf(node, "Behaviors", ["_select"])) {
        if (node.arguments[1].type === "Identifier") {
          const name = node.arguments[1].name;
          if (/^_[0-9]/.exec(name)) {
            forceVars.push(node.arguments[1]);
          }
          extraType["isSelect"] = true;
        }
      } else if (isCombinatorOf(node, "Behaviors", ["gather"])) {
        extraType["gather"] = (node.arguments[0] as Literal).value as string;
      } else if (isCombinatorOf(node, "Behaviors", ["or", "_or_index", "some"])) {
        for (const arg of node.arguments) {
          if (arg.type === "Identifier") {
            forceVars.push(arg);
          }
        }
      }
    }
  });
    return [references, forceVars, sendTarget, extraType]
}
