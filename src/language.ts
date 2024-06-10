import {parseJavaScript} from "./javascript/parse.ts"
import {transpileJavaScript} from "./javascript/transpile.ts"

import {ProgramState, ScriptCell, ObserveCallback, isEvent, Event, Stream, VarName, NodeId} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code">

export function setupProgram(scripts:HTMLScriptElement[], state:ProgramState) {
   /* if (window.setupProgramCalled === undefined) {
        window.setupProgramCalled = 0;
    }
    window.setupProgramCalled++;
    */
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (let [varName, stream] of state.streams) {
        if ((stream as Event)[isEvent]) {
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

    // compile code and sort them.
    const codes = new Map(scripts.map((script, i) => ([script.id !== "" ? script.id : `${i}`, script.textContent || ""])));
    const jsNodes = [...codes].map(([id, code]) => ({id, jsNode: parseJavaScript(code, {path:''})}))
    const translated = jsNodes.map(({id, jsNode}) => transpileJavaScript(jsNode, {id}));
    const evaluated = translated.map((tr) => evalCode(tr));
    const sorted = topologicalSort(evaluated);

    const newNodes = new Map<NodeId, ScriptCell>();

    const oldVariableNames:Set<VarName> = new Set();
    const newVariableNames:Set<VarName> = new Set();

    state.order.forEach((nodeId) => {
        const old = state.nodes.get(nodeId);
        if (old) {
            old.outputs.forEach((varName) => oldVariableNames.add(varName));
        }
    });

    evaluated.forEach((cell) => {
        newNodes.set(cell.id, cell);
        cell.outputs.forEach((varName) => newVariableNames.add(varName));
    });

    const removedVariableNames = difference(oldVariableNames, newVariableNames);
    const removedNodes:Set<NodeId> = new Set(state.order);

    for (const old of state.order) {
        if (!newNodes.get(old)) {
            removedNodes.add(old);
        }
    }

    state.order = sorted;
    state.nodes = newNodes;

    for (const nodeId of state.order) {
        const newNode = newNodes.get(nodeId)!;
        if (invalidatedInput(newNode, invalidatedStreamNames)) {
            state.inputArray.delete(newNode.id);
        }
    }

    for (const nodeId of removedNodes) {
        state.outputs.delete(nodeId);
        state.inputArray.delete(nodeId);
    }

    for (const removed of removedVariableNames) {
        const stream = state.streams.get(removed);
        if (stream) {
            state.resolved.delete(stream);
            state.streams.delete(removed);
        }
        state.streams.delete(removed);
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
            if (typeof maybeValue === "object" && maybeValue[isEvent]) {
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
    for all promises, check if it is actually an event.
    if it is resolved, its promise and resolved will be cleared
    */
    for (let [varName, stream] of state.streams) {
        if ((stream as any)[isEvent]) {
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
    let returnValue:any = {[isEvent]: true};
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

const Behaviors = {
    delay(value:any, t: number) {
        return new Promise((resolve, _reject) => setTimeout(() => resolve(value), t));
    /*
    const d = Behavior.delay(c, 50);

    => 
        d = new Promise((resolve, reject) => (setTimeout(() => c, 50))

    */
    }
}

function evalCode(str:string):ScriptCell {
    let code = `return ${str}`;
    let func = new Function("fby", "define", "Events", "Behaviors", code);
    let val = func(fby, define, Events, Behaviors);
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

function invalidatedInput(node:ScriptCell, invalidatedVars:Set<string>) {
    for (const input of node.inputs) {
        if (invalidatedVars.has(input)) {
            return true;
        }
    }
    return false;
}

function difference(oldSet:Set<VarName>, newSet:Set<VarName>) {
    const result = new Set<VarName>();
    for (const key of oldSet) {
        if (!newSet.has(key)) {
            result.add(key);
        }
    }
    return result;
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
