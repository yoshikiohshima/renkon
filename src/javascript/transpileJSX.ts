import type {Node} from "acorn";
import { parseJSX } from "./parse";

export function transpileJSX(code: string): string {
  const node = parseJSX(code);
  const result = rewriteJSX((node as any).body[0], code);
  if (typeof result === "string") {
    return result;
  } 
  return (result as Array<any>).flat(Infinity).join("");
}

type CodeFragments<T> = T | T[] | CodeFragments<T>[];

function rewriteJSX(
  body: Node,
  code: string
): CodeFragments<string> {
  function translate(body:any):CodeFragments<string> {
    if (body.type === "JSXElement") {
      const result = [];
      const opening = translate(body.openingElement);
      const children = body.children.map((c:Node) => translate(c));
      result.push(`h(`);
      result.push(...opening);
      if (children.length > 0) {
        const list = [children[0]]
        for (let i = 1; i < children.length; i++) {
          list.push(", ");
          list.push(children[i]);
        }
        result.push(", ");
        result.push(list);
      }
      result.push(")");
      return result;
    } else if (body.type === "JSXExpressionContainer") {
      return translate((body as any).expression);
    } else if (body.type === "JSXSpreadChild") {
      return "";
    } else if (body.type === "JSXClosingFragment") {
      return body.name;
    } else if (body.type === "JSXEmptyExpression") {
      return "";
    } else if (body.type === "JSXIdentifier") {
      return body.name;
    } else if (body.type === "JSXOpeningFragment") {
      return body.name;

    } else if (body.type === "JSXText") {
      return `"${body.value}"`;
    } else if (body.type === "JSXSpreadAttribute") {
      return "";
    } else if (body.type === "JSXAttribute") {
      return [translate(body.name), ": ", translate(body.value)];
      return "";
    } else if (body.type === "JSXMemberExpression") {
      return "";
    } else if (body.type === "JSXNamespacedName") {
      return "";
    } else if (body.type === "JSXOpeningElement") {
      const tag = translate(body.name);
      const attributes = body.attributes.map((a:Node) => translate(a));
      const attrs = [];
      if (attributes.length > 0) {
        for (let i = 0; i < attributes.length; i++) {
          if (i !== 0) {
            attrs.push(", ");
          }
          attrs.push(attributes[i]);
        }
      }
      return [`"${tag}"`, ", ", "{", ...attrs, "}"];
    } else if (body.type === "JSXClosingElement") {
      return "";
    } else if (body.type === "JSXFragment") {
      return "";
    } else if (body.type === "ExpressionStatement") {
      return translate(body.expression);
    } else if (body.type === "Identifier") {
      return body.name;
    } else if (body.type === "Literal") {
      return body.raw;
    }
    return code.slice(body.start, body.end);
  }
  return translate(body);
}