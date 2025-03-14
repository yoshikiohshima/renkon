import {JavaScriptNode, parseJavaScript} from "./javascript/parse"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile"
import packageJson from "../package.json";

export const version = packageJson.version;

import {
    ScriptCell, VarName, NodeId, Stream,
    DelayedEvent, CollectStream, SelectStream, GatherStream, PromiseEvent, EventType,
    GeneratorNextEvent, QueueRecord, Behavior, TimerEvent, ChangeEvent, OnceEvent,
    ReceiverEvent, UserEvent, SendEvent, OrStream, ResolvePart,
    eventType, typeKey,
    isBehaviorKey,
    GeneratorWithFlag,
    ProgramStateType,
    ValueRecord,
    ResolveRecord,
    SubProgramState,
} from "./combinators";
import { translateTS } from "./typescript";

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars">

type UserEventType = string;

type ObserveCallback = (notifier:(v:any) => void) => () => void;

type EventBodyType = {
    forObserve: boolean;
    queued: boolean;
    callback?: ObserveCallback;
    eventHandler?: (evt:any) => any | null;
    dom?: HTMLElement | string;
    type: EventType;
    eventName?: UserEventType,
    state: ProgramState,
};

function isGenerator(value:any):boolean {
    const prototypicalGeneratorFunction = (async function*() {while (false) {}})();
    if (value === undefined || value === null) {
        return false;
    }
    return (typeof value === "object" && value.constructor === prototypicalGeneratorFunction.constructor);
}

const defaultHandler = (ev:any) => ev;

function eventBody(options:EventBodyType) {
    let {forObserve, callback, dom, eventName, eventHandler, state, queued} = options;
    let record:QueueRecord = {queue:[]};
    let myHandler: ((evt:any) => any) | null;

    let realDom:HTMLElement|undefined;
    if (typeof dom === "string") {
        realDom = document.querySelector(dom) as HTMLInputElement;
    } else {
        realDom = dom;
    }

    const notifier = (value:any) => {
        record.queue.push({value, time: 0});
    };

    if (realDom && !forObserve && eventName) {
        if (eventHandler) {
            myHandler = (evt) => {
                const value = eventHandler(evt);
                if (value !== undefined) {
                    record.queue.push({value, time: 0});
                    if (state.noTicking) {
                        state.noTickingEvaluator();
                    }
                }
            }
        } else {
            myHandler = defaultHandler;
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

    return new UserEvent(record, queued);
}

class Events {
    programState: ProgramState;
    constructor(state:ProgramState) {
        this.programState = state;
    }

    static create(state:ProgramState) {
        return new Events(state);
    }

    listener(dom: HTMLElement|string, eventName:string, handler: (evt:any) => void, options?:any) {
        return eventBody({type: eventType, forObserve: false, dom, eventName: eventName, eventHandler: handler, state: this.programState, queued: !!options?.queued});
    }
    delay(varName:VarName, delay: number):DelayedEvent {
        return new DelayedEvent(delay, varName, false);
    }
    timer(interval:number):TimerEvent {
        return new TimerEvent(interval, false);
    }
    change(value:any):ChangeEvent {
        return new ChangeEvent(value);
    }
    once(value:any):ChangeEvent {
        return new OnceEvent(value);
    }
    next<T>(generator:GeneratorWithFlag<T>):(GeneratorNextEvent<T>) {
        return new GeneratorNextEvent(generator);
    }
    or(...varNames:Array<VarName>) {
        return new OrStream(varNames, false)
    }
    _or_index(...varNames:Array<VarName>) {
        return new OrStream(varNames, true);
    }
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return new CollectStream(init, varName, updater, false);
    }
    select<I>(_init:I, ..._pairs:Array<any>) {
        // this is a definition that transpiler transforms to _select
    }
    _select<I>(init:I, varName:VarName, updaters: Array<(c:I, v:any) => I>):SelectStream<I> {
        return new SelectStream(init, varName, updaters, false);
    }
    send(receiver:VarName, value:any) {
        this.programState.registerEvent(receiver, value);
        return new SendEvent();
    }
    receiver(options?:any) {
        return new ReceiverEvent(options);
    }
    observe(callback:ObserveCallback, options?:any) {
        return eventBody({type: eventType, forObserve: true, callback, state:this.programState, queued: options?.queued});
    }
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
    }
    resolvePart(object:any) {
        return new ResolvePart(object, false);
    }
};

