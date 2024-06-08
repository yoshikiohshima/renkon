import {parseJavaScript} from "./javascript/parse.ts"
import {transpileJavaScript} from "./javascript/transpile.ts"

import {ProgramState, ScriptCell, ObserveCallback, isGenerator, Event, Stream, VarName, NodeId} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code">

export function setupProgram(scripts:HTMLScriptElement[], state:ProgramState) {
    if (window.setupProgramCalled === undefined) {
        window.setupProgramCalled = 0;
    }
    window.setupProgramCalled++;
    const invalidatedNodes:Set<NodeId> = new Set();
    const invalidatedStreamNames:Set<VarName> = new Set();
    for (let [varName, stream] of state.streams) {
        if ((stream as any)[isGenerator]) {
            stream = stream as Event;
            if (stream.cleanup && typeof stream.cleanup === "function") {
                stream.cleanup();
                stream.cleanup = null;
            }
        }
        state.resolved.delete(stream);
        state.streams.delete(varName);
        invalidatedStreamNames.add(varName);
    }

    const codes = new Map(scripts.map((script, i) => ([script.id !== "" ? script.id : `${i}`, script.textContent || ""])));
    const jsNodes = [...codes].map(([id, code]) => ({id, jsNode: parseJavaScript(code, {path:''})}))
    const translated = jsNodes.map(({id, jsNode}) => transpileJavaScript(jsNode, {id}));
    const evaluated = translated.map((tr) => evalCode(tr));

    const sorted = topologicalSort(evaluated);

    state.order = sorted;

    const removedNodes:Set<string> = new Set(state.order);
    for (const node of evaluated) {
        const exist = state.nodes.get(node.id);
        removedNodes.delete(node.id);
        if (exist && exist.code !== node.code) {
            invalidatedNodes.add(node.id);
        }
        if (exist && invalidatedOutput(exist, invalidatedStreamNames)) {
            invalidatedNodes.add(node.id)
        }
        state.nodes.set(node.id, node);
    }

    const clearNodes = invalidNodes(state, invalidatedNodes);

    for (const nodeId of clearNodes) {
        const node = state.nodes.get(nodeId);
        if (!node) {continue;}
        state.outputs.delete(node.id);
        state.inputArray.delete(node.id);
    }
}

