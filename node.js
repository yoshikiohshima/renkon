import {ProgramState} from "./dist/renkon.js";

export function setup(optFileNames) {
    const programState = new ProgramState(Date.now(), null, true);
    let fileNames = optFileNames;
    if (!fileNames) {
        console.log(process.argv);
        const index = process.argv.lastIndexOf("--");
        if (index >= 0) {
            fileNames = process.argv.slice(index + 1);
        }
    }
    if (!fileNames || fileNames.length === 0) {
        console.log("no renkon module specified");
        process.exit(1);
    }

    Promise.all(fileNames.map((f) => import(f))).then((modules) => {
        const funcs = [];
 
        modules.forEach((module) => {
            const keys = Object.keys(module);

            for (const key of keys) {
                if (typeof module[key] === "function") {
                    funcs.push(module[keys]);
                }
            }
            programState.merge(...funcs);
        })
    })
    return programState;
}

const programState = setup();

function loop() {
    programState.noTickingEvaluator();
    new Promise((resolve) => setTimeout(() => {
        resolve(true);
    }, 1000)).then((v) => loop());
}

loop();