export type NodeId = string;
export type VarName = string;
export type ComponentKey = string;
export type StreamTypeLabel = "Event" | "Behavior" | "";

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: NodeId,
    topType: StreamTypeLabel,
    inputs: Array<VarName>,
    forceVars: Array<VarName>,
    outputs: VarName,
    extraType?:any,
    input?: string
}

export type ComponentType = {
    params:string[],
    types: Map<string, "Event"|"Behavior"> | null,
    rawTypes: Map<string, string> | null,
    returnValues: {[key: string]: string} | null,
    output: string
}

export type ResolveRecord = {
    value: any,
    time: number
}

export type EvaluatorOptions = {
    once?:boolean;
    noAnimationFrame?:boolean;
    ticker?:boolean;
}

export type PendingEvaluationType = {
    handle: any,
    type: "animationFrame"|"setTimeout"|"setInterval"
};

export const typeKey = Symbol("typeKey");
export const isBehaviorKey = Symbol("isBehavior");

export const eventType = "EventType";
export const userEventType = "UserEventType";
export const delayType = "DelayType";
export const timerType = "TimerType";
export const calmType = "CalmType";
export const collectType = "CollectType";
export const selectType = "SelectType"
export const promiseType = "PromiseType";
export const behaviorType = "BehaviorType";
export const onceType = "OnceType";
export const orType = "OrType";
export const sendType = "SendType";
export const receiverType = "ReceiverType";
export const changeType = "ChangeType";
export const gatherType = "GatherType";
export const generatorNextType = "GeneratorNextType";
export const resolvePartType = "ResolvePart";

export type StreamType = 
    typeof eventType |
    typeof userEventType |
    typeof delayType |
    typeof timerType |
    typeof calmType |
    typeof collectType |
    typeof selectType |
    typeof promiseType |
    typeof behaviorType |
    typeof onceType |
    typeof orType |
    typeof sendType |
    typeof receiverType |
    typeof changeType |
    typeof gatherType |
    typeof generatorNextType |
    typeof resolvePartType;

export type SubProgramState = {
    programState: ProgramStateType,
    funcString:string,
    outputNames:{[key:string]:string}|null
};

export interface ProgramStateType {
    // the program that user set with "setupProgram"
    scripts: Array<string>;
    // a place where a user program can access additional objects and values via Renkon.app
    app?: any;
    // topological sort of node names that the evaluator walks through
    order: Array<NodeId>;
    // the Behavior or Event for each node
    types: Map<NodeId, "Behavior"|"Event">;
    // compiled nodes that holds information such as input names and body
    nodes: Map<NodeId, ScriptCell>;
    // a cache, so to speak, to keep the streams of known variations
    streams: Map<VarName, Stream>;
    // another cache memory for streams to remember additional information
    scratch: Map<VarName, ValueRecord>;
    // the values for nodes
    resolved: Map<VarName, ResolveRecord>;
    // the memory to check whether the current input values are different from last time
    inputArray: Map<NodeId, Array<any>>;
    // the buffer to store the values send via "Events.send"
    changeList: Map<VarName, any>;
    // a set of node names that are used in $-dependencies.
    nextDeps: Set<VarName>;
    // the current logical time.
    time: number;
    // the "physical start time" of this ProgramState instance
    startTime: number;
    // indicates that the last evaluation of the program resulted in an error
    errored?: any;
    // user visible meta feature that has the currently evaluating node
    thisNode?:ScriptCell;
    // ProgramStates instantiated from the component that is created with "Renkon.component" call
    programStates: Map<ComponentKey, SubProgramState>; // "key" to subprogram
    // The nodes of the owns a component, so that a node can trigger recomputation when
    // a component updates intenally
    hasComponent: Map<VarName, Set<ComponentKey>>; // the owning varName to keys
    // the owner of a component
    componentParent?: ProgramStateType;
    // indicates that a component updated in an evaluation cycle
    componentUpdated: boolean;

    //  a timer of some kind that will call evaluate() in the later time.
    pendingEvaluation: PendingEvaluationType|null;
    // the list of future alarms.
    evaluationAlarm: Array<number>;

    // a set of changed nodes after one cycle of evaluation  
    changedNodeNames: Set<VarName>;

    // user visible function to update the program
    updateProgram(scripts:Array<string>):void;

    ready(node: ScriptCell):boolean;
    equals(aArray?:Array<any|undefined>, bArray?:Array<any|undefined>):boolean;
    defaultReady(node: ScriptCell):boolean;
    spliceDelayedQueued(record:QueueRecord, t:number):any;
    getEventValue(record:QueueRecord, _t:number):any;
    getEventValues(record:QueueRecord, _t:number):any;
    baseVarName(varName:VarName):VarName;
    setResolved(varName:VarName, value:{time:number, value:any}):void;
    requestAlarm: (alarm:number) => void;
    scheduleAlarm: (alarm?:number) => void;
    setLog(func:(...values:any) => void):void;
    log:(...values:any) => void;
}