export function evaluate(state:ProgramState, _t:number, requestEvaluation: () => void) {
    // if (window.setupProgramCalled === 2) {debugger;}


    // console.log(state);
    for (let id of state.order) {
        const node = state.nodes.get(id)!;
        const inputs:Array<Stream|undefined> = node.inputs.map((inputName) => {
            // console.log(state);
            return state.streams.get(inputName);
        }); 

        // console.log("check ready ", id);
        const isReady = ready(inputs, state);
        if (!isReady) {continue;}

        const inputArray = inputs.map((stream) => stream && state.resolved.get(stream));
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
            if (typeof maybeValue === "object" && maybeValue[isGenerator]) {
                maybeValue.requestEvaluation = requestEvaluation;
            }
            if (!maybeValue.then) {
                let stream = Promise.resolve(maybeValue);
                state.streams.set(output, stream)
                state.resolved.set(stream, maybeValue);
            } else {
                state.streams.set(output, maybeValue);
                maybeValue.then((value:any) => {
                    const wasResolved = state.resolved.get(maybeValue);
                    if (!wasResolved) {
                        state.resolved.set(maybeValue, value);
                        requestEvaluation();
                    }
                });
            }
        }
    }
    /*
    for all promises, check if it is actually a generator.
    if it is resolved, its promise and resolved will be cleared
    */
    for (let [varName, stream] of state.streams) {
        if ((stream as any)[isGenerator]) {
            stream = stream as Event;
            if (state.resolved.get(stream) !== undefined) {
                state.resolved.delete(stream);
                stream.updater();
                const newStream = {...stream};
                state.streams.set(varName, newStream);
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

type EventBodyType = {
    forObserve: boolean;
    callback?: ObserveCallback;
    dom?: HTMLInputElement;
};

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom} = options;
    let returnValue:any = {[isGenerator]: true};
    let myResolve: (v:any) => void;
    // let myReject: () => void;
    let then:(v:any) => any; 
    let myPromise:Promise<any>;

    let handler = (evt:any) => {
        myResolve(evt.target.value);
        returnValue.requestEvaluation();
    };

    const notifier = (val:any) => {
        myResolve(val);
        returnValue.requestEvaluation();
    }
    if (dom && !forObserve) {
        dom.addEventListener("input", handler);
    }

    const updater = () => {
        myPromise = new Promise((resolve, _reject) => {
            myResolve = resolve;
            // myReject = reject;
        });
        then = (func) => {
            return myPromise.then(func);
        };
        returnValue.then = then;
        returnValue.promise = myPromise;
    }

    updater();
    if (forObserve && callback) {
        returnValue.cleanup = callback(notifier);
    }
    if (!forObserve && dom) {
        returnValue.cleanup = () => {
            dom.removeEventListener("input", handler);
        }
    }
    returnValue.updater = updater;
    return returnValue;
}

const Events = {
    observe: (callback:ObserveCallback) => {
        return eventBody({forObserve: true, callback});
    },
    input: (dom:HTMLInputElement) => {
        return eventBody({forObserve: false, dom});
    }
};

function evalCode(str:string):ScriptCell {
    let code = `return ${str}`;
    let func = new Function("fby", "define", "Events", code);
    let val = func(fby, define, Events);
    val.code = str;
    return val;
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

function invalidNodes(state: ProgramState, ids:Set<string>):Set<string> {
    function has(anArray:Array<string>, set:Set<string>) {
        for (const a of anArray) {
            if (set.has(a)) {return true;}
        }
        return false;
    }

    const invalidatedVars:Set<string> = new Set();
    const nodes:Set<string> = new Set(ids);

    for (const nodeId of ids) {
        const outputs = state.nodes.get(nodeId)?.outputs;
        outputs!.forEach((out) => invalidatedVars.add(out));
    }

    for (const nodeId of state.order) {
        const node = state.nodes.get(nodeId);
        if (has(node!.inputs, invalidatedVars)) {
            const outputs = state.outputs.get(nodeId);
            for (const out in outputs) {
                invalidatedVars.add(out);
            }
            nodes.add(nodeId);
        }
    }
    return nodes;
}

function invalidatedOutput(node:ScriptCell, invalidatedVars:Set<string>) {
    for (const out of node.outputs) {
        if (invalidatedVars.has(out)) {
            return true;
        }
    }
    for (const input of node.inputs) {
        if (invalidatedVars.has(input)) {
            return true;
        }
    }
    return false;
}

function ready(inputs:Array<Stream|undefined>, state: ProgramState) {
    for (const stream of inputs) {
        const resolved = stream && state.resolved.get(stream);
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

/*
  We follow some good ideas in the Observable Framework.

  A block of code can have top-level variables that are by default reactive.

  The declaration of a top level variable becomes known to it.

  a top-level variable can contain a promise or generator or a regular value.

  We figure out the dependency graph of the top level variables. We keep the idea of blocks and simply re-evaluate the block accordingly.

  we also have the code edited and reloaded. The basic idea was to keep the values of behaviors but not events' .Can we do it?

  Do we use the trick of using undefined as undefined, or rather, 

  Let us make sure that basic combinators can be implemented.

  The line between behaviors and events are murky. A normal value in program text is a behavior. A loading event or promise firing is an event. a cached value would be an event converted to a behavior. animation frame is an event.

  implicit conversion between Bs and Es are ok. Unless it is explicitly prevented perhaps with a different combinator, a computed value would become a behavior upon storing into the state.

  const y = new Promise((resolve) => setTimeout(() => resolve(42), 1000));
  // y would be considered event
  
  const x = y + 3;
  // x is undefined until 1000 ms passes. 3 is a behavior and the computed value is an event but the resulting x a behavior.

  oneE: a normal value that is used on reload.
  zeroE: if we use the undefined trick it is that.
  mapE: a simple expression.
  mergeE: it'd have to be combinator.

  switchE: we will do things without this.
  condE: a combinator (but probably not actually needed)

  filterE: would need the undefined trick
  ifE: would be easy to use ?:

  collectE: this is interesting as it won't have the access to the previous value. perhaps we can have a $-prefixed variable to indicate the previous value.

  andE, orE, notE: simple expressions
  
  delayE: will be a combinator, in a way, basically a syntax sugar of setTimeout

  blineE: a combinator
  calmE: a combinator

  timeE: a syntax sugar of setInterval but returns a promise that would be replaced with a fresh one upon computing values.

  
  We can have a class called Stream. it represents a time varying value.

  Observable Framework uses Acorn parser. I think we can do that too.

  Another good feature is the integration with DOM input elements.
  
  */
