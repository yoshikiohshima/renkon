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

export const typeKey = Symbol("typeKey");

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
export const receiverType = "ReceiverType";
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


function defaultReady(node: ScriptCell, state: ProgramState) {
    for (const inputName of node.inputs) {
        const varName = state.baseVarName(inputName);
        const resolved = state.resolved.get(varName)?.value;
        if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
    }
    return true;
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
    updated: boolean;
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
        this.updated = false;
    }

    ready(node: ScriptCell) {
        const output = node.outputs;
        const stream = this.streams.get(output);
    
        if (stream) {
            return stream.ready(node, this);
        }
    
        return defaultReady(node, this);
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

    setResolved(varName:VarName, value:any) {
        this.resolved.set(varName, value);
        this.updated = true;
    }
}

export class Stream {
    [typeKey]: EventType;
    constructor(type:EventType) {
        this[typeKey] = type;
    }

    created(_state:ProgramState, _id:VarName):Stream {
        return this;
    }

    ready(node: ScriptCell, state:ProgramState):boolean {
        for (const inputName of node.inputs) {
            const varName = state.baseVarName(inputName);
            const resolved = state.resolved.get(varName)?.value;
            if (resolved === undefined && !node.forceVars.includes(inputName)) {return false;}
        }
        return true;
    }

    evaluate(_state:ProgramState, _node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        return;
    }

    conclude(_state:ProgramState, _varName:VarName):VarName|undefined {
        return;
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

    ready(node: ScriptCell, state:ProgramState):boolean {
        const output = node.outputs;
        const scratch:QueueRecord = state.scratch.get(output) as QueueRecord;
        if (scratch?.queue.length > 0) {return true;}
        return defaultReady(node, state);
    }

    created(state:ProgramState, id:VarName):Stream {
        if (!state.scratch.get(id)) {
            state.scratch.set(id, {queue: []});
            state.updated = true;
        }
        return this;
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const value = state.spliceDelayedQueued(state.scratch.get(node.id) as QueueRecord, state.time);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
        }
        const inputIndex = 0; // node.inputs.indexOf(this.varName);
        const myInput = inputArray[inputIndex];
        if (myInput !== undefined) {
            const scratch:QueueRecord = state.scratch.get(node.id) as QueueRecord;
            scratch.queue.push({time: state.time + this.delay, value: myInput});
        }
    }
}

export class TimerEvent extends Stream {
    interval: number;
    constructor(interval:number) {
        super(timerType);
        this.interval = interval;
    }

    created(_state:ProgramState, _id:VarName):Stream {
        return this;
    }

    ready(node: ScriptCell, state:ProgramState):boolean {
        const output = node.outputs;
        const last = state.scratch.get(output) as number;
        const interval = this.interval;
        return last === undefined || last + interval < state.time;
    }

    evaluate(state:ProgramState, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const interval = this.interval;
        const logicalTrigger = interval * Math.floor(state.time / interval);
        state.setResolved(node.id, {value: logicalTrigger, time: state.time});
        state.scratch.set(node.id, logicalTrigger);
    }
}

export class PromiseEvent<T> extends Stream {
    promise:Promise<T>;
    constructor(promise:Promise<T>) {
        super(promiseType);
        this.promise = promise;
    }

    created(state:ProgramState, id:VarName):Stream {
        const oldPromise = (state.scratch.get(id) as PromiseRecord)?.promise;
        const promise = this.promise;
        if (oldPromise && promise !== oldPromise) {
            state.resolved.delete(id);
        }
        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                state.scratch.set(id, {promise});
                state.setResolved(id, {value, time: state.time});
            }
        });
        return this;
    }
}

export class OrEvent extends Stream {
    varNames: Array<VarName>;
    constructor(varNames:Array<VarName>) {
        super(orType);
        this.varNames = varNames;
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = inputArray[i];
            if (myInput !== undefined) {
                state.setResolved(node.id, {value: myInput, time: state.time});
                return;
            }
        }
    }

    conclude(state:ProgramState, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            // console.log("deleting", varName);
            state.resolved.delete(varName);
            return varName;
        }
        return;
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

    created(state:ProgramState, id:VarName):Stream {
        let stream = state.streams.get(id) as UserEvent;
        if (!stream) {
            state.scratch.set(id, this.record);
            stream = this;
        }
        return this;
    }

    evaluate(state:ProgramState, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const value = state.getEventValue(state.scratch.get(node.id) as QueueRecord, state.time);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
            return;
        }
    }

    conclude(state:ProgramState, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
    }
}

export class SendEvent extends Stream {
    constructor() {
        super(sendType);
    }
}

export class ReceiverEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(receiverType);
        this.value = value;
    }

    created(state:ProgramState, id:VarName):Stream {
        if (this.value !== undefined) {
            state.scratch.set(id, this.value);
        }
        return this;
    }

    evaluate(state:ProgramState, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const value = state.scratch.get(node.id);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
        }
    }

    conclude(state:ProgramState, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            state.scratch.delete(varName);
            return varName;
        }
        return;
    }
}

export class ChangeEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(changeType);
        this.value = value;
    }

    created(state:ProgramState, id:VarName):Stream {
        state.scratch.set(id, this.value);
        return this;
    }

    ready(node: ScriptCell, state:ProgramState):boolean {
        const resolved = state.resolved.get(state.baseVarName(node.inputs[0]))?.value;
        if (resolved !== undefined && resolved === state.scratch.get(node.id)) {return false;}
        return defaultReady(node, state);
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        state.setResolved(node.id, {value: this.value, time: state.time});
        state.scratch.set(node.id, inputArray[0]);
    }

    conclude(state:ProgramState, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            // console.log("deleting", varName);
            state.resolved.delete(varName);
            return varName;
        }
        return;
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

    created(state:ProgramState, id:VarName):Stream {
        if (!state.scratch.get(id)) {
            state.streams.set(id, this);
            state.setResolved(id, {value: this.init, time: state.time});
            state.scratch.set(id, {current: this.init});
        }
        return this;
    }

    evaluate(state:ProgramState, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        type ArgTypes = Parameters<typeof this.updater>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        const inputIndex = node.inputs.indexOf(this.varName);
        const inputValue = inputArray[inputIndex];
        if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
            const newValue = this.updater(scratch.current, inputValue);
            if (newValue !== undefined) {
                // this check feels like unfortunate.
                if ((newValue as unknown as Promise<any>).then) {
                    (newValue as unknown as Promise<any>).then((value:any) => {
                        state.setResolved(node.id, {value, time: state.time});
                        state.scratch.set(node.id, {current: value});
                    })
                } else {
                    state.setResolved(node.id, {value: newValue, time: state.time});
                    state.scratch.set(node.id, {current: newValue});
                }
            }
        }
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

    created(state:ProgramState, id:VarName):Stream {
        const promise = this.promise;
        promise.then((value:any) => {
            const wasResolved = state.resolved.get(id)?.value;
            if (!wasResolved) {
                state.setResolved(id, {value, time: state.time});
            }
        });
        return this;
    }

    conclude(state:ProgramState, varName:VarName):VarName|undefined {
        const value = state.resolved.get(varName)?.value;
        if (value !== undefined) {
            if (!value.done) {
                const promise = this.generator.next();
                promise.then((value:any) => {
                    const wasResolved = state.resolved.get(varName)?.value;
                    if (!wasResolved) {
                        state.setResolved(varName, {value, time: state.time});
                    }
                });
                this.promise = promise;
            }
            state.resolved.delete(varName);      
            return varName;         
        }
        return;
    }
}