export interface ValueRecord {}
export interface CollectRecord<I> extends ValueRecord {
    current: I,
}
export interface PromiseRecord extends ValueRecord {
    promise: Promise<any>
}
export interface QueueRecord extends ValueRecord {
    queue: Array<ResolveRecord>
    cleanup?: () => void
}

export type GeneratorWithFlag<T> = AsyncGenerator<T> & {done: boolean};

export class Stream {
    [typeKey]: StreamType;
    [isBehaviorKey]: boolean;
    constructor(type:StreamType, isBehavior:boolean) {
        this[typeKey] = type;
        this[isBehaviorKey] = isBehavior;
    }

    created(_state:ProgramStateType, _id:VarName):Stream {
        return this;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        for (const inputName of node.inputs) {
            const varName = state.baseVarName(inputName);
            const resolved = state.resolved.get(varName)?.value;
            if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
        }
        return true;
    }

    evaluate(_state:ProgramStateType, _node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        return;
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        const inputArray = state.inputArray.get(varName);
        const inputs = state.nodes.get(varName)!.inputs;
        if (inputArray && inputs) {
            for (let i = 0; i < inputs.length; i++) {
                const type = state.types.get(inputs[i]);
                if (type === "Event") {
                    inputArray[i] = undefined;
                }
            }
        }
        if (!this[isBehaviorKey]) {
            if (state.resolved.get(varName)?.value !== undefined) {
                state.resolved.delete(varName);
                return varName;
            }
        } 
        return;
    }
}

export class BehaviorStream extends Stream {
    constructor() {
        super(behaviorType, true);
    }
}

export class EventStream extends Stream {
    constructor() {
        super(eventType, false);
    }
}

export class DelayedEvent extends Stream {
    delay: number;
    varName: VarName;
    constructor(delay :number, varName: VarName, isBehavior:boolean) {
        super(delayType, isBehavior);
        this.delay = delay;
        this.varName = varName;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        const output = node.outputs;
        const scratch:QueueRecord = state.scratch.get(output) as QueueRecord;
        if (scratch?.queue.length > 0) {return true;}
        return state.defaultReady(node);
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (!state.scratch.get(id)) {
            state.scratch.set(id, {queue: []});
        }
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        const value = state.spliceDelayedQueued(state.scratch.get(node.id) as QueueRecord, state.time);
 
        if (value !== undefined && state.resolved.get(node.id)?.value !== value) {
            state.setResolved(node.id, {value, time: state.time});
        }
        const inputIndex = 0; // node.inputs.indexOf(this.varName);
        const myInput = inputArray[inputIndex];

        const doIt = (this[isBehaviorKey] && myInput !== undefined && myInput !== lastInputArray?.[inputIndex])
            || (!this[isBehaviorKey] && myInput !== undefined);
        if (doIt) {
            const scratch:QueueRecord = state.scratch.get(node.id) as QueueRecord;
            state.requestAlarm(this.delay);
            scratch.queue.push({time: state.time + this.delay, value: myInput});
        }
    }
}

export class CalmStream extends Stream {
    interval: number;
    varName: VarName;
    constructor(interval :number, varName: VarName, isBehavior:boolean) {
        super(calmType, isBehavior);
        this.interval = interval;
        this.varName = varName;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        const output = node.outputs;
        const scratch = state.scratch.get(output);
        const {last, event} = scratch as {last: number, event?: any};
        if (event && last + this.interval <= state.time) {return true;}
        return state.defaultReady(node);
    }

    created(state:ProgramStateType, id:VarName):Stream {
        const scratch = state.scratch.get(id);
        if (!scratch) {
            state.scratch.set(id, {last: state.time - (this.interval + 1), event: undefined})
        }
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const inputIndex = 0; // node.inputs.indexOf(this.varName);
        const myInput = inputArray[inputIndex];
        const scratch = state.scratch.get(node.id);
        const {last, event} = scratch as {last: number, event?: any};
        const maybeEvent = myInput !== undefined ? myInput : event;
        if (last + this.interval <= state.time) {
            if (maybeEvent !== undefined) {
                state.setResolved(node.id, {value: maybeEvent, time: state.time});
                state.scratch.set(node.id, {last: state.time, event: undefined});
                state.requestAlarm(this.interval);
            }
        } else {
            if (maybeEvent !== undefined && maybeEvent !== event) {
                state.scratch.set(node.id, {last: last, event: maybeEvent});
            }
        }
    }
}

