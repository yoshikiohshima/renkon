import {JavaScriptNode, parseJavaScript} from "./javascript/parse.ts"
import {transpileJavaScript} from "./javascript/transpile.ts"

import {
    ProgramState,
    ScriptCell, ObserveCallback, eventType, delayType, fbyType, 
    promiseType, behaviorType, Stream,
    DelayedEvent, FbyStream, PromiseEvent, Behavior, VarName, NodeId, EventType
} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

export function setupProgram(scripts:HTMLScriptElement[], state:ProgramState) {
   /* if (window.setupProgramCalled === undefined) {
        window.setupProgramCalled = 0;
    }
    window.setupProgramCalled++;
    */

   (window as any).programState = state;
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (let [varName, stream] of state.streams) {
        if ((stream as Event).type === eventType) {
            stream = stream as Stream;
            if (stream.cleanup && typeof stream.cleanup === "function") {
                stream.cleanup();
                stream.cleanup = null;
            }
            state.resolved.delete(varName);
            state.streams.delete(varName);
            invalidatedStreamNames.add(varName);
        }
    }

    // compile code and sort them.
    const jsNodes: Array<JavaScriptNode> = [];

    let id = 0;
    for (const script of scripts) {
        if (!script.textContent) {continue;}
        const nodes = parseJavaScript(script.textContent, id, false);
        for (const n of nodes) {
            jsNodes.push(n);
        }
        id += nodes.length;
    }
    const translated = jsNodes.map((jsNode) => transpileJavaScript(jsNode));
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
            state.resolved.delete(removed);
            state.streams.delete(removed);
        }
        state.streams.delete(removed);
    }
}

export function evaluate(state:ProgramState) {
    for (let id of state.order) {
        // if (window.wasResolved) {debugger;}
        const node = state.nodes.get(id)!;
        const isReady = ready(node, state);
        if (!isReady) {continue;}

        const inputArray = node.inputs.map((inputName) => state.resolved.get(inputName)?.value);
        // if (inputArray.length > 0) {console.log("inputArray", inputArray)};
        const lastInputArray = state.inputArray.get(id);

        let bodyEvaluated = false;

        let outputs:{[key:string]: any};
        if (equals(inputArray, lastInputArray)) {
            outputs = state.outputs.get(id);
        } else {
            outputs = node.body.apply(
                window,
                inputArray
            );
            state.inputArray.set(id, inputArray);
            for (const output in outputs) {
                const maybeValue = outputs[output];
                if (maybeValue.then) {
                    const promise = maybeValue;
                    promise.then((value:any) => {
                        const wasResolved = state.resolved.get(output)?.value;
                        if (!wasResolved) {
                            state.resolved.set(output, {value, time: state.time});
                        }
                    });
                    const e:PromiseEvent = {type: promiseType, promise};
                    outputs[output] = e;
                    state.streams.set(output, e);
                } else if ((maybeValue as Event).type === fbyType) {
                    if (!state.streams.get(output)) {
                        state.streams.set(output, maybeValue);
                        state.resolved.set(output, {value: (maybeValue as any).init, time: state.time});
                    } else {
                        outputs[output] = state.streams.get(output);
                    }
                }
            }
            state.outputs.set(id, outputs);

            // this is where the input values are available but not equal.
            // meaning that the Event returned from Behavior.delay 
            // can say when it wants to be triggered

            bodyEvaluated = true;
        }

        for (const output in outputs) {
            let maybeValue = outputs[output];

            if ((maybeValue as Event).type === delayType) {
                const oldStream = state.streams.get(output) as DelayedEvent;
                if (!oldStream || 
                    oldStream.delay !== maybeValue.delay ||
                    oldStream.varName !== maybeValue.varName
                ) {
                    state.streams.set(output, maybeValue);
                } else {
                    maybeValue = oldStream;
                }
                maybeValue = maybeValue as DelayedEvent;

                const value = spliceDelayedQueued(maybeValue, state.time);
                // console.log("value", value);
                if (value !== undefined) {
                    state.resolved.set(output, {value, time: state.time});
                    if (maybeValue.queue.length === 0) {
                        // state.activeTimers.delete(maybeValue);
                    }
                }
                const inputIndex = node.inputs.indexOf(maybeValue.varName);
                const myInput = inputArray[inputIndex];
                if (bodyEvaluated && myInput !== undefined) {
                    maybeValue.queue.push({time: state.time + maybeValue.delay, value: myInput});
                        // state.activeTimers.add(maybeValue);
                }
            } else if ((maybeValue as Event).type === eventType) {
                maybeValue = maybeValue as Event;
                state.streams.set(output, maybeValue);
                const value = getEventValue(maybeValue, state.time);
                if (value !== undefined) {
                    const wasResolved = state.resolved.get(output)?.value;
                    if (wasResolved === undefined) {
                        state.resolved.set(output, {value, time: state.time});
                    }
                }
            } else if ((maybeValue as Event).type === fbyType) {
                // if (maybeValue.current === 1) {debugger};
                type ArgTypes = Parameters<typeof maybeValue.updater>;
                maybeValue = maybeValue as FbyStream<typeof maybeValue.current, ArgTypes[1]>;
                const inputIndex = node.inputs.indexOf(maybeValue.varName);
                const inputValue = inputArray[inputIndex];
                if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
                    const value = maybeValue.updater(maybeValue.current, inputValue);
                    if (value !== undefined) {
                        // this is dubious as it crosses the event/behavior type bridge.
                        state.resolved.set(output, {value, time: state.time});
                        maybeValue.current = value;
                    }
                }
            } else if (maybeValue.type === promiseType) {
                // maybeValue = maybeValue as PromiseEvent;
                // state.streams.set(output, maybeValue);
                /*
                maybeValue.then((value:any) => {
                    const wasResolved = state.resolved.get(output)?.value;
                    if (!wasResolved) {
                        state.resolved.set(output, {value, time: t});
                    }
                });
                */
            } else {
                let stream:Behavior = {type: behaviorType, value: maybeValue}
                state.streams.set(output, stream)
                const resolved = state.resolved.get(output);
                if (!resolved || resolved.value !== maybeValue) {
                    state.resolved.set(output, {value: maybeValue, time: state.time});
                }
            }
        }
    }
    // for all streams, check if it is an event.
    // if it is resolved, its promise and resolved will be cleared

    for (let [varName, stream] of state.streams) {
        const type = (stream as Event).type;
        if (type === eventType || type === promiseType) {
            stream = stream as Stream;
            if (state.resolved.get(varName)?.value !== undefined) {
                console.log("deleting", varName);
                state.resolved.delete(varName);
            }
        }
    }
}

