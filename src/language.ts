import {JavaScriptNode, parseJavaScript} from "./javascript/parse.ts"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile.ts"

import {
    ProgramState, ScriptCell, VarName, NodeId, Stream,
    eventType, delayType, collectType, promiseType, behaviorType, generatorType, onceType,
    DelayedEvent, CollectStream, PromiseEvent, Behavior, EventType,
    GeneratorEvent, OnceEvent, GenericEvent,
    orType,
    sendType,
    OrEvent,
    QueueRecord,
    SimpleValueRecord,
    CollectRecord,
    changeType
} from "./types.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

export function newProgramState(startTime:number) : ProgramState {
    return {
        order: [],
        nodes: new Map(),
        streams: new Map(),
        scratch: new Map(),
        resolved: new Map(),
        inputArray: new Map(),
        outputs: new Map(),
        time: 0,
        changeList: new Map(),
        startTime,
        evaluatorRunning: 0,
    };
}

export function evaluator(state:ProgramState) {
    state.evaluatorRunning = window.requestAnimationFrame(() => evaluator(state));
    evaluate(state);
}

export function setupProgram(scripts:string[], state:ProgramState) {
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (let [varName, stream] of state.streams) {
        if (stream.type === eventType) {
            const scratch = state.scratch.get(varName) as SimpleValueRecord;
            if (scratch.cleanup && typeof scratch.cleanup === "function") {
                scratch.cleanup();
                scratch.cleanup = null;
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
        if (!script) {continue;}
        const nodes = parseJavaScript(script, id, false);
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
            oldVariableNames.add(old.outputs);
        }
    });

    evaluated.forEach((cell) => {
        newNodes.set(cell.id, cell);
        newVariableNames.add(cell.outputs);
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
            removedVariableNames.add(oldNode.outputs);
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
        state.scratch.delete(nodeId);
        state.inputArray.delete(nodeId);
    }

    for (const removed of removedVariableNames) {
        const stream = state.streams.get(removed);
        if (stream) {
            state.resolved.delete(removed);
            state.streams.delete(removed);
            state.scratch.delete(removed);
        }
    }
}

function baseVarName(varName:VarName) {
    return varName[0] !== "$" ? varName : varName.slice(1);
}

export function evaluate(state:ProgramState) {
    // if (state.resolved.get("chunks")?.value.length > 0) {debugger;}
    const now = Date.now();
    state.time = now - state.startTime;
    let updated = false;
    for (let id of state.order) {
        // if (window.wasResolved) {debugger;}
        const node = state.nodes.get(id)!;
        const isReady = ready(node, state);
        const change = state.changeList.get(id);

        if (!isReady) {continue;}

        const inputArray = node.inputs.map((inputName) => state.resolved.get(baseVarName(inputName))?.value);
        // if (inputArray.length > 0) {console.log("inputArray", inputArray)};
        const lastInputArray = state.inputArray.get(id);

        let bodyEvaluated = false;

        let outputs:any;
        if (change === undefined && equals(inputArray, lastInputArray)) {
            outputs = state.streams.get(id)!;
        } else {
            if (change === undefined) {
                outputs = node.body.apply(
                    state,
                    [...inputArray, state]
                );
            } else {
                outputs = {type: onceType, value: change};
            }
            state.inputArray.set(id, inputArray);
            const maybeValue = outputs;
            const maybeStream:Stream = outputs as Stream;
            if (maybeValue === undefined) {continue;}
            if (maybeValue.then) {
                const promise = maybeValue;
                promise.then((value:any) => {
                    const wasResolved = state.resolved.get(id)?.value;
                    if (!wasResolved) {
                        updated = true;
                        state.resolved.set(id, {value, time: state.time});
                    }
                });
                const e:PromiseEvent = {type: promiseType, promise};
                state.streams.set(id, e);
                outputs = e;
            } else if (maybeStream.type === collectType) {
                if (!state.scratch.get(id)) {
                    state.streams.set(id, maybeValue);
                    updated = true;
                    state.resolved.set(id, {value: (maybeValue as any).init, time: state.time});
                    state.scratch.set(id, {current: (maybeValue as any).init});
                }
                outputs = maybeStream;
            } else if (maybeStream.type === generatorType) {
                const promise = maybeValue.promise;
                promise.then((value:any) => {
                    const wasResolved = state.resolved.get(id)?.value;
                    if (!wasResolved) {
                        updated = true;
                        state.resolved.set(id, {value, time: state.time});
                    }
                });
                state.streams.set(id, maybeValue);
                outputs = maybeStream;
            } else if (maybeStream.type === onceType) {
                const once = maybeValue as OnceEvent;
                if (!state.streams.get(id)) {
                    state.streams.set(id, once);
                    updated = true;
                    state.resolved.set(id, {value: once.value, time: state.time});
                }
            } else if (maybeStream.type === orType) {
                const once = maybeValue as OrEvent;
                if (!state.streams.get(id)) {
                    state.streams.set(id, once);
                    updated = true;
                }
            } else if (maybeStream.type === delayType) {
                const oldStream = state.streams.get(id) as DelayedEvent;
                if (!oldStream || 
                    oldStream.delay !== maybeValue.delay ||
                    oldStream.varName !== maybeValue.varName
                ) {
                    state.streams.set(id, maybeValue);
                    updated = true;
                    state.scratch.set(id, {queue: []});
                }
            } else if (maybeStream.type === eventType) {
                const ev = {type: maybeValue.type};
                state.streams.set(id, ev);
                state.scratch.set(id, maybeValue.record);
            } else if (maybeStream.type === changeType) {
                const ev = {type: maybeValue.type};
                state.streams.set(id, ev);
                state.scratch.set(id, maybeValue.value);
            } else {
                let stream:Behavior = {type: behaviorType}
                state.streams.set(id, stream);
                const resolved = state.resolved.get(id);
                if (!resolved || resolved.value !== maybeValue) {
                    updated = true;
                    state.resolved.set(id, {value: maybeValue, time: state.time});
                }
            }

            // this is where the input values are available but not equal.
            // meaning that the Event returned from Behavior.delay 
            // can say when it wants to be triggered

            bodyEvaluated = true;
        }

        let maybeValue = outputs;
        if (maybeValue === undefined) {continue;}
        const maybeStream:Stream = maybeValue as Stream;
        if (maybeStream.type === delayType) {
            const value = spliceDelayedQueued(state.scratch.get(id) as QueueRecord, state.time);
            // console.log("value", value);
            if (value !== undefined) {
                updated = true;
                state.resolved.set(id, {value, time: state.time});
            }
            const inputIndex = 0; node.inputs.indexOf(maybeValue.varName);
            const myInput = inputArray[inputIndex];
            if (bodyEvaluated && myInput !== undefined) {
                const scratch:QueueRecord = state.scratch.get(id) as QueueRecord;
                scratch.queue.push({time: state.time + maybeValue.delay, value: myInput});
                // state.activeTimers.add(maybeValue);
            }
        } else if (maybeStream.type === eventType) {
            const value = getEventValue(state.scratch.get(id) as QueueRecord, state.time);
            if (value !== undefined) {
                updated = true;
                state.resolved.set(id, {value, time: state.time});
            }
        } else if (maybeStream.type === collectType) {
            // if (maybeValue.current === 1) {debugger};
            type ArgTypes = Parameters<typeof maybeValue.updater>;
            const scratch = state.scratch.get(id) as CollectRecord<ArgTypes[1]>;
            maybeValue = maybeValue as CollectStream<typeof scratch.current, ArgTypes[1]>;
            const inputIndex = node.inputs.indexOf(maybeValue.varName);
            const inputValue = inputArray[inputIndex];
            if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
                const value = maybeValue.updater(scratch.current, inputValue);
                if (value !== undefined) {
                    updated = true;
                    state.resolved.set(id, {value, time: state.time});
                    state.scratch.set(id, {current: value});
                }
            }
        } else if (maybeValue.type === orType) {
            for (let i = 0; i < node.inputs.length; i++) {
                const myInput = inputArray[i];
                if (myInput !== undefined) {
                    updated = true;
                    state.resolved.set(id, {value: myInput, time: state.time});
                    break;
                }
            }
        } else if (maybeValue.type === promiseType) {
        } else if (maybeValue.type === generatorType) {
        } else if (maybeValue.type === onceType) {
            updated = true;
            state.resolved.set(id, {value: maybeValue.value, time: state.time});   
        } else if (maybeValue.type === changeType) {
            updated = true;
            state.resolved.set(id, {value: maybeValue.value, time: state.time});
            state.scratch.set(id, inputArray[0]);
        } else if (maybeValue.type === behaviorType) {
        }
    }
    // for all streams, check if it is an event.
    // if it is resolved, its promise and resolved will be cleared

    const deleted:Set<VarName> = new Set();
    for (let [varName, stream] of state.streams) {
        const type = stream.type;
        if (type === eventType || type === onceType || type === orType || type === changeType) {
            if (state.resolved.get(varName)?.value !== undefined) {
                // console.log("deleting", varName);
                state.resolved.delete(varName);
                if (type !== changeType) {
                    deleted.add(varName);
                }
            }
        } else if (type === generatorType) {
            const value = state.resolved.get(varName)?.value;
            if (value !== undefined) {
                if (!value.done) {
                    const gen = stream as GeneratorEvent<typeof value.value>;
                    const promise = gen.generator.next();
                    promise.then((value:any) => {
                        const wasResolved = state.resolved.get(varName)?.value;
                        if (!wasResolved) {
                            updated = true;
                            // probably wrong to set a flag outside from within a promise handler
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
    state.changeList.clear();
    return updated;
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
    let record:QueueRecord = {queue:[]};
    let returnValue:any = {type, record};


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
            record.queue.push({value, time: 0});
        },
        "click": (evt:any) => {
            const value = evt.target;
            record.queue.push({value, time: 0});
        }
    };

    const notifier = (value:any) => {
        record.queue.push({value, time: 0});
    };

    if (realDom && !forObserve && eventType) {
        realDom.addEventListener(eventType, handlers[eventType]);
    }

    if (forObserve && callback) {
        record.cleanup = callback(notifier);
    }
    if (!forObserve && dom) {
        record.cleanup = () => {
            if (realDom && eventType) {
                realDom.removeEventListener(eventType, handlers[eventType]);
            }
        }
    }

    return returnValue;
}

function registerEvent(state:ProgramState, receiver:VarName, value:any){
    state.changeList.set(receiver, value);
}

function renkonify(func:Function) {
    const programState = newProgramState(Date.now());
    const {params, returnArray, output} = getFunctionBody(func.toString());
    console.log(params, returnArray, output);

    setupProgram([output], programState);

    function generator(...args:any[]) {
        return Events.next(renkonBody(...args));
    }
    async function* renkonBody(...args:any[]) {
        for (let i = 0; i < params.length; i++) {
            programState.resolved.set(params[i], args[i]);
        }
        while (true) {
            evaluate(programState);
            const result:any = {};
            if (returnArray) {
                for (const n of returnArray) {
                    const v = programState.resolved.get(n);
                    if (v && v.value !== undefined) {
                        result[n] = v.value;
                    }
                }
            }
            yield result;
        }
    }
    return generator;
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
    delay(varName:VarName, delay: number):DelayedEvent {
        return {type: delayType, delay, varName, queue: []};
    },
    once(value:any):OnceEvent{
        return {type: onceType, value};
    },
    change(value:any):OnceEvent{
        return {type: changeType, value};
    },
    next<T>(generator:AsyncGenerator<T>):GeneratorEvent<T> {
        const value = generator.next();
        return {type: generatorType, promise: value, generator};
    },
    or(...varNames:Array<VarName>) {
        return {type: orType, varNames};
    },
    send(state:ProgramState, receiver:VarName, value:any) {
        registerEvent(state, receiver, value);
        return {type: sendType, receiver, value};
    },
    receiver() {
        return {type: onceType, value: undefined};
    },
    renkonify: renkonify
};

const Behaviors = {
    keep(value:any) {
       return value;
    },
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return {type: collectType, init, updater, varName};
    },
}

function evalCode(str:string):ScriptCell {
    let code = `return ${str}`;
    let func = new Function("Events", "Behaviors", code);
    let val = func(Events, Behaviors);
    val.code = str;
    return val;
}

function topologicalSort(nodes:Array<ScriptCell>) {
    let order = [];

    let workNodes:Array<ScriptCellForSort> = nodes.map((node) => ({
        id: node.id,
        inputs: [...node.inputs].filter((n) => n[0] !== "$"),
        outputs: node.outputs,
    }));
    
    function hasEdge(src:ScriptCellForSort, dst:ScriptCellForSort) {
        return dst.inputs.includes(src.outputs);
    }

    function removeEdges(src:ScriptCellForSort, dst:ScriptCellForSort) {
        let edges = [];
        let index = dst.inputs.indexOf(src.outputs);
        if (index >= 0) {edges.push(src.outputs);}

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
    const output = node.outputs;
    const stream = state.streams.get(output) as DelayedEvent;
    if (stream?.type === delayType) {
        const scratch:QueueRecord = state.scratch.get(output) as QueueRecord;
        if (scratch.queue.length > 0) {return true;}
    }
    if (stream?.type === changeType) {
        const resolved = state.resolved.get(baseVarName(node.inputs[0]))?.value;
        if (resolved !== undefined && resolved === state.scratch.get(node.id)) {return false;}
    }
    for (const inputName of node.inputs) {
        const varName = baseVarName(inputName);
        const resolved = state.resolved.get(varName)?.value;
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

function spliceDelayedQueued(record:QueueRecord, t:number) {
    let last = -1;
    for (let i = 0; i < record.queue.length; i++) {
        if (record.queue[i].time >= t) {
            break;
        }
        last = i;
    }
    if (last < 0) {
        return undefined;
    }

    const value = record.queue[last].value;
    const newQueue = record.queue.slice(last + 1);
    record.queue = newQueue;
    return value;
}

function getEventValue(record:QueueRecord, _t:number) {
    if (record.queue.length >= 1) {
        const value = record.queue[record.queue.length - 1].value;
        record.queue = [];
        return value;
    }
    return undefined;
}