export class TimerEvent extends Stream {
    interval: number;
    constructor(interval:number, isBehavior:boolean) {
        super(timerType, isBehavior);
        this.interval = interval;
    }

    created(_state:ProgramStateType, _id:VarName):Stream {
        return this;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        const output = node.outputs;
        const last = state.scratch.get(output) as number;
        const interval = this.interval;
        if (interval <= 0) {return false;}
        return last === undefined || last + interval <= state.time;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const interval = this.interval;
        if (interval <= 0) {return;}
        const logicalTrigger = interval * Math.floor(state.time / interval);
        state.requestAlarm(this.interval);
        state.setResolved(node.id, {value: logicalTrigger, time: state.time});
        state.scratch.set(node.id, logicalTrigger);
    }
}

export class PromiseEvent<T> extends Stream {
    promise:Promise<T>;
    constructor(promise:Promise<T>) {
        super(promiseType, true);
        this.promise = promise;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        const oldPromise = (state.scratch.get(id) as PromiseRecord)?.promise;
        const promise = this.promise;
        if (oldPromise && promise !== oldPromise) {
            state.resolved.delete(id);
        }
        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                state.scratch.set(id, {promise});
                state.requestAlarm(1);
                state.scheduleAlarm();
                state.setResolved(id, {value, time: state.time});
            }
        });
        return this;
    }
}

export class OrStream extends Stream {
    varNames: Array<VarName>;
    useIndex:boolean;
    collection: boolean;
    constructor(varNames:Array<VarName>, useIndex:boolean, collection:boolean, isBehavior:boolean = false) {
        super(orType, isBehavior);
        this.varNames = varNames;
        this.useIndex = useIndex;
        this.collection = collection;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        const lastInputArray = state.inputArray.get(node.id);
        if (!lastInputArray) {
            for (let i = 0; i < node.inputs.length; i++) {
                const myInput = state.resolved.get(node.inputs[i])?.value;
                if (myInput !== undefined) {return true;}
            }
            return false;
        }

        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = state.resolved.get(node.inputs[i])?.value;
            if (myInput !== undefined && myInput !== lastInputArray[i]) {return true;}
        }
        return false;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        if (this.collection) {
            const indices = [];
            const values:Array<any> = [];
            for (let i = 0; i < node.inputs.length; i++) {
                if (inputArray[i] !== undefined) {
                    indices.push(i);
                }
                values[i] = inputArray[i];
            }

            if (indices.length === 0) {
                return;
            }
            if (this.useIndex) {
                state.setResolved(node.id, {value: indices, time: state.time}); 
            } else {
                state.setResolved(node.id, {value: values, time: state.time});
            }
            return;
        }
        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = inputArray[i];
            if (myInput !== undefined && (lastInputArray === undefined || myInput !== lastInputArray[i])) {
                if (this.useIndex) {
                    state.setResolved(node.id, {value: {index: i, value: myInput}, time: state.time}); 
                } else {
                    state.setResolved(node.id, {value: myInput, time: state.time});
                }
                return;
            }
        }
    }
}

export class UserEvent extends Stream {
    record: ValueRecord;
    queued: boolean;
    constructor(record:QueueRecord, queued?: boolean) {
        super(userEventType, false);
        this.record = record;
        this.queued = !!queued;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        let oldRecord = state.scratch.get(id) as QueueRecord;
        if (oldRecord && oldRecord.cleanup &&
            typeof oldRecord.cleanup === "function") {
                oldRecord.cleanup();
                oldRecord.cleanup = undefined;
        }
        state.scratch.set(id, this.record);

        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        let newValue;
        if (this.queued) {
            newValue = state.getEventValues(state.scratch.get(node.id) as QueueRecord, state.time);
        } else {
            newValue = state.getEventValue(state.scratch.get(node.id) as QueueRecord, state.time);
        }
        if (newValue !== undefined) {
            if (newValue !== null && (newValue as unknown as Promise<any>).then) {
                (newValue as unknown as Promise<any>).then((value:any) => {
                    state.setResolved(node.id, {value, time: state.time});
                })
            } else {
                state.setResolved(node.id, {value: newValue, time: state.time});
            }
        }
    }
}

export class SendEvent extends Stream {
    constructor() {
        super(sendType, false);
    }
}

export class ReceiverEvent extends Stream {
    queued: boolean;
    constructor(options?:any) {
        const isBehavior = !!options?.isBehavior;
        super(receiverType, isBehavior);
        this.queued = !!options?.queued;
    }