class Behaviors {
    programState: ProgramState;
    constructor(state:ProgramState) {
        this.programState = state;
    }

    static create(state:ProgramState) {
        return new Behaviors(state);
    }
    keep(value:any) {
       return value;
    }
    collect<I, T>(init:I, varName: VarName, updater: (c: I, v:T) => I):CollectStream<I, T> {
        return new CollectStream(init, varName, updater, true);
    }
    timer(interval:number):TimerEvent {
        return new TimerEvent(interval, true);
    }
    delay(varName:VarName, delay: number):DelayedEvent {
        return new DelayedEvent(delay, varName, true);
    }
    resolvePart(object:any) {
        return new ResolvePart(object, true);
    }
    select<I>(_init:I, ..._pairs:Array<any>) {
        // this is a definition that transpiler transforms to _select
    }
    _select<I>(init:I, varName:VarName, updaters: Array<(c:I, v:any) => I>):SelectStream<I> {
        return new SelectStream(init, varName, updaters, true);
    }
    or(...varNames:Array<VarName>) {
        return new OrStream(varNames, false, true)
    }
    gather(regexp:string) {
        return new GatherStream(regexp, true)
    }
    receiver(options?:any) {
        let args = {...options};
        args.isBehavior = true;
        return new ReceiverEvent(args);
    }
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
    log:(...values:any) => void;
    programStates: Map<string, SubProgramState>;
    lastReturned?: Array<any>
    futureScripts?: {scripts: Array<string>, path: string};
    breakpoints: Set<VarName>;
    constructor(startTime:number, app?:any, noTicking?:boolean) {
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
        this.log = (...values) => {console.log(...values);}
        this.noTicking = noTicking !== undefined ? noTicking : false;
        this.programStates = new Map();
        this.breakpoints = new Set();
    }

    evaluator() {
        if (this.noTicking) {return this.noTickingEvaluator();}
        this.evaluatorRunning = window.requestAnimationFrame(() => this.evaluator());
        try {
            this.evaluate(Date.now());
        } catch (e) {
            console.error(e);
            this.log("stopping animation");
            window.cancelAnimationFrame(this.evaluatorRunning);
            this.evaluatorRunning = 0;
        }
    }

    noTickingEvaluator() {
        this.noTicking = true;
        if (this.evaluatorRunning !== 0) {return;}  
        this.evaluatorRunning = setTimeout(() => {
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

    setupProgram(scriptsArg:(string[]|Array<{blockId: string, code: string}>), path:string = "") {
        const invalidatedStreamNames:Set<VarName> = new Set();

        const scripts = (scriptsArg.map((s) => {
            if (typeof s === "string") {return s};
            return s.code;
        }));
        const blockIds = scriptsArg.map((s, i) => {
            if (typeof s === "string") {return `${i}`}
            return s.blockId;
        });
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
        // when there are duplicated definitions for the same name,
        // the last one will be used.
        const jsNodes: Map<VarName, JavaScriptNode> = new Map();
    
        let id = 0;
        for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
            const blockId = blockIds[scriptIndex];
            const script = scripts[scriptIndex];
            if (!script) {continue;}
            const nodes = parseJavaScript(script, id, false);
            for (const n of nodes) {
                if (jsNodes.get(n.id)) {
                    this.log(`node "${n.id}" is defined multiple times`);
                }
                n.blockId = blockId;
                jsNodes.set(n.id, n);
                id++;
            }
        }
    
        const translated = [...jsNodes].map(([_id, jsNode]) => ({id: jsNode.id, code: transpileJavaScript(jsNode)}));
        const evaluated = translated.map((tr) => this.evalCode(tr, path));
        for (let [id, node] of jsNodes) {
            if (node.extraType["gather"]) {
                const r = node.extraType["gather"];
                const ev = evaluated.find((evaled) => evaled.id === id);
                if (ev) {
                    const ins = evaluated.filter((evaled) => new RegExp(r).test(evaled.id)).map((e) => e.id);
                    ev.inputs = ins;
                }
            }
        }
        const sorted = topologicalSort(evaluated);
    
        const newNodes = new Map<NodeId, ScriptCell>();
    
        for (const newNode of evaluated) {
            newNodes.set(newNode.id, newNode);
        }
    
        const unsortedVarnames = difference(new Set(evaluated.map(e => e.id)), new Set(sorted));
    
        for (const u of unsortedVarnames) {
            this.log(`Node ${u} is not going to be evaluated because it is in a cycle or depends on a undefined variable.`);
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
                    this.log(`Node ${varName} won't be evaluated as it depends on an undefined variable ${input}.`);
                }
            }
        }
    }

