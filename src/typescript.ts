//import {ModuleKind, ScriptTarget, createProgram, createSourceFile, getDefaultLibFileName} from "typescript";

import {detype} from "./javascript/detype";

export class TSCompiler {
    sources: Map<string, string>;
    results: Map<string, string>;
    constructor() {
        this.sources = new Map();
        this.results = new Map();
    }
    compile(tsCode:string, _path:string) {
        const compiled = detype(tsCode);
        return compiled;
    }
}

export function translateTS(text:string, path:string) {
    return (new TSCompiler()).compile(text, path);
}
