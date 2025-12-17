export {ProgramState, version} from "./language";
export {parseJSX} from "./javascript/parse";
export {transpileJSX} from "./javascript/transpileJSX";
export {translateTS} from "./typescript";
export {globals} from "./javascript/globals";
export {loader} from "./loader";

import {version} from "./language";
console.log("Renkon core version:" + version);
