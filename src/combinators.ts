export type NodeId = string;
export type VarName = string;

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: NodeId,
    inputs: Array<VarName>,
    forceVars: Array<VarName>,
    outputs: VarName
}

export type ResolveRecord = {
    value: any,
    time: number
}

export type ReadyFunction = (node: ScriptCell, state: ProgramState) => boolean;

export const eventType = "EventType";
export const delayType = "DelayType";
export const timerType = "TimerType";
export const collectType = "CollectType";
export const promiseType = "PromiseType";
export const behaviorType = "BehaviorType";
export const generatorType = "GeneratorType";
export const onceType = "OnceType";
export const orType = "OrType";
export const sendType = "SendType";
export const receiverType = "ReceiveType";
export const changeType = "ChangeType";

export type EventType = 
    typeof eventType |
    typeof delayType |
    typeof timerType |
    typeof collectType |
    typeof promiseType |
    typeof behaviorType |
    typeof generatorType |
    typeof onceType |
    typeof orType |
    typeof sendType |
    typeof receiverType |
    typeof changeType;

export function baseVarName(varName:VarName) {
    return varName[0] !== "$" ? varName : varName.slice(1);
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

export class ProgramState {
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
    constructor(startTime:number) {
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
}

export class Stream {
    _streamType: EventType;
    constructor(type:EventType) {
        this._streamType = type;
    }

    created(_state:ProgramState, _id:VarName):[Stream, boolean] {
        return [this, true]
    }

    ready(node: ScriptCell, state:ProgramState, _defaultReady:ReadyFunction):boolean {
        for (const inputName of node.inputs) {
            const varName = baseVarName(inputName);
            const resolved = state.resolved.get(varName)?.value;
            if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
        }
        return true;
    }

    evaluate(_state:ProgramState, _node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        return false;
    }
}

export class DelayedEvent extends Stream {
    delay: number;
    varName: VarName;
    constructor(delay :number, varName: VarName) {
        super(delayType);
        this.delay = delay;
        this.varName = varName;
    }

    ready(node: ScriptCell, state:ProgramState, defaultReady:ReadyFunction):boolean {
        const output = node.outputs;
        const scratch:QueueRecord = state.scratch.get(output) as QueueRecord;
        if (scratch?.queue.length > 0) {return true;}
        return defaultReady(node, state);
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        let updated = false;
        if (!state.scratch.get(id)) {
            state.scratch.set(id, {queue: []});
            updated = true;
        }
        return [this, updated];
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        const value = state.spliceDelayedQueued(state.scratch.get(node.id) as QueueRecord, state.time);
        let updated = false;
        if (value !== undefined) {
            updated = true;
            state.resolved.set(node.id, {value, time: state.time});
        }
        const inputIndex = 0; // node.inputs.indexOf(this.varName);
        const myInput = inputArray[inputIndex];
        if (myInput !== undefined) {
            const scratch:QueueRecord = state.scratch.get(node.id) as QueueRecord;
            scratch.queue.push({time: state.time + this.delay, value: myInput});
        }
        return updated;
    }
}

export class TimerEvent extends Stream {
    interval: number;
    constructor(interval:number) {
        super(timerType);
        this.interval = interval;
    }

    created(_state:ProgramState, _id:VarName):[Stream, boolean] {
        return [this, true];
    }

    ready(node: ScriptCell, state:ProgramState, _defaultRead:ReadyFunction):boolean {
        const output = node.outputs;
        const last = state.scratch.get(output) as number;
        const interval = this.interval;
        return last === undefined || last + interval < state.time;
    }

    evaluate(state:ProgramState, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        const interval = this.interval;
        const logicalTrigger = interval * Math.floor(state.time / interval);
        state.resolved.set(node.id, {value: logicalTrigger, time: state.time});
        state.scratch.set(node.id, logicalTrigger);
        return true;
    }
}

export class PromiseEvent<T> extends Stream {
    promise:Promise<T>;
    constructor(promise:Promise<T>) {
        super(promiseType);
        this.promise = promise;
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        const oldPromise = (state.scratch.get(id) as PromiseRecord)?.promise;
        const promise = this.promise;
        let updated = false;
        if (oldPromise && promise !== oldPromise) {
            state.resolved.delete(id);
            updated = true;
        }
        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                state.scratch.set(id, {promise});
                state.resolved.set(id, {value, time: state.time});
            }
        });
        return [this, updated];
    }
}

