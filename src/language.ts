import {JavaScriptNode, parseJavaScript} from "./javascript/parse.ts"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile.ts"

import {
    ProgramState, ScriptCell, VarName, NodeId, Stream,
    eventType, generatorType, onceType,
    DelayedEvent, CollectStream, PromiseEvent, EventType,
    GeneratorEvent,
    orType,
    QueueRecord,
    changeType,
    Behavior,
    TimerEvent,
    ChangeEvent,
    ReceiverEvent,
    UserEvent,
    SendEvent,
    OrEvent
} from "./combinators.ts"

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

export function evaluator(state:ProgramState) {
    state.evaluatorRunning = window.requestAnimationFrame(() => evaluator(state));
    evaluate(state);
}

export function setupProgram(scripts:string[], state:ProgramState) {
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (const [varName, stream] of state.streams) {
        if (stream._streamType === eventType) {
            const scratch = state.scratch.get(varName) as QueueRecord;
            if (scratch.cleanup && typeof scratch.cleanup === "function") {
                scratch.cleanup();
                scratch.cleanup = undefined;
            }
            state.resolved.delete(varName);
            state.streams.delete(varName);
            state.inputArray.delete(varName);
            invalidatedStreamNames.add(varName);
        }
    }

    // this is a terrible special case hack to render something after live edit
    for (const [varName, node] of state.nodes) {
        if (node.inputs.includes("render")) {
            state.inputArray.delete(varName);
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

    for (const newNode of evaluated) {
        newNodes.set(newNode.id, newNode);
    }

    // nested ones also have to be checked?
    const oldVariableNames:Set<VarName> = new Set(state.order);
    const newVariableNames:Set<VarName> = new Set(sorted);
    const removedVariableNames = difference(oldVariableNames, newVariableNames);

    for (const old of state.order) {
        const oldNode = state.nodes.get(old);
        const newNode = newNodes.get(old);
        if (newNode && oldNode && oldNode.code !== newNode.code) {
            invalidatedStreamNames.add(old);
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
    const now = Date.now();
    state.time = now - state.startTime;
    let updated = false;
    for (let id of state.order) {
        const node = state.nodes.get(id)!;
        const isReady = state.ready(node);
        const change = state.changeList.get(id);

        if (!isReady) {continue;}

        const inputArray = node.inputs.map((inputName) => state.resolved.get(baseVarName(inputName))?.value);
        const lastInputArray = state.inputArray.get(id);

        let outputs:any;
        if (change === undefined && state.equals(inputArray, lastInputArray)) {
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
            if (maybeValue === undefined) {continue;}
            if (maybeValue.then) {
                const ev = new PromiseEvent<any>(maybeValue);
                const [newStream, streamUpdated] = ev.created(state, id); 
                state.streams.set(id, newStream);
                outputs = newStream;
                updated = streamUpdated;
            } else if (maybeValue._streamType) {
                const [newStream, streamUpdated] = maybeValue.created(state, id);
                state.streams.set(id, newStream);
                updated = streamUpdated;
                outputs = newStream;
            } else {
                let stream:Behavior = new Behavior();//{type: behaviorType}
                state.streams.set(id, stream);
                const resolved = state.resolved.get(id);
                if (!resolved || resolved.value !== maybeValue) {
                    updated = true;
                    state.resolved.set(id, {value: maybeValue, time: state.time});
                }
                outputs = stream;
            }
        }

        if (outputs === undefined) {continue;}
        const evStream:Stream = outputs as Stream;
        let evUpdated = evStream.evaluate(state, node, inputArray, lastInputArray);
        updated = updated || evUpdated;
    }

    // for all streams, check if it is an event.
    // if it is resolved, its promise and resolved will be cleared

    const deleted:Set<VarName> = new Set();
    for (let [varName, stream] of state.streams) {
        const type = stream._streamType;
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
                            // probably wrong to set a flag outside from within a promise handler
                            updated = true;
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
    let {forObserve, callback, dom, eventType} = options;
    let record:QueueRecord = {queue:[]};

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

    return new UserEvent(record);;
}

function registerEvent(state:ProgramState, receiver:VarName, value:any){
    state.changeList.set(receiver, value);
}

function renkonify(func:Function) {
    const programState =  new ProgramState(Date.now());
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
        return new DelayedEvent(delay, varName);
    },
    timer(interval:number):TimerEvent {
        return new TimerEvent(interval);
    },
    change(value:any):ChangeEvent{
        return new ChangeEvent(value);
    },
    next<T>(generator:AsyncGenerator<T>):GeneratorEvent<T> {
        const value = generator.next();
        return new GeneratorEvent(value, generator);//{type: generatorType, promise: value, generator};
    },
    or(...varNames:Array<VarName>) {
        return new OrEvent(varNames)
    },
    send(state:ProgramState, receiver:VarName, value:any) {
        registerEvent(state, receiver, value);
        return new SendEvent();
    },
    receiver() {
        return new ReceiverEvent();
    },
    renkonify: renkonify
};

const Behaviors = {
    keep(value:any) {
       return value;
    },
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return new CollectStream(init, varName, updater);
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
