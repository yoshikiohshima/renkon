import {JavaScriptNode, parseJavaScript} from "./javascript/parse.ts"
import {transpileJavaScript} from "./javascript/transpile.ts"

import {
    ProgramState, ScriptCell, VarName, NodeId, Stream,
    eventType, delayType, fbyType, promiseType, behaviorType, generatorType, onceType,
    DelayedEvent, FbyStream, PromiseEvent, Behavior, EventType,
    GeneratorEvent, OnceEvent, GenericEvent,
    orType
} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

export function setupProgram(scripts:HTMLScriptElement[], state:ProgramState) {
    (window as any).programState = state;
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (let [varName, stream] of state.streams) {
        if (stream.type === eventType) {
            const evt = stream as GenericEvent;
            if (evt.cleanup && typeof evt.cleanup === "function") {
                evt.cleanup();
                evt.cleanup = null;
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
            id++;
        }
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

    for (const old of state.order) {
        const oldNode = state.nodes.get(old);
        const newNode = newNodes.get(old);
        if (newNode && oldNode && oldNode.code !== newNode.code) {
            oldNode.outputs.forEach((out) => removedVariableNames.add(out));
        }
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
                const maybeStream:Stream = maybeValue as Stream;
                if (maybeValue === undefined) {continue;}
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
                } else if (maybeStream.type === fbyType) {
                    if (!state.streams.get(output)) {
                        state.streams.set(output, maybeValue);
                        state.resolved.set(output, {value: (maybeValue as any).init, time: state.time});
                    } else {
                        outputs[output] = state.streams.get(output);
                    }
                } else if (maybeStream.type === generatorType) {
                    const promise = maybeValue.promise;
                    promise.then((value:any) => {
                        const wasResolved = state.resolved.get(output)?.value;
                        if (!wasResolved) {
                            state.resolved.set(output, {value, time: state.time});
                        }
                    });
                    state.streams.set(output, maybeValue);
                } else if (maybeStream.type === onceType) {
                    const once = maybeValue as OnceEvent;
                    if (!state.streams.get(output)) {
                        state.streams.set(output, once);
                        state.resolved.set(output, {value: once.value, time: state.time});
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

            if (maybeValue === undefined) {continue;}

            const maybeStream:Stream = maybeValue as Stream;

            if (maybeStream.type === delayType) {
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
            } else if (maybeStream.type === eventType) {
                state.streams.set(output, maybeStream);
                const value = getEventValue(maybeStream as GenericEvent, state.time);
                if (value !== undefined) {
                    const wasResolved = state.resolved.get(output)?.value;
                    if (wasResolved === undefined) {
                        state.resolved.set(output, {value, time: state.time});
                    }
                }
            } else if (maybeStream.type === fbyType) {
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

            } else if (maybeValue.type === orType) {
                for (let i = 0; i < node.inputs.length; i++) {
                    const myInput = inputArray[i];
                    if (myInput !== undefined) {
                        state.resolved.set(output, {value: myInput, time: state.time});
                        break;
                    }
                }
            } else if (maybeValue.type === promiseType) {
            } else if (maybeValue.type === generatorType) {
            } else if (maybeValue.type === onceType) {
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

    const deleted:Set<VarName> = new Set();
    for (let [varName, stream] of state.streams) {
        const type = stream.type;
        if (type === eventType || type === onceType || type === orType) {
            if (state.resolved.get(varName)?.value !== undefined) {
                // console.log("deleting", varName);
                state.resolved.delete(varName);
                deleted.add(varName);
            }
        }
        else if (type === generatorType) {
            const value = state.resolved.get(varName)?.value;
            if (value !== undefined) {
                if (!value.done) {
                    const gen = stream as GeneratorEvent<typeof value.value>;
                    const promise = gen.generator.next();
                    promise.then((value:any) => {
                        const wasResolved = state.resolved.get(varName)?.value;
                        if (!wasResolved) {
                            state.resolved.set(varName, {value, time: state.time});
                        }
                    });
                    gen.promise = promise;
                }
                state.resolved.delete(varName);      
                deleted.add(varName);         
            }
        }
    }

    for (let varName of deleted) {
        for (let [receipient, node] of state.nodes) {
            const index = node.inputs.indexOf(varName);
            if (index >= 0) {
                const inputArray = state.inputArray.get(receipient);
                if (inputArray) {
                    inputArray[index] = undefined;
                }
            }
        }
    }
}

function define(spec:ScriptCell) {
   return spec;
}

type UserEventType = "click" | "input";

type ObserveCallback = (notifier:(v:any) => void) => () => void;

type EventBodyType = {
    forObserve: boolean;
    callback?: ObserveCallback;
    dom?: HTMLInputElement | string;
    type: EventType;
    eventType?: UserEventType
};

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom, type, eventType} = options;
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

    const handlers = {
        "input": (evt:any) => {
            const value = evt.target.value;
            returnValue.queue.push({value, time: 0});
        },
        "click": (evt:any) => {
            const value = evt.target;
            returnValue.queue.push({value, time: 0});
        }
    };

    const notifier = (value:any) => {
        returnValue.queue.push({value, time: 0});
    };

    if (realDom && !forObserve && eventType) {
        realDom.addEventListener(eventType, handlers[eventType]);
    }

    if (forObserve && callback) {
        returnValue.cleanup = callback(notifier);
    }
    if (!forObserve && dom) {
        returnValue.cleanup = () => {
            if (realDom && eventType) {
                realDom.removeEventListener(eventType, handlers[eventType]);
            }
        }
    }

    return returnValue;
}

const Events = {
    observe: (callback:ObserveCallback) => {
        return eventBody({type: eventType, forObserve: true, callback});
    },
    input: (dom:HTMLInputElement|string) => {
        return eventBody({type: eventType, forObserve: false, dom, eventType: "input"});
    },
    click: (dom:HTMLInputElement|string) => {
        return eventBody({type: eventType, forObserve: false, dom, eventType: "click"});
    },
    fby<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):FbyStream<I, T> {
        return {type: fbyType, init, updater, varName, current: init};
    },
    delay(varName:VarName, delay: number):DelayedEvent {
        return {type: delayType, delay, varName, queue: []};
    },
    once(value:any):OnceEvent{
        return {type: onceType, value};
    },
    next<T>(generator:AsyncGenerator<T>):GeneratorEvent<T> {
        const value = generator.next();
        return {type: generatorType, promise: value, generator};
    },
    or(...varNames:Array<VarName>) {
        return {type: orType, varNames};
    }
};

const Behaviors = {
    keep(value:any) {
       return value;
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

function getEventValue(event:GenericEvent, _t:number) {
    if (event.queue.length >= 1) {
        const value = event.queue[event.queue.length - 1].value;
        event.queue = [];
        return value;
    }
    return undefined;
}
