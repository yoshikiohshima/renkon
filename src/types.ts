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

export const eventType = "EventType";
export const delayType = "DelayType";
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
    typeof collectType |
    typeof promiseType |
    typeof behaviorType |
    typeof generatorType |
    typeof onceType |
    typeof orType |
    typeof sendType |
    typeof receiverType |
    typeof changeType;

export interface Stream {
    type: EventType,
}

export interface GenericEvent extends Stream {
    cleanup?: (() => void) | null
}

export interface DelayedEvent extends Stream {
    delay: number,
    varName: VarName,
}

export interface PromiseEvent extends Stream {
    promise: Promise<any>
}

export interface OrEvent extends Stream {
    varNames: Array<VarName>;
}

export interface OnceEvent extends Stream {
    value: any;
}

export interface Behavior extends Stream {
}

export interface SendEvent extends Stream {
}

export interface ReceiverEvent extends Stream {
}

export interface CollectStream<I, T> extends Stream {
    init: I,
    updater: (c: I, v: T) => I,
    varName: VarName,
}

export interface GeneratorEvent<T> extends Stream {
    promise: Promise<IteratorResult<T>>,
    generator: AsyncGenerator<T>,
}

export interface ValueRecord {}
export interface SimpleValueRecord extends ValueRecord {
    queue: Array<ResolveRecord>,
    cleanup?: (() => void) | null
}
export interface CollectRecord<I> extends ValueRecord {
    current: I,
}

export interface PromiseRecord extends ValueRecord {
    promise: Promise<any>
}

export interface QueueRecord extends ValueRecord {
    queue: Array<ResolveRecord>
    cleanup?: (() => void) | null
}

export type ProgramState = {
    order: Array<NodeId>;
    nodes: Map<NodeId, ScriptCell>;
    streams: Map<VarName, Stream>;
    scratch: Map<VarName, ValueRecord>;
    resolved: Map<VarName, ResolveRecord>;
    inputArray: Map<NodeId, Array<any>>;
    changeList: Map<VarName, any>,
    time: number;
    startTime: number;
    evaluatorRunning: number;
}