    updateProgram(scripts:string[], path:string = "") {
        // a utility function that triggers a program update
        // after the current evaluation cycle.
        // This can be called from the program this ProgramState is 
        // running the request is treated like an event but processed
        // right before the next evaluation cycle.
        this.futureScripts = {scripts, path};
    }

    evaluate(now:number) {
        this.time = now - this.startTime;
        this.updated = false;
        let trace:Array<{id:VarName, inputArray: Array<any>, inputs: Array<VarName>,value: any}>|undefined;
        if (this.breakpoints.size > 0) {
            trace = [];
        }
        for (let id of this.order) {
            const node = this.nodes.get(id)!;
 
            if (!this.ready(node)) {continue;}

            if (trace) {
                if (this.breakpoints.has(id)) {
                     debugger;
                 }
            } 
    
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
                    if (change !== undefined) {
                        this.setResolved(id, {value: change, time: this.time});
                    }
                    outputs = this.streams.get(id);
                }
                this.inputArray.set(id, inputArray);
                const maybeValue = outputs;
                if (maybeValue !== undefined && maybeValue !== null && (maybeValue.then || maybeValue[typeKey])) {
                    const ev = maybeValue.then ? new PromiseEvent<any>(maybeValue) : maybeValue;
                    const newStream = ev.created(this, id);
                    this.streams.set(id, newStream);
                    outputs = newStream;
                } else {
                    let newStream:Behavior = new Behavior();//{type: behaviorType}
                    this.streams.set(id, newStream);
                    if (maybeValue === undefined) {continue;}
                    const resolved = this.resolved.get(id);
                    if (!resolved || resolved.value !== maybeValue) {
                        if (isGenerator(maybeValue)) {
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
            if (trace) {
                trace.push({id, inputArray, inputs: node.inputs, value: outputs});
                if (this.breakpoints.has(id)) {
                    this.log(trace);
                }
            }
            const evStream:Stream = outputs as Stream;
            evStream.evaluate(this, node, inputArray, lastInputArray);
        }

        for (let id of this.order) {
            const stream = this.streams.get(id);
            if (!stream) {continue;}
            stream.conclude(this, id);
        }

        if (this.futureScripts) {
            const {scripts, path} = this.futureScripts;
            delete this.futureScripts;
            this.setupProgram(scripts, path);
        }

        return this.updated;
    }

    evalCode(arg:{id:VarName, code:string}, path:string):ScriptCell {
        const {id, code} = arg;
        const hasWindow = typeof window !== "undefined";
        let body;
        const p = path === "" || !path.endsWith("/") ? path : path.slice(0, -1);
        if (hasWindow) {
            const base = window.location.origin === "null" ? window.location.pathname : window.location.origin;
            body = `return ${code} //# sourceURL=${base}/${p}/node/${id}`;
        } else {
            body = `return ${code} //# sourceURL=/${p}/node/${id}`;
        }
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

    getEventValues(record:QueueRecord, _t:number) {
        if (record.queue.length >= 1) {
            const value = record.queue.map((pair => pair.value))
            record.queue = [];
            return value;
        }
        return undefined;
    }

    baseVarName(varName:VarName) {
        return varName[0] !== "$" ? varName : varName.slice(1);
    }

    registerEvent(receiver:VarName, value:any) {
        const stream = this.streams.get(receiver) as ReceiverEvent;
        if (!stream) {return;}
        if (stream.queued) {
            let ary = this.changeList.get(receiver);
            if (!ary) {
                ary = [];
                this.changeList.set(receiver, ary);
            }
            ary.push(value);
        } else {
            this.changeList.set(receiver, value);
        }
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

    merge(...funcs:Function[]) {
        let scripts = this.scripts;
        const outputs:string[] = [];
        funcs.forEach((func) => {
            const {output} = getFunctionBody(func.toString(), true);
            outputs.push(output);
        });
        this.setupProgram([...scripts, ...outputs] as string[]);    
    }

    loadTS(path:string) {
        let i = 0;
        return fetch(path).then((resp) => resp.text()).then((text) => {
            const js = translateTS(text, `${i}.ts`);
            if (!js) {return null}
            let dataURL = URL.createObjectURL(new Blob([js], {type: "application/javascript"}));
            return eval(`import("${dataURL}")`).then((mod:any) => {
                return mod;
            }).finally(() => {
                URL.revokeObjectURL(dataURL);
            });
        })
    }

    component(func:Function) {
        return (input:any, key:string) => {
            let programState:ProgramState;
            let returnValues:Array<string>|null = null;
            let newProgramState = false;
            let subProgramState = this.programStates.get(key);
            if (!subProgramState) {
                newProgramState = true;
                // console.log(key);
                programState = new ProgramState(this.time);
                programState.lastReturned = undefined;
            } else {
                programState = subProgramState.programState as ProgramState;
                returnValues = subProgramState.returnArray;
            }

            const maybeOldFunc = subProgramState?.func;

            if (newProgramState || func !== maybeOldFunc) {
                const {params, returnArray, output} = getFunctionBody(func.toString(), false);
                returnValues = returnArray;
                // console.log(params, returnArray, output, this);
                const receivers = params.map((r) => `const ${r} = Events.receiver();`).join("\n");
                programState.setupProgram([receivers, output], func.name);
                this.programStates.set(key, {programState, func, returnArray});
            }

            const trigger = (input:any) => {
                // console.log(input);
                for (let key in input) {
                    programState.setResolvedForSubgraph(
                        key,
                        {value: input[key], time: this.time}
                    )
                }
                programState.evaluate(this.time);
                const result:any = {};
                const resultTest = [];
                if (returnValues) {
                    for (const n of returnValues) {
                        const v = programState.resolved.get(n);
                        resultTest.push(v ? v.value : undefined)
                        if (v && v.value !== undefined) {
                            result[n] = v.value;
                        }
                    }
                    return result;
                }
                return {};
            };
            return trigger(input);
        };
    }

    renkonify(func:Function, optSystem?:any) {
        const programState =  new ProgramState(0, optSystem);
        const {params, returnArray, output} = getFunctionBody(func.toString(), false);
        // console.log(params, returnArray, output, this);
        const self = this;

        const receivers = params.map((r) => `const ${r} = undefined;`).join("\n");
    
        programState.setupProgram([receivers, output]);
    
        function generator(params:any) {
            const gen = renkonBody(params) as GeneratorWithFlag<any>;
            gen.done = false;
            return Events.create(self).next(gen);
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
        // partialURL: :http..."
        // return itself

        // partialURL: './bridge/bridge.js'
        // expected:
        // if it is running on substrate, and it is from space, there is
        // at least one slash and we remove chars after that.

        // if ?host parameter is specified, use that as host

        // partialURL: "/tool-call/js/commands.js"
        // expected:
        // if it is running on substrate, it is the full path on substrate.home.arpa
        // if not, use ?host parameter value. if host is not specified, it is the server's address

        if (/^http(s)?:\/\//.test(partialURL)) {
            return partialURL;
        }

        if (partialURL.startsWith("/")) {
            const url = new URL(window.location.toString());
            const maybeHost = url.searchParams.get("host") || url.host;
            return `${url.protocol}//${maybeHost}}${partialURL}`;
        }

        return partialURL;
    }

    addBreakpoint(...ids:Array<VarName>) {
        ids.forEach((id) => {
            this.breakpoints.add(id);
        });
    }

    removeBreakpoint(...ids:Array<VarName>) {
        ids.forEach((id) => {
            this.breakpoints.delete(id);
        });
    }

    resetBreakpoint() {
        this.breakpoints = new Set();
    }

    setLog(func:(...values:any) => void) {
        this.log = func;
    }
}