function define(spec:ScriptCell) {
   return spec;
}

type EventBodyType = {
    forObserve: boolean;
    callback?: ObserveCallback;
    dom?: HTMLInputElement | string;
    type: EventType;
};

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom, type} = options;
    let returnValue:any = {type, queue: []};

    let realDom:HTMLInputElement|undefined;
    if (typeof dom === "string") {
        if (dom.startsWith("#")) {
            realDom = document.querySelector(dom) as HTMLInputElement;
        } else {
            realDom = document.getElementById(dom) as HTMLInputElement;
        }
    } else {
        realDom = dom;
    }

    let handler = (evt:any) => {
        const value = evt.target.value;
        console.log("value", value);
        returnValue.queue.push({value, time: 0});
    };

    const notifier = (value:any) => {
        returnValue.queue.push({value, time: 0});
    };

    if (realDom && !forObserve) {
        realDom.addEventListener("input", handler);
    }

    if (forObserve && callback) {
        returnValue.cleanup = callback(notifier);
    }
    if (!forObserve && dom) {
        returnValue.cleanup = () => {
            if (realDom) {
                realDom.removeEventListener("input", handler);
            }
        }
    }

    return returnValue;
}

const Events = {
    observe: (callback:ObserveCallback) => {
        return eventBody({forObserve: true, callback, type: eventType});
    },
    input: (dom:HTMLInputElement) => {
        return eventBody({forObserve: false, dom, type: eventType});
    },
    fby<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):FbyStream<I, T> {
        return {type: fbyType, init, updater, varName, current: init};
    },
    delay(varName:VarName, delay: number):DelayedEvent {
        return {type: delayType, delay, varName, queue: []};
    },
};

const Behaviors = {
    keep(value:any) {
        return value
    }
}

function evalCode(str:string):ScriptCell {
    let code = `return ${str}`;
    let func = new Function("define", "Events", "Behaviors", code);
    let val = func(define, Events, Behaviors);
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

function ready(node: ScriptCell, state: ProgramState) {
    for (const output of node.outputs) {
        const stream = state.streams.get(output) as DelayedEvent;
        if (stream?.type === delayType) {
            if (stream.queue.length > 0) {return true;}
        }
    }
    for (const inputName of node.inputs) {
        const resolved = state.resolved.get(inputName)?.value;
        if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
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

function spliceDelayedQueued(event:DelayedEvent, t:number) {
    let last = -1;
    for (let i = 0; i < event.queue.length; i++) {
        if (event.queue[i].time >= t) {
            break;
        }
        last = i;
    }
    if (last < 0) {
        return undefined;
    }

    const value = event.queue[last].value;
    const newQueue = event.queue.slice(last + 1);
    event.queue = newQueue;
    return value;
}

function getEventValue(event:DelayedEvent, _t:number) {
    if (event.queue.length >= 1) {
        const value = event.queue[event.queue.length - 1].value;
        event.queue = [];
        return value;
    }
    return undefined;
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

/*
  Let us say we switch to a animationFrame-based evaluation.

  For each animationFrame, we run evaluate() as many times as
  needed. We should limit the timer-based event to known combinators,
  then we can tell how many times we would need by keep track of that.

  upon animationFrame, evaluate() checks all cells in order and if input is new we set value into "resolved". if a cell compares its previous input array and new one, and if any input is different, call the body.

*/
