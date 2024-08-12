import {JavaScriptNode, parseJavaScript} from "./javascript/parse"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile"

import {
    ProgramState, ScriptCell, VarName, NodeId, Stream,
    DelayedEvent, CollectStream, PromiseEvent, EventType,
    GeneratorNextEvent, QueueRecord, Behavior, TimerEvent, ChangeEvent,
    ReceiverEvent, UserEvent, SendEvent, OrEvent,
    eventType, typeKey,
    isBehaviorKey,
    GeneratorWithFlag,
} from "./combinators";

export {ProgramState} from  "./combinators";

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

const prototypicalGeneratorFunction = (async function*() {while (true) {}})();

export function evaluator(state:ProgramState) {
    state.evaluatorRunning = window.requestAnimationFrame(() => evaluator(state));
    try {
        evaluate(state, Date.now());
    } catch (e) {
        console.error(e);
        console.log("stopping animation");
        window.cancelAnimationFrame(state.evaluatorRunning);
        state.evaluatorRunning = 0;
    }
}

export function setupProgram(scripts:string[], state:ProgramState) {
    const invalidatedStreamNames:Set<VarName> = new Set();

    // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
    // This should not be necessary if the DOM element that an event listener is attached stays the same.

    for (const [varName, stream] of state.streams) {
        if (!stream[isBehaviorKey]) {
            const scratch = state.scratch.get(varName) as QueueRecord;
            if (scratch?.cleanup && typeof scratch.cleanup === "function") {
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

    const unsortedVarnames = difference(new Set(evaluated.map(e => e.id)), new Set(sorted));

    for (const u of unsortedVarnames) {
        console.log(`Node ${u} is not going to be evaluated because it is in a cycle or depends on a undefined variable.`);
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
        if (invalidatedStreamNames.has(nodeId)) {
            state.resolved.delete(nodeId);
            state.scratch.delete(nodeId);
            state.inputArray.delete(nodeId);
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

    for (const [varName, node] of state.nodes) {
        for (const input of node.inputs) {
            if (!state.order.includes(state.baseVarName(input))) {
                console.log(`Node ${varName} won't be evaluated as it depends on an undefined variable ${input}.`);
            }
        }
    }
}

export function evaluate(state:ProgramState, now:number) {
    state.time = now - state.startTime;
    state.updated = false;
    for (let id of state.order) {
        const node = state.nodes.get(id)!;
        if (!state.ready(node)) {continue;}

        const change = state.changeList.get(id);

        const inputArray = node.inputs.map((inputName) => state.resolved.get(state.baseVarName(inputName))?.value);
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
                outputs = new ReceiverEvent(change);
            }
            state.inputArray.set(id, inputArray);
            const maybeValue = outputs;
            if (maybeValue === undefined) {continue;}
            if (maybeValue.then || maybeValue[typeKey]) {
                const ev = maybeValue.then ? new PromiseEvent<any>(maybeValue) : maybeValue;
                const newStream = ev.created(state, id);
                state.streams.set(id, newStream);
                outputs = newStream;
            } else {
                let newStream:Behavior = new Behavior();//{type: behaviorType}
                state.streams.set(id, newStream);
                const resolved = state.resolved.get(id);
                if (!resolved || resolved.value !== maybeValue) {
                    if (maybeValue.constructor === prototypicalGeneratorFunction.constructor) {
                        maybeValue.done = false;
                        // there is a special case for generators.
                        // actually, there is no real guarantee that this generator is not done.
                        // but I could not find a way to tell whether a generator is done or not.
                    }
                    state.setResolved(id, {value: maybeValue, time: state.time});
                }
                outputs = newStream;
            }
        }

        if (outputs === undefined) {continue;}
        const evStream:Stream = outputs as Stream;
        evStream.evaluate(state, node, inputArray, lastInputArray);
    }

    // for all streams, check if it is an event.
    // if it is resolved, its promise and resolved will be cleared

    const deleted:Set<VarName> = new Set();
    for (let [varName, stream] of state.streams) {
        let maybeDeleted = stream.conclude(state, varName);
        if (maybeDeleted) {
            deleted.add(maybeDeleted);
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
    return state.updated;
}

type UserEventType = string;

type ObserveCallback = (notifier:(v:any) => void) => () => void;

type EventBodyType = {
    forObserve: boolean;
    callback?: ObserveCallback;
    eventHandler?: (evt:any) => any;
    dom?: HTMLElement | string;
    type: EventType;
    eventName?: UserEventType,

};

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom, eventName, eventHandler} = options;
    let record:QueueRecord = {queue:[]};
    let myHandler: (evt:any) => any;

    let realDom:HTMLElement|undefined;
    if (typeof dom === "string") {
        if (dom.startsWith("#")) {
            realDom = document.querySelector(dom) as HTMLInputElement;
        } else {
            realDom = document.getElementById(dom) as HTMLInputElement;
        }
    } else {
        realDom = dom;
    }

    const handlers = (eventName:string):((evt:any) => any) => {
        if (eventName === "input" || eventName === "click") {
            return (evt:any) => {
                record.queue.push({value: evt, time: 0});
            }
        }
        return (_evt:any) => null;
    };

    const notifier = (value:any) => {
        record.queue.push({value, time: 0});
    };

    if (realDom && !forObserve && eventName) {
        if (eventHandler) {
            myHandler = (evt) => {
                const value = eventHandler(evt);
                if (value !== undefined) {
                    record.queue.push({value, time: 0});
                }
            }
        } else {
            myHandler = handlers(eventName);
        }
        if (myHandler) {
            realDom.addEventListener(eventName, myHandler);
        }
    }

    if (forObserve && callback) {
        record.cleanup = callback(notifier);
    }
    if (!forObserve && dom) {
        record.cleanup = () => {
            if (realDom && eventName) {
                if (myHandler) {
                    realDom.removeEventListener(eventName, myHandler);
                }
            }
        }
    }

    return new UserEvent(record);;
}

function registerEvent(state:ProgramState, receiver:VarName, value:any) {
    state.changeList.set(receiver, value);
}

function renkonify(func:Function) {
    const programState =  new ProgramState(Date.now());
    const {params, returnArray, output} = getFunctionBody(func.toString());
    console.log(params, returnArray, output);

    setupProgram([output], programState);

    function generator(...args:any[]) {
        const gen = renkonBody(...args) as GeneratorWithFlag<any>;
        gen.done = false;
        return Events.next(gen);
    }
    async function* renkonBody(...args:any[]) {
        for (let i = 0; i < params.length; i++) {
            programState.setResolved(params[i], args[i]);
        }
        while (true) {
            evaluate(programState, programState.time);
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
    observe(callback:ObserveCallback) {
        return eventBody({type: eventType, forObserve: true, callback});
    },
    input(dom:HTMLInputElement|string) {
        return eventBody({type: eventType, forObserve: false, dom, eventName: "input"});
    },
    click(dom:HTMLInputElement|string) {
        return eventBody({type: eventType, forObserve: false, dom, eventName: "click"});
    },
    listener(dom: HTMLElement|string, eventName:string, handler: (evt:any) => void) {
        return eventBody({type: eventType, forObserve: false, dom, eventName: eventName, eventHandler: handler});
    },
    delay(varName:VarName, delay: number):DelayedEvent {
        return new DelayedEvent(delay, varName, false);
    },
    timer(interval:number):TimerEvent {
        return new TimerEvent(interval, false);
    },
    change(value:any):ChangeEvent{
        return new ChangeEvent(value);
    },
    next<T>(generator:GeneratorWithFlag<T>):(GeneratorNextEvent<T>) {
        return new GeneratorNextEvent(generator);
    },
    or(...varNames:Array<VarName>) {
        return new OrEvent(varNames)
    },
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return new CollectStream(init, varName, updater, false);
    },
    /*map<S, T>(varName:VarName, updater: (arg:S) => T) {
        return new CollectStream(undefined, varName, (_a, b) => updater(b), false);
    },*/
    send(state:ProgramState, receiver:VarName, value:any) {
        registerEvent(state, receiver, value);
        return new SendEvent();
    },
    receiver() {
        return new ReceiverEvent(undefined);
    },
    message(event:string, data:any, directWindow?:Window) {
        const isInIframe =  window.top !== window;
        const obj = {event: `renkon:${event}`, data};
        if (isInIframe) {
          window.top!.postMessage(obj, "*");
          return;
        }
    
        if (directWindow) {
          directWindow.postMessage(obj, "*");
        }
    },
    renkonify: renkonify
};

const Behaviors = {
    keep(value:any) {
       return value;
    },
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return new CollectStream(init, varName, updater, true);
    },
    timer(interval:number):TimerEvent {
        return new TimerEvent(interval, true);
    },
    delay(varName:VarName, delay: number):DelayedEvent {
        return new DelayedEvent(delay, varName, true);
    },
    spaceURL(partialURL:string) {
        // partialURL: './bridge/bridge.js'
        // expected: 
        const loc = window.location.toString();
        const semi = loc.indexOf(";");
        if (semi < 0) {
            return partialURL;
        }
        const index = loc.lastIndexOf("/");
        let base = index >= 0 ? loc.slice(0, index) : loc;
        return `${base}/${partialURL}`;
    }
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
