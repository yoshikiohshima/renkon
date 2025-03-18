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
        try {
            const compiled = detype(tsCode);
            return compiled;
        } catch (error) {
            const e = error as unknown as SyntaxError & {pos:number};
            const message = e.message + ": error around -> " + `\n"${input.slice(e.pos - 30, e.pos + 30)}`;
            console.log(message);
            throw error;
        }
    }
}

export function translateTS(text:string, path:string) {
    return (new TSCompiler()).compile(text, path);
}