    created(_state:ProgramStateType, _id:VarName):Stream {
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const value = state.scratch.get(node.id);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            state.scratch.delete(varName);
            return varName;
        }
        return;
    }
}

export class ChangeEvent extends Stream {
    value:any;
    constructor(value:any) {
        super(changeType, false);
        this.value = value;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        if (this.value === undefined) {return;}
        if (this.value === state.scratch.get(node.id)) {return;}
        state.setResolved(node.id, {value: this.value, time: state.time});
        state.scratch.set(node.id, this.value);
    }
}

export class OnceEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(onceType, false);
        this.value = value;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        return state.scratch.get(node.id) === undefined;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        state.setResolved(node.id, {value: this.value, time: state.time});
        state.scratch.set(node.id, this.value);
    }
}

export class CollectStream<I, T> extends Stream {
    init: (()=>I)|(()=>Promise<I>);
    varName: VarName;
    updater: (acc:I, v: T) => I;
    constructor(init:(()=>I)|(()=>Promise<I>), varName:VarName, updater:(acc:I, v: T) => I, isBehavior: boolean) {
        super(collectType, isBehavior);
        this.init = init;
        this.varName = varName;
        this.updater = updater;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        const scratch = state.scratch.get(id);
        state.streams.set(id, this);
        if (scratch) {
            const resolving = (scratch as any).resolving;
            if (resolving === true || typeof resolving !== "boolean") {
                return this;
            }
        }
        const initValue = this.init();

        if (initValue && typeof initValue === "object" && (initValue as any).then) {
            state.scratch.set(id, {resolving: true});
            (initValue as any).then((value:any) => {
                state.requestAlarm(1);
                state.scheduleAlarm();
                state.setResolved(id, {value, time: state.time});
                state.scratch.set(id, {current: value});
            });
            return this;
        }

        state.setResolved(id, {value: initValue, time: state.time});
        state.scratch.set(id, {current: initValue});
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        type ArgTypes = Parameters<typeof this.updater>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        if (!scratch) {return;}
        if ((scratch as any).resolving) {return;}
        const inputIndex = node.inputs.indexOf(this.varName);
        const inputValue = inputArray[inputIndex];
        if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
            const newValue = this.updater(scratch.current, inputValue);
            if (newValue !== undefined) {
                // this check feels like unfortunate.
                if (newValue !== null && (newValue as unknown as Promise<any>).then) {
                    (newValue as unknown as Promise<any>).then((value:any) => {
                        state.requestAlarm(1);
                        state.scheduleAlarm();
                        state.setResolved(node.id, {value, time: state.time});
                        state.scratch.set(node.id, {current: value});
                    });
                } else {
                    state.setResolved(node.id, {value: newValue, time: state.time});
                    state.scratch.set(node.id, {current: newValue});
                }
            }
        }
    }
}

export class SelectStream<I> extends Stream {
    init: (()=>I)|(()=>Promise<I>);
    varName: VarName;
    updaters: Array<(acc:I, v: any) => I>;
    constructor(init:(()=>I)|(()=>Promise<I>), varName:VarName, updaters:Array<(acc:I, v: any) => I>, isBehavior: boolean) {
        super(selectType, isBehavior);
        this.init = init;
        this.varName = varName;
        this.updaters = updaters;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        const scratch = state.scratch.get(id);
        state.streams.set(id, this);
        if (scratch) {
            const resolving = (scratch as any).resolving;
            if (resolving === true || typeof resolving !== "boolean") {
                return this;
            }
        }
        const initValue = this.init();

        if (initValue && typeof initValue === "object" && (initValue as any).then) {
            state.scratch.set(id, {resolving: true});
            (initValue as any).then((value:any) => {
                state.requestAlarm(1);
                state.scheduleAlarm();
                state.setResolved(id, {value, time: state.time});
                state.scratch.set(id, {current: value});
            });
            return this;
        }

        state.setResolved(id, {value: initValue, time: state.time});
        state.scratch.set(id, {current: initValue});
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        type ArgTypes = Parameters<typeof this.updaters[0]>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        if (scratch === undefined) {return;}
        if ((scratch as any).resolving) {return;}
        const inputIndex = node.inputs.indexOf(this.varName);
        const orRecord = inputArray[inputIndex];
        if (orRecord !== undefined) {
            const newValue = this.updaters[orRecord.index](scratch.current, orRecord.value);
            if (newValue !== undefined) {
                // this check feels like unfortunate.
                if (newValue !== null && (newValue as unknown as Promise<any>).then) {
                    (newValue as unknown as Promise<any>).then((value:any) => {
                        state.requestAlarm(1);
                        state.scheduleAlarm();
                        state.setResolved(node.id, {value, time: state.time});
                        state.scratch.set(node.id, {current: value});
                    });
                } else {
                    state.setResolved(node.id, {value: newValue, time: state.time});
                    state.scratch.set(node.id, {current: newValue});
                }
            }
        }
    }
}

