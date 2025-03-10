
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

export type EventType = 
    typeof eventType |
    typeof delayType |
    typeof timerType |
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

export interface ProgramStateType {
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
    updated: boolean;
    exports?: Array<string>;
    imports?: Array<string>;
    app?: any;
    noTicking: boolean;
    log:(...values:any) => void;
    programStates: Map<string, ProgramStateType>;
    ready(node: ScriptCell):boolean;
    equals(aArray?:Array<any|undefined>, bArray?:Array<any|undefined>):boolean;
    defaultReady(node: ScriptCell):boolean;
    spliceDelayedQueued(record:QueueRecord, t:number):any;
    getEventValue(record:QueueRecord, _t:number):any;
    getEventValues(record:QueueRecord, _t:number):any;
    baseVarName(varName:VarName):VarName;
    setResolved(varName:VarName, value:any):void;
    updateProgram(scripts:Array<string>):void;
    setLog(func:(...values:any) => void):void;
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

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        // this after all was needed...
        // When there is an event that is either have the value of undefined or the same value,
        // the inputArray for a node that depends on that event has to be cleared.
        const inputArray = state.inputArray.get(varName);
        const inputs = state.nodes.get(varName)!.inputs;
        if (!inputArray || !inputs) {return;}
        for (let i = 0; i < inputs.length; i++) {
            const resolved = state.resolved.get(inputs[i]);
            if (resolved === undefined) {
                inputArray[i] = undefined;
            }
        }
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
        super.conclude(state, varName);
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
        super.conclude(state, varName);
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
    useIndex:boolean;
    constructor(varNames:Array<VarName>, useIndex:boolean) {
        super(orType, false);
        this.varNames = varNames;
        this.useIndex = useIndex;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        for (let i = 0; i < node.inputs.length; i++) {
            const myInput = inputArray[i];
            if (myInput !== undefined) {
                if (this.useIndex) {
                    state.setResolved(node.id, {value: {index: i, value: myInput}, time: state.time}); 
                } else {
                state.setResolved(node.id, {value: myInput, time: state.time});
                }
                return;
            }
        }
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
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
    queued: boolean;
    constructor(record:QueueRecord, queued?: boolean) {
        super(eventType, false);
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

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
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
        super.conclude(state, varName);
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
        super.conclude(state, varName);
        if (state.resolved.get(varName)?.value !== undefined) {
            // console.log("deleting", varName);
            state.resolved.delete(varName);
            return varName;
        }
        return;
    }
}

export class OnceEvent extends Stream {
    value: any;
    constructor(value:any) {
        super(onceType, false);
        this.value = value;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        state.scratch.set(id, this.value);
        return this;
    }

    ready(node: ScriptCell, state:ProgramStateType):boolean {
        return state.scratch.get(node.id) !== undefined;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, _inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        state.setResolved(node.id, {value: this.value, time: state.time});
    }

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
        state.scratch.delete(varName);
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
    init: I|Promise<I>;
    varName: VarName;
    updater: (acc:I, v: T) => I;
    constructor(init:I|Promise<I>, varName:VarName, updater:(acc:I, v: T) => I, isBehavior: boolean) {
        super(collectType, isBehavior);
        this.init = init;
        this.varName = varName;
        this.updater = updater;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (this.init && typeof this.init === "object" && (this.init as any).then) {
            (this.init as any).then((value:any) => {
                state.streams.set(id, this);
                this.init = value;
                state.setResolved(id, {value, time: state.time});
                state.scratch.set(id, {current: this.init});
            });
            return this;
        }
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
        if (!scratch) {return;}
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
        super.conclude(state, varName);
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
    }
}

export class SelectStream<I> extends Stream {
    init: I|Promise<I>;
    varName: VarName;
    updaters: Array<(acc:I, v: any) => I>;
    constructor(init:I|Promise<I>, varName:VarName, updaters:Array<(acc:I, v: any) => I>, isBehavior: boolean) {
        super(selectType, isBehavior);
        this.init = init;
        this.varName = varName;
        this.updaters = updaters;
    }

    created(state:ProgramStateType, id:VarName):Stream {
        if (this.init && typeof this.init === "object" && (this.init as any).then) {
            (this.init as any).then((value:any) => {
                state.streams.set(id, this);
                this.init = value;
                state.setResolved(id, {value, time: state.time});
                state.scratch.set(id, {current: this.init});
            });
            return this;
        }
        if (!state.scratch.get(id)) {
            state.streams.set(id, this);
            state.setResolved(id, {value: this.init, time: state.time});
            state.scratch.set(id, {current: this.init});
        }
        return this;
    }

    evaluate(state:ProgramStateType, node: ScriptCell, inputArray:Array<any>, _lastInputArray:Array<any>|undefined):void {
        type ArgTypes = Parameters<typeof this.updaters[0]>;
        const scratch = state.scratch.get(node.id) as CollectRecord<ArgTypes[0]>;
        if (scratch === undefined) {return;}
        const inputIndex = node.inputs.indexOf(this.varName);
        const orRecord = inputArray[inputIndex];
        if (orRecord !== undefined) {
            const newValue = this.updaters[orRecord.index](scratch.current, orRecord.value);
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
        super.conclude(state, varName);
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
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

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
        if (this[isBehaviorKey]) {return;}
        if (state.resolved.get(varName)?.value !== undefined) {
            state.resolved.delete(varName);
            return varName;
        }
        return;
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

    conclude(state:ProgramStateType, varName:VarName):VarName|undefined {
        super.conclude(state, varName);
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
        super.conclude(state, varName);
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
