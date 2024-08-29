import {ProgramState} from "./dist/renkon.js";

function run() {
    const state = new ProgramState();
    state.setupProgram(
        [`
const a = 4;
const b = a + 3;
const c = new Promise((resolve) => setTimeout(() => resolve(100), 1000));
const d = console.log(c + b);
`
        ]);

    state.noTickingEvaluator();
}

run();