export class GatherStream extends Stream {
    regexp: RegExp;
    constructor(regexp:string, isBehavior: boolean) {
        super(gatherType, isBehavior);
        this.regexp = new RegExp(regexp);
    }

    created(_state:ProgramStateType, _id:VarName):Stream {
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        if (state.equals(inputArray, lastInputArray)) {
            return;
        }
        const inputs = node.inputs;
        const validInputNames:Array<string> = [];
        const validInputs = [];

        let hasPromise = false;
        for (let i = 0; i < inputs.length; i++) {
            const v = inputArray[i];
            if (v !== undefined) {
                validInputNames.push(inputs[i]);
                validInputs.push(v);
                if (v !== null && v.then) {
                    hasPromise = true;
                }
            }
        }
        if (hasPromise) {
            Promise.all(validInputs).then((values:Array<any>) => {
                const result:any = {};
                for (let i = 0; i < validInputNames.length; i++) {
                    result[validInputNames[i]] = values[i];
                }
                state.setResolved(node.id, {value: result, time: state.time});
            });
        } else {
            const result:any = {};
            for (let i = 0; i < validInputNames.length; i++) {
                result[validInputNames[i]] = validInputs[i];
            }
            state.setResolved(node.id, {value: result, time: state.time});
        }
    }
}

export class ResolvePart extends Stream {
    promise: Promise<any>;
    indices: Array<number|string>;
    resolved: boolean;
    object: any;
    constructor(object:Array<any>|any, isBehavior:boolean) {
        super(resolvePartType, isBehavior);
        this.object = object;
        if (Array.isArray(this.object)) {
            const array:Array<any> = this.object;
            const indices = [...Array(array.length).keys()].filter((i) => {
                const elem = this.object[i];
                return typeof elem === "object" && elem !== null && elem.then;
            });
            const promises = indices.map((i) => array[i]);
            this.promise = Promise.all(promises);
            this.indices = indices;
        } else {
            const keys = Object.keys(this.object).filter((k) => {
                const elem = this.object[k];
                return typeof elem === "object" && elem !== null && elem.then;
            });
            const promises = keys.map((k) => this.object[k]);
            this.promise = Promise.all(promises);
            this.indices = keys;
        }
        this.resolved = false;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (!this.resolved) {
            this.promise.then((values:Array<Promise<any>>) => {
                const wasResolved = state.resolved.get(id)?.value;
                if (!wasResolved) {
                    this.resolved = true;
                    state.requestAlarm(1);
                    state.scheduleAlarm();
                    if (Array.isArray(this.object)) {
                        const result = [...this.object];
                        const indices = this.indices as Array<number>;
                        for (let i of indices) {
                            result[indices[i]] = values[i];
                        }
                        state.setResolved(id, {value: result, time: state.time});
                        return result;
                    } else {
                        const result = {...this.object};
                        const indices = this.indices as Array<string>
                        for (let i = 0; i < indices.length; i++) {
                           result[indices[i]] = values[i];
                        }
                        state.setResolved(id, {value: result, time: state.time});
                        return result;
                    }
                }
            });
        }
        return this;
    }
}

export class GeneratorNextEvent<T> extends Stream {
    promise: Promise<IteratorResult<T>>;
    generator: GeneratorWithFlag<T>;
    constructor(generator:GeneratorWithFlag<T>) {
        super(generatorNextType, false);
        const promise = generator.next();
        this.promise = promise;
        this.generator = generator;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (this.generator.done) {return this;}
        const promise = this.promise;

        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                state.requestAlarm(1);
                state.scheduleAlarm();
                state.setResolved(id, {value, time: state.time});
            }
        });
        return this;
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        const value = state.resolved.get(varName)?.value;
        if (value !== undefined) {
            if (!value.done) {
                if (!this.generator.done) {
                    const promise = this.generator.next();
                    promise.then((value:any) => {
                        if (this.generator.done) {return;}
                        const wasResolved = state.resolved.get(varName)?.value;
                        if (!wasResolved) {
                            state.requestAlarm(1);
                            state.scheduleAlarm();
                            state.setResolved(varName, {value, time: state.time});
                        }
                    });
                    this.promise = promise;
                }
            } else {
                this.generator.done = true;
            }
            super.conclude(state, varName);
            return varName;         
        }
        super.conclude(state, varName);
        return;
    }
}
