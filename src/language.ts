import {parseJavaScript} from "./javascript/parse.ts"
import {transpileJavaScript} from "./javascript/transpile.ts"

import {ProgramState, ScriptCell} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body">

/*
const ary = [
    `let fby = null`,
    `const a = 42; const b = a + 1`,
    `const e = d + 1`,
    `const c = b + 1; const d = fby(1, (d) => d + 1)`,
];

const jsNodes = ary.map((code) => parseJavaScript(code, {}));

const translated = jsNodes.map((node, i) => transpileJavaScript(node, {id: `${i}`}));

console.log(translated);

const evaluated = translated.map((tr) => eval(tr));

const sorted = topologicalSort(evaluated);
console.log(sorted);

*/

export function setupProgram(scripts:HTMLScriptElement[], state:ProgramState) {
    const jsNodes = scripts.map((script) => parseJavaScript(script.textContent!, {path:''}));
    const translated = jsNodes.map((node, i) => transpileJavaScript(node, {id: `${i}`}));
    const evaluated = translated.map((tr) => evalCode(tr));

    evaluated.forEach((obj) => {
        obj.inputs = obj.inputs || [];
        obj.outputs = obj.outputs || [];
    });
    
    const sorted = topologicalSort(evaluated);

    state.order = sorted;
    state.nodes = new Map(evaluated.map((e) => [e.id, e]));
    state.promises = new Map();
    state.resolved = new Map();
    state.inputArray = new Map();
    state.outputs = new Map();
}

export function evaluate(state:ProgramState, _t:number, requestEvaluation: () => void) {
    function ready(inputs:Array<Promise<any>|undefined>) {
        for (const promise of inputs) {
            const resolved = promise && state.resolved.get(promise);
            if (resolved === undefined) {return false;}
        }
        return true;
    }

    function equals(aArray?:Array<any|undefined>, bArray?:Array<any|undefined>) {
        if (!Array.isArray(aArray) || !Array.isArray(bArray)) {return false;}
        if (aArray.length !== bArray.length) {
            return false;
        }
        for (let i = 0; i < aArray.length; i++) {
            if (aArray[i] !== bArray[i]) {return false;}
        }
        return true;
    }

    // console.log(state);
    for (let id of state.order) {
        const node = state.nodes.get(id)!;
        const inputs:Array<Promise<any>|undefined> = node.inputs.map((inputName) => {
            // console.log(state);
            return state.promises.get(inputName);
        }); 

        // console.log("check ready ", id);
        const isReady = ready(inputs);
        if (!isReady) {continue;}

        const inputArray = inputs.map((promise) => promise && state.resolved.get(promise));
        const lastInputArray = state.inputArray.get(id);

        let outputs:{[key:string]: any};
        if (equals(inputArray, lastInputArray)) {
            outputs = state.outputs.get(id);
        } else {
            outputs = node.body.apply(
                window,
                inputArray
            );
            state.inputArray.set(id, inputArray);
            state.outputs.set(id, outputs);
        }
        
        for (const output in outputs) {
            let maybeValue = outputs[output];
            if (!maybeValue.then) {
                let promise = Promise.resolve(maybeValue);
                state.promises.set(output, promise)
                state.resolved.set(promise, maybeValue);
            } else {
                state.promises.set(output, maybeValue);
                maybeValue.then((value:any) => {
                    const wasResolved = state.resolved.get(maybeValue);
                    if (!wasResolved) {
                        state.resolved.set(maybeValue, value);
                        requestEvaluation?.();
                    }
                });
            }
        }
    }
}

function define(spec:ScriptCell) {
   return spec;
}

function fby<T>(init:T, updater: (v:T) => T, id:number, state:any) {
    if (!state[`fby_${id}]`]) {
        state[`fby_${id}]`] = true;
        state[`fby_${id}_value`] = init;
        return init;
    }
    const value = state[`fby_${id}_value`];
    const newValue = updater(value);
    state[`fby_${id}_value`] = newValue;
    return newValue;
}

function evalCode(str:string):ScriptCell {
    let code = `return ${str}`;
    let func = new Function("fby", "define", code);
    return func(fby, define);
}

function topologicalSort(nodes:Array<ScriptCell>) {
    let order = [];

    let workNodes:Array<ScriptCellForSort> = nodes.map((node) => ({
        id: node.id,
        inputs: [...node.inputs],
        outputs: [...node.outputs],
    }));
    
    function hasEdge(src:ScriptCellForSort, dst:ScriptCellForSort) {
        for (let s of src.outputs) {
            if (dst.inputs.includes(s)) {
                return true;
            }
        }
        return false;
    }

    function removeEdges(src:ScriptCellForSort, dst:ScriptCellForSort) {
        let edges = [];
        for (let srcE of src.outputs) {
            let index = dst.inputs.indexOf(srcE);
            if (index >= 0) {edges.push(srcE);}
        }

        dst.inputs = dst.inputs.filter((input) => !edges.includes(input));
    }

    const leaves = workNodes.filter((node) => node.inputs.length === 0);
    while (leaves[0]) {
        let n = leaves[0];
        leaves.shift();
        order.push(n.id);
        let ms = workNodes.filter((node) => hasEdge(n, node));
        for (let m of ms) {
            removeEdges(n, m);
            if (m.inputs.length === 0) {
                leaves.push(m);
            }
        }
    }
    return order;
}
