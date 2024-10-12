import {JavaScriptNode, parseJavaScript} from "./javascript/parse"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile"

import {
    ScriptCell, VarName, NodeId, Stream,
    DelayedEvent, CollectStream, PromiseEvent, EventType,
    GeneratorNextEvent, QueueRecord, Behavior, TimerEvent, ChangeEvent,
    ReceiverEvent, UserEvent, SendEvent, OrEvent,
    eventType, typeKey,
    isBehaviorKey,
    GeneratorWithFlag,
    ProgramStateType,
    ValueRecord,
    ResolveRecord,
} from "./combinators";
import { showInspector } from "./inspector";

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

const prototypicalGeneratorFunction = (async function*() {while (true) {}})();

type UserEventType = string;

type ObserveCallback = (notifier:(v:any) => void) => () => void;

type EventBodyType = {
    forObserve: boolean;
    callback?: ObserveCallback;
    eventHandler?: (evt:any) => any | null;
    dom?: HTMLElement | string;
    type: EventType;
    eventName?: UserEventType,
};

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom, eventName, eventHandler} = options;
    let record:QueueRecord = {queue:[]};
    let myHandler: ((evt:any) => any) | null;

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
        if (eventHandler === null) {
            realDom.removeEventListener(eventName, myHandler);
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

    return new UserEvent(record);
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
        state.registerEvent(receiver, value);
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
    /*
    startsWith(init:any, varName:VarName) {
        return new CollectStream(init, varName, (_old, v) => v, true);
    }*/
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

export class ProgramState implements ProgramStateType {
    scripts: Array<string>;
    order: Array<NodeId>;
    nodes: Map<NodeId, ScriptCell>;
    streams: Map<VarName, Stream>;
    scratch: Map<VarName, ValueRecord>;
    resolved: Map<VarName, ResolveRecord>;
    inputArray: Map<NodeId, Array<any>>;
    changeList: Map<VarName, any>;
    time: number;
    startTime: number;
    evaluatorRunning: number;
    exports?: Array<string>;
    imports?: Array<string>;
    updated: boolean;
    app?: any;
    noTicking: boolean;
    constructor(startTime:number, app?:any) {
        this.scripts = [];
        this.order = [];
        this.nodes = new Map();
        this.streams = new Map();
        this.scratch = new Map();
        this.resolved = new Map();
        this.inputArray = new Map();
        this.time = 0,
        this.changeList = new Map();
        this.startTime = startTime;
        this.evaluatorRunning = 0;
        this.updated = false;
        this.app = app;
        this.noTicking = false;
    }

    evaluator() {
        this.evaluatorRunning = window.requestAnimationFrame(() => this.evaluator());
        try {
            this.evaluate(Date.now());
        } catch (e) {
            console.error(e);
            console.log("stopping animation");
            window.cancelAnimationFrame(this.evaluatorRunning);
            this.evaluatorRunning = 0;
        }
    }

    noTickingEvaluator() {
        this.noTicking = true;
        if (this.evaluatorRunning !== 0) {return;}
        setTimeout(() => {
            try {
                this.evaluate(Date.now());
            } finally {
                this.evaluatorRunning = 0;
            }
        }, 0);
        // it means that when a value is received or a promise resolved,
        // it will schedule to call evaluate.
        // The timer and delay should also work, but need to think about
        // how that would work without introducing too much complexity.
    }

    setupProgram(scripts:string[]) {
        const invalidatedStreamNames:Set<VarName> = new Set();
    
        // clear all output from events anyway, as re evaluation should not run a cell that depends on an event.
        // This should not be necessary if the DOM element that an event listener is attached stays the same.
    
        for (const [varName, stream] of this.streams) {
            if (!stream[isBehaviorKey]) {
                const scratch = this.scratch.get(varName) as QueueRecord;
                if (scratch?.cleanup && typeof scratch.cleanup === "function") {
                    scratch.cleanup();
                    scratch.cleanup = undefined;
                }
                this.resolved.delete(varName);
                this.streams.delete(varName);
                this.inputArray.delete(varName);
                invalidatedStreamNames.add(varName);
            }
        }
    
        // this is a terrible special case hack to render something after live edit
        for (const [varName, node] of this.nodes) {
            if (node.inputs.includes("render")) {
                this.inputArray.delete(varName);
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
    
        const translated = jsNodes.map((jsNode) => ({id: jsNode.id, code: transpileJavaScript(jsNode)}));
        const evaluated = translated.map((tr) => this.evalCode(tr));
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
        const oldVariableNames:Set<VarName> = new Set(this.order);
        const newVariableNames:Set<VarName> = new Set(sorted);
        const removedVariableNames = difference(oldVariableNames, newVariableNames);
    
        for (const old of this.order) {
            const oldNode = this.nodes.get(old);
            const newNode = newNodes.get(old);
            if (newNode && oldNode && oldNode.code !== newNode.code) {
                invalidatedStreamNames.add(old);
            }
        }
    
    
        this.order = sorted;
        this.nodes = newNodes;
        this.scripts = scripts;
    
        for (const nodeId of this.order) {
            const newNode = newNodes.get(nodeId)!;
            if (invalidatedInput(newNode, invalidatedStreamNames)) {
                this.inputArray.delete(newNode.id);
            }
            if (invalidatedStreamNames.has(nodeId)) {
                this.resolved.delete(nodeId);
                this.scratch.delete(nodeId);
                this.inputArray.delete(nodeId);
            }
        }

        for (const removed of removedVariableNames) {
            const stream = this.streams.get(removed);
            if (stream) {
                this.resolved.delete(removed);
                this.streams.delete(removed);
                this.scratch.delete(removed);
            }
        }
    
        for (const [varName, node] of this.nodes) {
            const nodeNames = [...this.nodes].map(([id, _body]) => id);
            for (const input of node.inputs) {
                if (!nodeNames.includes(this.baseVarName(input))) {
                    console.log(`Node ${varName} won't be evaluated as it depends on an undefined variable ${input}.`);
                }
            }
        }
    }

    evaluate(now:number) {
        this.time = now - this.startTime;
        this.updated = false;
        for (let id of this.order) {
            const node = this.nodes.get(id)!;
            if (!this.ready(node)) {continue;}
    
            const change = this.changeList.get(id);
    
            const inputArray = node.inputs.map((inputName) => this.resolved.get(this.baseVarName(inputName))?.value);
            const lastInputArray = this.inputArray.get(id);
    
            let outputs:any;
            if (change === undefined && this.equals(inputArray, lastInputArray)) {
                outputs = this.streams.get(id)!;
            } else {
                if (change === undefined) {
                    outputs = node.body.apply(
                        this,
                        [...inputArray, this]
                    );
                } else {
                    this.changeList.delete(id);
                    outputs = new ReceiverEvent(change);
                }
                this.inputArray.set(id, inputArray);
                const maybeValue = outputs;
                if (maybeValue === undefined) {continue;}
                if (maybeValue.then || maybeValue[typeKey]) {
                    const ev = maybeValue.then ? new PromiseEvent<any>(maybeValue) : maybeValue;
                    const newStream = ev.created(this, id);
                    this.streams.set(id, newStream);
                    outputs = newStream;
                } else {
                    let newStream:Behavior = new Behavior();//{type: behaviorType}
                    this.streams.set(id, newStream);
                    const resolved = this.resolved.get(id);
                    if (!resolved || resolved.value !== maybeValue) {
                        if (maybeValue.constructor === prototypicalGeneratorFunction.constructor) {
                            maybeValue.done = false;
                            // there is a special case for generators.
                            // actually, there is no real guarantee that this generator is not done.
                            // but I could not find a way to tell whether a generator is done or not.
                        }
                        this.setResolved(id, {value: maybeValue, time: this.time});
                    }
                    outputs = newStream;
                }
            }
    
            if (outputs === undefined) {continue;}
            const evStream:Stream = outputs as Stream;
            evStream.evaluate(this, node, inputArray, lastInputArray);
        }
    
        for (let [varName, stream] of this.streams) {
            stream.conclude(this, varName);
        }

        return this.updated;
    }

    evalCode(arg:{id:VarName, code:string}):ScriptCell {
        const {id, code} = arg;
        let body = `return ${code} //# sourceURL=${window.location.origin}/node/${id}`;
        let func = new Function("Events", "Behaviors", "Renkon", body);
        let val = func(Events, Behaviors, this);
        val.code = code;
        return val;
    }

    ready(node: ScriptCell):boolean {
        const output = node.outputs;
        const stream = this.streams.get(output);
    
        if (stream) {
            return stream.ready(node, this);
        }
    
        return this.defaultReady(node);
    }

    defaultReady(node: ScriptCell) {
        for (const inputName of node.inputs) {
            const varName = this.baseVarName(inputName);
            const resolved = this.resolved.get(varName)?.value;
            if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
        }
        return true;
    }

    equals(aArray?:Array<any|undefined>, bArray?:Array<any|undefined>) {
        if (!Array.isArray(aArray) || !Array.isArray(bArray)) {return false;}
        if (aArray.length !== bArray.length) {
            return false;
        }
        for (let i = 0; i < aArray.length; i++) {
            if (aArray[i] !== bArray[i]) {return false;}
        }
        return true;
    }

    spliceDelayedQueued(record:QueueRecord, t:number) {
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

    getEventValue(record:QueueRecord, _t:number) {
        if (record.queue.length >= 1) {
            const value = record.queue[record.queue.length - 1].value;
            record.queue = [];
            return value;
        }
        return undefined;
    }

    baseVarName(varName:VarName) {
        return varName[0] !== "$" ? varName : varName.slice(1);
    }

    registerEvent(receiver:VarName, value:any) {
        this.changeList.set(receiver, value);
        if (this.noTicking) {
            this.noTickingEvaluator();
        }
    }

    setResolved(varName:VarName, value:any) {
        this.resolved.set(varName, value);
        this.updated = true;
        if (this.noTicking) {
            this.noTickingEvaluator();
        }
    }

    setResolvedForSubgraph(varName:VarName, value:any) {
        this.setResolved(varName, value);
        this.inputArray.set(varName, []);
        this.streams.set(varName, new Behavior());
    }

    merge(func:Function) {
        let scripts = this.scripts;
        const {output} = getFunctionBody(func.toString(), true);
        this.setupProgram([...scripts, output] as string[]);    
    }

    renkonify(func:Function, optSystem?:any) {
        const programState =  new ProgramState(0, optSystem);
        const {params, returnArray, output} = getFunctionBody(func.toString(), false);
        console.log(params, returnArray, output, this);
        const self = this;

        const receivers = params.map((r) => `const ${r} = undefined;`).join("\n");
    
        programState.setupProgram([receivers, output]);
    
        function generator(params:any) {
            const gen = renkonBody(params) as GeneratorWithFlag<any>;
            gen.done = false;
            return Events.next(gen);
        }
        async function* renkonBody(args:any) {
            let lastYielded = undefined;
            for (let key in args) {
                programState.setResolvedForSubgraph(
                    key,
                    {value: args[key], time: self.time}
                );
            }
            while (true) {
                programState.evaluate(self.time);
                const result:any = {};
                const resultTest = [];
                if (returnArray) {
                    for (const n of returnArray) {
                        const v = programState.resolved.get(n);
                        resultTest.push(v ? v.value : undefined)
                        if (v && v.value !== undefined) {
                            result[n] = v.value;
                        }
                    }
                }
                yield !self.equals(lastYielded, resultTest) ? result : undefined;
                lastYielded = resultTest;
            }
        }
        return generator;
    }

    renkonify2(func:Function, optSystem?:any) {
        const programState =  new ProgramState(0, optSystem);
        const {params, returnArray, output} = getFunctionBody(func.toString(), false);
        // console.log(params, returnArray, output, this);

        const receivers = params.map((r) => `const ${r} = undefined;`).join("\n");

        programState.setupProgram([receivers, output]);

        programState.exports = returnArray || undefined;
        programState.imports = params;

        return programState;
    }

    evaluateSubProgram(programState: ProgramState, params:any) {
        for (let key in params) {
            programState.registerEvent(key, params[key]);
        }
        programState.evaluate(this.time);
        if (!programState.updated) {return undefined;}
        const result:any = {};
        if (programState.exports) {
            for (const n of programState.exports) {
                const v = programState.resolved.get(n);
                if (v && v.value !== undefined) {
                    result[n] = v.value;
                }
            }
        }
        return result;
    }

    spaceURL(partialURL:string) {
        // partialURL: './bridge/bridge.js'
        // expected:
        // if it is running on substrate, and it is from space, there is
        // at least one slash and we remove chars after that.

        // partialURL: "/tool-call/js/commands.js"
        // expected:
        // if it is running on substrate, it is the full path on substrate.home.arpa

        const loc = window.location;
        const maybeSpace = loc.host === "substrate.home.arpa"
            && loc.pathname.includes("/space");

        if (maybeSpace) {
            if (partialURL.startsWith("/")) {
                return `${loc.origin}${partialURL}`;
            }
            const index = loc.pathname.lastIndexOf("/");
            const basepath = index >= 0 ? loc.pathname.slice(0, index) : loc.pathname;
            return `${loc.origin}${basepath}/${partialURL}`;
        }

        if (partialURL.startsWith("/")) {
            const index = loc.pathname.lastIndexOf("/");
            const basepath = index >= 0 ? loc.pathname.slice(0, index) : loc.pathname;
            return `${loc.origin}${basepath}${partialURL}`;
        }
        const base = import.meta?.env?.DEV ? "../" : "../";
        return base + partialURL;
    }

    inspector(flag:boolean, dom?: HTMLElement) {
        showInspector(this, flag === undefined ? true: flag, dom);
    }
}
