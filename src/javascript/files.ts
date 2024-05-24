import {extname} from "node:path/posix";
import type {CallExpression, MemberExpression, Node} from "acorn";
import {ancestor, simple} from "acorn-walk";

export type FileExpression = {
  /** The FileAttachment(name) call expression. */
  node: CallExpression;
  /** The relative path to the source file from the referencing source. */
  name: string;
  /** The method, if known; e.g., "arrow" for FileAttachment("foo").arrow. */
  method?: string;
};

const KNOWN_FILE_EXTENSIONS = {
  ".arrow": "arrow",
  ".csv": "csv",
  ".db": "sqlite",
  ".html": "html",
  ".json": "json",
  ".parquet": "parquet",
  ".sqlite": "sqlite",
  ".tsv": "tsv",
  ".txt": "text",
  ".xlsx": "xlsx",
  ".xml": "xml",
  ".zip": "zip"
};

/**
 * Returns all calls to FileAttachment in the specified body. Throws a
 * SyntaxError if any of the calls are invalid (e.g., when FileAttachment is
 * passed a dynamic argument, or references a file that is outside the root).
 */
export function findFiles(
  body: Node,
  path: string,
  input: string,
  aliases?: Iterable<string> // ["FileAttachment"] for implicit import
): FileExpression[] {
    return [];
}

function isMemberExpression(node: Node): node is MemberExpression {
  return node.type === "MemberExpression";
}