export class OrEvent extends Stream {
    varNames: Array<VarName>;
    constructor(varNames:Array<VarName>) {
        super(orType);
        this.varNames = varNames;
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = inputArray[i];
            if (myInput !== undefined) {
                state.resolved.set(node.id, {value: myInput, time: state.time});
                return true;
            }
        }
        return false;
    }
}

export class UserEvent extends Stream {
    cleanup?: (() => void);
    record: ValueRecord;
    constructor(record:QueueRecord) {
        super(eventType);
        this.cleanup = record.cleanup;
        this.record = record;
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        let stream = state.streams.get(id) as UserEvent;
        if (!stream) {
            state.scratch.set(id, this.record);
            stream = this;
        }
        return [stream, true];
    }

    evaluate(state:ProgramState, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        const value = state.getEventValue(state.scratch.get(node.id) as QueueRecord, state.time);
        if (value !== undefined) {
            state.resolved.set(node.id, {value, time: state.time});
            return true;
        }
        return false;
    }
}

export class SendEvent extends Stream {
    constructor() {
        super(sendType);
    }
}

export class ReceiverEvent extends Stream {
    constructor() {
        // For now it is okay to be an event type
        super(eventType);
    }
}

export class ChangeEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(changeType);
        this.value = value;
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        state.scratch.set(id, this.value);
        return [this, true];
    }

    ready(node: ScriptCell, state:ProgramState, defaultReady:ReadyFunction):boolean {
        const resolved = state.resolved.get(baseVarName(node.inputs[0]))?.value;
        if (resolved !== undefined && resolved === state.scratch.get(node.id)) {return false;}
        return defaultReady(node, state);
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):boolean {
        state.resolved.set(node.id, {value: this.value, time: state.time});
        state.scratch.set(node.id, inputArray[0]);
        return true;
    }
}

export class Behavior extends Stream {
    constructor() {
        super(behaviorType);
    }
}

export class CollectStream<I, T> extends Stream {
    init: I;
    varName: VarName;
    updater: (acc:I, v: T) => I;
    constructor(init:I, varName:VarName, updater:(acc:I, v: T) => I) {
        super(collectType);
        this.init = init;
        this.varName = varName;
        this.updater = updater;
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        let updated = false;
        if (!state.scratch.get(id)) {
            state.streams.set(id, this);
            state.resolved.set(id, {value: this.init, time: state.time});
            state.scratch.set(id, {current: this.init});
            updated = true;
        }
        return [this, updated]
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):boolean {
        type ArgTypes = Parameters<typeof this.updater>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        const inputIndex = node.inputs.indexOf(this.varName);
        const inputValue = inputArray[inputIndex];
        if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
            const value = this.updater(scratch.current, inputValue);
            if (value !== undefined) {
                state.resolved.set(node.id, {value, time: state.time});
                state.scratch.set(node.id, {current: value});
                return true;
            }
        }
        return false;
    }
}

export class GeneratorEvent<T> extends Stream {
    promise: Promise<IteratorResult<T>>;
    generator: AsyncGenerator<T>;
    constructor(promise:Promise<IteratorResult<T>>, generator:AsyncGenerator<T>) {
        super(generatorType);
        this.promise = promise;
        this.generator = generator;
    }

    created(state:ProgramState, id:VarName):[Stream, boolean] {
        const promise = this.promise;
        let updated = false;
        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                updated = true;
                state.resolved.set(id, {value, time: state.time});
            }
        });
        return [this, updated]
    }
}
