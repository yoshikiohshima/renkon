import {JavaScriptNode, parseJavaScript, findDecls} from "./javascript/parse"
import {getFunctionBody, transpileJavaScript} from "./javascript/transpile"
import packageJson from "../package.json";

export const version = packageJson.version;

import {
    ScriptCell, VarName, NodeId, Stream, BehaviorStream, EventStream,
    DelayedEvent, CollectStream, SelectStream, GatherStream, PromiseEvent,
    GeneratorNextEvent, QueueRecord, TimerEvent, ChangeEvent, OnceEvent,
    ReceiverEvent, UserEvent, SendEvent, OrStream, ResolvePart,
    typeKey,
    isBehaviorKey,
    GeneratorWithFlag,
    ProgramStateType,
    ValueRecord,
    ResolveRecord,
    SubProgramState,
} from "./combinators";
import { translateTS } from "./typescript";

type ScriptCellForSort = Omit<ScriptCell, "body" | "code" | "forceVars" | "topType" | "input">

type ObserveCallback = (notifier:(v:any) => void) => () => void;

type EventBodyType = {
    forObserve: boolean;
    queued: boolean;
    callback?: ObserveCallback;
    eventHandler?: (evt:any) => any | null;
    dom?: HTMLElement | string;
    options?: {capture?:boolean, passive?:boolean, once?:boolean},
    eventName?: string,
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

function eventBody(args:EventBodyType) {
    let {forObserve, callback, dom, eventName, eventHandler, state, queued, options} = args;
    let record:QueueRecord = {queue:[]};
    let myHandler: ((evt:any) => any) | null;
    let myOptions;

    if (options) {
        myOptions = {...options};
    }

    let realDom:HTMLElement|undefined;
    if (typeof dom === "string") {
        realDom = document.querySelector(dom) as HTMLInputElement;
    } else {
        realDom = dom;
    }

    const notifier = (value:any) => {
        record.queue.push({value, time: 0});
        state.requestAlarm(1);
        state.scheduleAlarm();
    };

    if (realDom && !forObserve && eventName) {
        if (eventHandler) {
            myHandler = (evt) => {
                const value = eventHandler(evt);
                if (value !== undefined) {
                    record.queue.push({value, time: 0});
                    state.requestAlarm(1);
                    state.scheduleAlarm();
                }
            }
        } else {
            myHandler = defaultHandler;
        }
        if (myHandler) {
            if (myOptions) {
                realDom.addEventListener(eventName, myHandler, myOptions);
            } else {
                realDom.addEventListener(eventName, myHandler);
            }
        }
        if (eventHandler === null) {
            if (myOptions) {
                realDom.removeEventListener(eventName, myHandler, myOptions as EventListenerOptions);
            } else {
                realDom.removeEventListener(eventName, myHandler);
            }
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
        let myOptions;
        if (options) {
            myOptions = {...options};
            delete myOptions.queued;
        }
        const queued = !!options?.queued;

        return eventBody({
            forObserve: false, dom,
            eventName: eventName, eventHandler: handler,
            state: this.programState, queued, options: myOptions});
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
        return new OrStream(varNames, false, false)
    }
    some(...varNames:Array<VarName>) {
        return new OrStream(varNames, false, true)
    }
    _or_index(...varNames:Array<VarName>) {
        return new OrStream(varNames, true, false);
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
        return eventBody({
            forObserve: true, callback,
            state:this.programState, queued: options?.queued
        });
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
    types: Map<NodeId, "Behavior"|"Event">;
    nodes: Map<NodeId, ScriptCell>;
    streams: Map<VarName, Stream>;
    scratch: Map<VarName, ValueRecord>;
    resolved: Map<VarName, ResolveRecord>;
    inputArray: Map<NodeId, Array<any>>;
    changeList: Map<VarName, any>;
    nextDeps: Set<VarName>;
    time: number;
    startTime: number;
    evaluatorRunning: number;
    errored?: any;
    exports?: Array<string>;
    imports?: Array<string>;
    updated: boolean;
    pendingEvaluation: {handle: any, type: "animationFrame"|"setTimeout"|"setInterval"}|null;
    evaluationAlarm: Array<number>;
    pendingAnimationFrame: boolean;
    tickingEvaluation: boolean;
    noAnimationFrame: boolean;
    app?: any;
    log:(...values:any) => void;
    thisNode?:ScriptCell;
    programStates: Map<string, SubProgramState>;
    hasComponent: Map<string, Array<string>>;
    componentParent?: ProgramStateType;
    futureScripts?: {scripts: Array<string>, path: string};
    breakpoints: Set<VarName>;
    constructor(startTime:number, app?:any) {
        this.scripts = [];
        this.order = [];
        this.types = new Map();
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
        this.evaluationAlarm = [];
        this.pendingAnimationFrame = false;
        this.tickingEvaluation = false;
        this.noAnimationFrame = false;
        this.pendingEvaluation = null;
        this.app = app;
        this.log = (...values) => {console.log(...values);}
        this.hasComponent = new Map();
        this.programStates = new Map();
        this.breakpoints = new Set();
        this.nextDeps = new Set();
    }

    makeTickingHandle() {
        if (this.noAnimationFrame) {
            return setInterval(() => this.tickingEvaluator(), 16);
        } else {
            requestAnimationFrame(() => this.tickingEvaluator())
        }
    }

    tickingEvaluator() {
        this.tickingEvaluation = true;
        this.pendingEvaluation = {type: "animationFrame", handle: this.makeTickingHandle()};
        let success;
        try {
            this.evaluate(Date.now());
            success = true;
        } catch (e) {
            console.error(e);
            this.log("stopping animation");
            if (this.noAnimationFrame) {
                clearInterval(this.pendingEvaluation.handle);
            } else {
                cancelAnimationFrame(this.pendingEvaluation.handle);
            }
            this.pendingEvaluation = null;
            success = false;
        }
        return success;
    }

    requestAlarm(timeOffset:number) {
        // console.log("request", this.time, timeOffset);
        if (this.errored) {return;}
        if (this.tickingEvaluation) {return;}
        if (this.componentParent) {return this.componentParent.requestAlarm(timeOffset);}
        const maybeAlarm = this.time + timeOffset;
        let stored = false;
        if (this.evaluationAlarm.length > 0 && maybeAlarm < this.evaluationAlarm[0]) {
            stored = true;
            this.evaluationAlarm.unshift(maybeAlarm);
        } else {
            for (let i = 0; i < this.evaluationAlarm.length - 1; i++) {
                const prev = this.evaluationAlarm[i];
                const next = this.evaluationAlarm[i + 1];
                if (maybeAlarm === prev) {
                    stored = true;
                    break;
                }
                if (prev < maybeAlarm && maybeAlarm < next) {
                    this.evaluationAlarm.splice(i + 1, 0, maybeAlarm);
                    stored = true;
                    break;
                }
            }
        }
        if (!stored) {
            this.evaluationAlarm.push(maybeAlarm);
        }
        /*
        for (let i = 0; i < this.evaluationAlarm.length - 1; i++) {
            if (this.evaluationAlarm[i] > this.evaluationAlarm[i+1]) {debugger;}
        }*/
    }

    scheduleAlarm() {
        const log = (..._args:any[]) => {/*console.log(..._args)*/};
        // const inIframe = window.top !== window; if (inIframe) {console.log(...args)}
        if (this.tickingEvaluation) {return;}
        if (this.componentParent) {
            this.componentParent.scheduleAlarm();
            return;
        }

        const maybeAlarm = this.evaluationAlarm[0];
        log("schedule", maybeAlarm, this.time, this.evaluationAlarm, this.pendingEvaluation);

        if (this.errored) {return;}
        let keptAnimation = false;

        if (this.pendingEvaluation) {
            if (this.pendingEvaluation.type === "setTimeout") {
                clearTimeout(this.pendingEvaluation.handle);
            } else if (this.pendingEvaluation.type === "animationFrame") {
                if (maybeAlarm !== undefined && maybeAlarm - this.time < 20) {
                    keptAnimation = true;
                } else {
                    this.pendingAnimationFrame = false;
                    log("clear animationframe", this.pendingEvaluation);
                    // cancelAnimationFrame(this.pendingEvaluation.handle);
                }
            }
            if (!keptAnimation) {
                this.pendingEvaluation = null;
            }
        }
        if (maybeAlarm === undefined) {
            return;
        }
        if (maybeAlarm - this.time < 20 && !this.noAnimationFrame) {
            if (!keptAnimation) {
                this.pendingAnimationFrame = true;
                this.pendingEvaluation = {
                    type: "animationFrame",
                    handle: this.ticker(),
                };
                log("start animationframe", this.pendingEvaluation);
            }
            return;
        }
        this.pendingEvaluation = {
            type: "setTimeout",
            handle: setTimeout(() => {
                try {
                    this.evaluate(Date.now());
                } catch (e) {
                    console.error(e);
                    this.log("stopping animation");
                    this.errored = e;
                    this.thisNode = undefined;
                }
            }, maybeAlarm - this.time - 20),
        }
    }

    ticker() {
        if (this.pendingAnimationFrame) {
            return requestAnimationFrame(() => {
                if (this.pendingAnimationFrame) {
                    this.tick();
                    this.ticker();
                }
            });
        }
    }

    tick() {
        if (this.evaluationAlarm[0] - this.time < 20) {
            try {
                this.evaluate(Date.now());
            } catch (e) {
                console.error(e);
                this.log("stopping animation");
                this.errored = e;
                this.thisNode = undefined;
                this.pendingAnimationFrame = false;
                this.pendingEvaluation = null;
            }

        }
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

        this.nextDeps = new Set();
    
        for (const newNode of evaluated) {
            newNodes.set(newNode.id, newNode);
            const deps = newNode.inputs.filter(varName => varName.startsWith("$")).map((varName) => varName.slice(1));
            for (const dep of deps) {
                this.nextDeps.add(dep);
            }
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
        this.types = new Map();
    
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

        this.order.forEach((nodeId) => {
            const node = this.nodes.get(nodeId);
            if (!node) {return;}
            if (node.topType !== "") {
                this.types.set(nodeId, node.topType);
                return;
            }

            this.types.set(nodeId, "Behavior");
            for (const input of node.inputs) {
                if (this.types.get(input) === "Event") {
                    this.types.set(nodeId, "Event");
                    return;
                }
            }
        });

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
        delete this.errored;
    }

    updateProgram(scripts:string[], path:string = "") {
        // a utility function that triggers a program update
        // after the current evaluation cycle.
        // This can be called from the program this ProgramState is 
        // running the request is treated like an event but processed
        // right before the next evaluation cycle.
        if (!this.thisNode) {
            this.setupProgram(scripts, path);
            this.requestAlarm(1);
            this.scheduleAlarm();   
        } else {
            this.futureScripts = {scripts, path};
        }
    }

    findDecls(code:string) {
        return findDecls(code);
    }

    findDecl(name:string):string|undefined{
        const decls = this.findDecls(this.scripts.join("\n"));
        const decl = decls.find((d) => d.decls.includes(name));
        if (decl) {return decl.code;}
    }

    evaluate(now:number, callConclude = true) {
        this.time = now - this.startTime;
        this.prelude();
        this.updated = false;
        let trace:Array<{id:VarName, inputArray: Array<any>, inputs: Array<VarName>,value: any}>|undefined;
        if (this.breakpoints.size > 0) {
            trace = [];
        }
        for (let id of this.order) {
            this.thisNode = this.nodes.get(id)!;
 
            if (!this.ready(this.thisNode)) {continue;}

            if (trace) {
                if (this.breakpoints.has(id)) {
                     debugger;
                 }
            } 
    
            const change = this.changeList.get(id);
    
            const inputArray = this.thisNode.inputs.map((inputName) => this.resolved.get(this.baseVarName(inputName))?.value);
            if (this.hasComponent.get(id)) {
                inputArray.push(this.time);
            }
            const lastInputArray = this.inputArray.get(id);
    
            let outputs:any;
            if (change === undefined && this.equals(inputArray, lastInputArray)) {
                outputs = this.streams.get(id)!;
            } else {
                if (change === undefined) {
                    outputs = this.thisNode.body.apply(
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
                    let newStream:Stream = this.types.get(id) === "Event" ? new EventStream() : new BehaviorStream();
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
                trace.push({id, inputArray, inputs: this.thisNode.inputs, value: outputs});
                if (this.breakpoints.has(id)) {
                    this.log(trace);
                }
            }
            const evStream:Stream = outputs as Stream;
            evStream.evaluate(this, this.thisNode, inputArray, lastInputArray);
        }

        if (callConclude) {
            this.conclude();
        }

        if (this.futureScripts) {
            const {scripts, path} = this.futureScripts;
            delete this.futureScripts;
            this.setupProgram(scripts, path);
            this.requestAlarm(1);
        }

        this.scheduleAlarm();

        this.thisNode = undefined;
        return this.updated;
    }

    prelude() {
        let i = 0;
        while (true) {
            let alarm = this.evaluationAlarm[i];
            if (alarm === undefined) {break;}
            if (alarm >= this.time) {break;}
            i++;
        }
        this.evaluationAlarm = this.evaluationAlarm.slice(i, this.evaluationAlarm.length)
    }

    conclude() {
        for (let id of this.order) {
            const stream = this.streams.get(id);
            if (!stream) {continue;}
            stream.conclude(this, id);
        }
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

        const array = this.hasComponent.get(node.id);

        if (array) {
            for (const key of array) {
                const programState = this.programStates.get(key);
                if (programState?.programState.pendingEvaluation) {
                    return true;
                }
            }
        }
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
        this.requestAlarm(1);
        this.scheduleAlarm();
    }

    setResolved(varName:VarName, value:any) {
        this.resolved.set(varName, value);
        this.updated = true;
        if (this.nextDeps.has(varName)) {
            this.requestAlarm(1);
        }
    }

    setResolvedForSubgraph(varName:VarName, value:any) {
        this.setResolved(varName, value);
        this.inputArray.set(varName, []);
        this.streams.set(varName, new BehaviorStream());
    }

    merge(...funcs:Function[]) {
        let scripts = this.scripts;
        const outputs:string[] = [];
        funcs.forEach((func) => {
            const {output} = getFunctionBody(func.toString(), true);
            outputs.push(output);
        });
        this.updateProgram([...scripts, ...outputs]);
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

    component(argFunc:Function|string) {
        const func:Function = typeof argFunc === "string" ? Function(`return ` + argFunc)() : argFunc;
        const funcString = typeof argFunc === "string" ? argFunc : argFunc.toString();
        return (input:any, key:string) => {

            if (key === undefined) {console.log("the second argument key has to be specified");}
            let programState:ProgramState;
            let returnValues:{[key]:string}|null = null;
            let newProgramState = false;
            let subProgramState = this.programStates.get(key);
            if (!subProgramState) {
                newProgramState = true;
                // console.log(key);
                programState = new ProgramState(this.time);
                programState.componentParent = this;
            } else {
                programState = subProgramState.programState as ProgramState;
                returnValues = subProgramState.outputNames;
            }

            const maybeOldFunc = subProgramState?.funcString;

            if (newProgramState || funcString !== maybeOldFunc) {
                let {params, types, returnValues: rs, output} = getFunctionBody(funcString, false);
                returnValues = rs;
                // console.log(params, returnArray, output, this);
                const receivers = params.map((r) => `const ${r} = ${types?.get(r) === "Behavior" ? "Behaviors" : "Events"}.receiver();`).join("\n");
                programState.setupProgram([receivers, output], func.name);
                this.programStates.set(key, {programState, funcString, outputNames: returnValues});
                if (this.thisNode === undefined) {
                    console.log("a component is created outside of a node definition");
                } else {
                    let array = this.hasComponent.get(this.thisNode.id);
                    if (!array) {
                        array = [];
                        this.hasComponent.set(this.thisNode.id, array);
                    }
                    if (array.includes(key)) {
                        console.log("the same key is specified for multiple component instances")
                    } else {
                        array.push(key);
                    }
                }
            }

            const trigger = (input:any) => {
                // console.log(input);
                for (let key in input) {
                    programState.setResolvedForSubgraph(
                        key,
                        {value: input[key], time: this.time}
                    )
                }
                programState.evaluate(this.time, false);
                const result:any = {};
                const resultTest = [];
                if (returnValues) {
                    if (Array.isArray(returnValues)) {
                        console.log("arrayform is no longer supported");
                    } else {
                        for (const k of Object.keys(returnValues)) {
                            const v = programState.resolved.get(returnValues[k]);
                            resultTest.push(v ? v.value : undefined)
                            if (v && v.value !== undefined) {
                                result[k] = v.value;
                            }
                        
                        }
                    }

                    if (programState.evaluationAlarm.length > 0) {
                        this.requestAlarm(programState.evaluationAlarm[0] - programState.time);
                        this.scheduleAlarm();
                    }
                }
                programState.conclude();
                return result;
            };
            return trigger(input);
        };
    }

    renkonify(func:Function, optSystem?:any) {
        const programState =  new ProgramState(0, optSystem);
        const {params, returnValues, output} = getFunctionBody(func.toString(), false);
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
                if (returnValues && Array.isArray(returnValues)) {
                    for (const n of returnValues) {
                        const v = programState.resolved.get(n);
                        resultTest.push(v ? v.value : undefined)
                        if (v && v.value !== undefined) {
                            result[n] = v.value;
                        }
                    }
                }
                if (returnValues) {
                    for (const k of Object.keys(returnValues)) {
                        const v = programState.resolved.get(returnValues[k]);
                        resultTest.push(v ? v.value : undefined)
                        if (v && v.value !== undefined) {
                            result[k] = v.value;
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
