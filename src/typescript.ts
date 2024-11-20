import ts from "typescript";

export class TSCompiler {
    sources: Map<string, string>;
    results: Map<string, string>;
    constructor() {
        this.sources = new Map();
        this.results = new Map();
    }
    compile(tsCode:string, path:string) {
       const options = {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            noResolve: true,
        };

        const compilerHost = this.createCompilerHost();
        this.sources.set(path, tsCode);

        let program = ts.createProgram([path], options, compilerHost);
        program.emit();

        let compiledName = path.replace(/\.ts$/, ".js");

        let compiled = this.results.get(compiledName);
        this.sources.delete(path);
        this.results.delete(path);

        return compiled;
    }

    getSourceFile(fileName:string, languageVersion:any, _onError:any) {
        const sourceText = this.readFile(fileName);
        return sourceText !== undefined
            ? ts.createSourceFile(fileName, sourceText, languageVersion)
            : undefined;
    }

    readFile(fileName:string) {
        return this.sources.get(fileName);
    }

    writeFile(fileName:string, content:string) {
        this.results.set(fileName, content);
    }

    knownDirectories() {
        return [];
        // return ["croquet", "default"];
    }

    createCompilerHost() {
        return {
            getSourceFile: this.getSourceFile,
            getDefaultLibFileName: (defaultLibOptions:any) => "/" + ts.getDefaultLibFileName(defaultLibOptions),
            writeFile: (fileName:string, content:string) => this.writeFile(fileName, content),
            getCurrentDirectory: () => "/",
            getDirectories: (_path:string) => [],
            fileExists: () => true,
            readFile: (fileName:string) => this.readFile(fileName),
            getCanonicalFileName: (fileName:string) => fileName,
            useCaseSensitiveFileNames: () => true,
            getNewLine: () => "\n",
            getEnvironmentVariable: () => "", // do nothing
            resolveModuleNames: () => [],
        };
    }
}

export function translateTS(text:string, path:string) {
    return (new TSCompiler()).compile(text, path);
}
