import type {Identifier, ModuleDeclaration, Pattern, Program, Statement} from "acorn";
import {globals} from "./globals.js";
import {syntaxError} from "./syntaxError.js";

export function findDeclarations(node: Program, input: string): Identifier[] {
  const declarations: Identifier[] = [];

  function declareLocal(node: Identifier) {
    if (globals[node.name] === false || node.name === "arguments") {
      throw syntaxError(`Global '${node.name}' cannot be redefined`, node, input);
    }
    declarations.push(node);
  }

  function declarePattern(node: Pattern) {
    switch (node.type) {
      case "Identifier":
        declareLocal(node);
        break;
      case "ObjectPattern":
        node.properties.forEach((node) => declarePattern(node.type === "Property" ? node.value : node));
        break;
      case "ArrayPattern":
        node.elements.forEach((node) => node && declarePattern(node));
        break;
      case "RestElement":
        declarePattern(node.argument);
        break;
      case "AssignmentPattern":
        declarePattern(node.left);
        break;
    }
  }

  for (const child of node.body) {
    switch (child.type) {
      case "VariableDeclaration":
        child.declarations.forEach((node) => declarePattern(node.id));
        break;
      case "ClassDeclaration":
      case "FunctionDeclaration":
        declareLocal(child.id);
        break;
      case "ImportDeclaration":
        child.specifiers.forEach((node) => declareLocal(node.local));
        break;
        case "ExportNamedDeclaration":
          if (child.declaration?.type === "VariableDeclaration") {
            child.declaration.declarations.forEach((node) => declarePattern(node.id));
          } else if (child.declaration?.type === "FunctionDeclaration") {
            declareLocal(child.declaration.id);
          }
      }
  }

  return declarations;
}

export function findTopLevelDeclarations(node: Statement | ModuleDeclaration): string[] {
  const declarations: string[] = [];

  function declareLocal(node: Identifier) {
    declarations.push(node.name);
  }

  function declarePattern(node: Pattern) {
    switch (node.type) {
      case "Identifier":
        declareLocal(node);
        break;
      case "ObjectPattern":
        node.properties.forEach((node) => declarePattern(node.type === "Property" ? node.value : node));
        break;
      case "ArrayPattern":
        node.elements.forEach((node) => node && declarePattern(node));
        break;
      case "RestElement":
        declarePattern(node.argument);
        break;
      case "AssignmentPattern":
        declarePattern(node.left);
        break;
    }
  }

  switch (node.type) {
    case "VariableDeclaration":
      node.declarations.forEach((child) => declarePattern(child.id));
      break;
    case "ClassDeclaration":
    case "FunctionDeclaration":
      declareLocal(node.id);
      break;
    case "ExportNamedDeclaration":
      if (node.declaration?.type === "VariableDeclaration") {
        node.declaration.declarations.forEach((child) => declarePattern(child.id));
      } else if (node.declaration?.type === "FunctionDeclaration") {
        declareLocal(node.declaration.id);
      }
    }

  return declarations;
}
