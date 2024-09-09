
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
export const isBehaviorKey = Symbol("isBehavior");

export const eventType = "EventType";
export const delayType = "DelayType";
export const timerType = "TimerType";
export const collectType = "CollectType";
export const promiseType = "PromiseType";
export const behaviorType = "BehaviorType";
export const onceType = "OnceType";
export const orType = "OrType";
export const sendType = "SendType";
export const receiverType = "ReceiverType";
export const changeType = "ChangeType";
export const generatorNextType = "GeneratorNextType";

export type EventType = 
    typeof eventType |
    typeof delayType |
    typeof timerType |
    typeof collectType |
    typeof promiseType |
    typeof behaviorType |
    typeof onceType |
    typeof orType |
    typeof sendType |
    typeof receiverType |
    typeof changeType |
    typeof generatorNextType;

export interface ProgramStateType {
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
    app?: any;
    noTicking: boolean;
    ready(node: ScriptCell):boolean;
    defaultReady(node: ScriptCell):boolean;
    spliceDelayedQueued(record:QueueRecord, t:number):any;
    getEventValue(record:QueueRecord, _t:number):any;
    baseVarName(varName:VarName):VarName;
    setResolved(varName:VarName, value:any):void;
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
    [typeKey]: EventType;
    [isBehaviorKey]: boolean;
    constructor(type:EventType, isBehavior:boolean) {
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

    conclude(_state:ProgramStateType, _varName:VarName):VarName|undefined {
        return;
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
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
        }
        const inputIndex = 0; // node.inputs.indexOf(this.varName);
        const myInput = inputArray[inputIndex];

        const doIt = (this[isBehaviorKey] && myInput !== undefined && myInput !== lastInputArray?.[inputIndex])
            || (!this[isBehaviorKey] && myInput !== undefined);
        if (doIt) {
            const scratch:QueueRecord = state.scratch.get(node.id) as QueueRecord;
                scratch.queue.push({time: state.time + this.delay, value: myInput});
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
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
        return last === undefined || last + interval <= state.time;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const interval = this.interval;
        const logicalTrigger = interval * Math.floor(state.time / interval);
        state.setResolved(node.id, {value: logicalTrigger, time: state.time});
        state.scratch.set(node.id, logicalTrigger);
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
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
                state.setResolved(id, {value, time: state.time});
            }
        });
        return this;
    }
}

export class OrEvent extends Stream {
    varNames: Array<VarName>;
    constructor(varNames:Array<VarName>) {
        super(orType, false);
        this.varNames = varNames;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = inputArray[i];
            if (myInput !== undefined) {
                state.setResolved(node.id, {value: myInput, time: state.time});
                return;
            }
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            // console.log("deleting", varName);
            state.resolved.delete(varName);
            return varName;
        }
        return;
    }
}

export class UserEvent extends Stream {
    record: ValueRecord;
    constructor(record:QueueRecord) {
        super(eventType, false);
        this.record = record;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        let stream = state.streams.get(id) as UserEvent;
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
        const value = state.getEventValue(state.scratch.get(node.id) as QueueRecord, state.time);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
            return;
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
    }
}

export class SendEvent extends Stream {
    constructor() {
        super(sendType, false);
    }
}

export class ReceiverEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(receiverType, false);
        this.value = value;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (this.value !== undefined) {
            state.scratch.set(id, this.value);
        }
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        const value = state.scratch.get(node.id);
        if (value !== undefined) {
            state.setResolved(node.id, {value, time: state.time});
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
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
        super(changeType, false);
        this.value = value;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        state.scratch.set(id, this.value);
        return this;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        const resolved = state.resolved.get(state.baseVarName(node.inputs[0]))?.value;
        if (resolved !== undefined && resolved === state.scratch.get(node.id)) {return false;}
        return state.defaultReady(node);
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        state.setResolved(node.id, {value: this.value, time: state.time});
        state.scratch.set(node.id, inputArray[0]);
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
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
        super(behaviorType, true);
    }
}

export class CollectStream<I, T> extends Stream {
    init: I;
    varName: VarName;
    updater: (acc:I, v: T) => I;
    constructor(init:I, varName:VarName, updater:(acc:I, v: T) => I, isBehavior: boolean) {
        super(collectType, isBehavior);
        this.init = init;
        this.varName = varName;
        this.updater = updater;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (!state.scratch.get(id)) {
            state.streams.set(id, this);
            state.setResolved(id, {value: this.init, time: state.time});
            state.scratch.set(id, {current: this.init});
        }
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, lastInputArray:Array<any>|undefined):void {
        type ArgTypes = Parameters<typeof this.updater>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        const inputIndex = node.inputs.indexOf(this.varName);
        const inputValue = inputArray[inputIndex];
        if (inputValue !== undefined && (!lastInputArray || inputValue !== lastInputArray[inputIndex])) {
            const newValue = this.updater(scratch.current, inputValue);
            if (newValue !== undefined) {
                // this check feels like unfortunate.
                if (newValue !== null && (newValue as unknown as Promise<any>).then) {
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

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
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
                        const wasResolved = state.resolved.get(varName)?.value;
                        if (!wasResolved) {
                            state.setResolved(varName, {value, time: state.time});
                        }
                    });
                    this.promise = promise;
                }
            } else {
                this.generator.done = true;
            }
            state.resolved.delete(varName);      
            return varName;         
        }
        return;
    }
}
