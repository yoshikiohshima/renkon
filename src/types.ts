export type NodeId = string;
export type VarName = string;

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: NodeId,
    inputs: Array<string>,
    forceVars: Array<string>,
    outputs: Array<string>
}

export const eventType = "EventType";
export const delayType = "DelayType";
export const fbyType = "FbyType";
export const promiseType = "PromiseType";
export const behaviorType = "BehaviorType";
export const generatorType = "GeneratorType"

export type EventType = 
    typeof eventType |
    typeof delayType |
    typeof fbyType |
    typeof promiseType |
    typeof behaviorType |
    typeof generatorType;

export type ResolveRecord = {
    value: any,
    time: number
}

export interface Stream {
    type: EventType,
    cleanup?: (() => void) | null, 
}

export interface DelayedEvent extends Stream {
    delay: number,
    varName: VarName,
    queue: Array<{value:any, time:number}>
}

export interface PromiseEvent extends Stream {
    promise: Promise<any>,
}

export interface FbyStream<I, T> extends Stream {
    init: I,
    current: I,
    updater: (c: I, v: T) => I,
    varName: VarName,
}

export interface Behavior extends Stream {
    value: any
}

export interface GeneratorEvent<T> extends Stream {
    promise: IteratorResult<Promise<T>>,
    generator: Iterator<Promise<T>>
}

export type ProgramState = {
    order: Array<NodeId>;
    nodes: Map<NodeId, ScriptCell>;
    streams: Map<VarName, Stream>;
    resolved: Map<VarName, ResolveRecord>;
    inputArray: Map<NodeId, Array<any>>;
    outputs: Map<NodeId, any>;
    time: number;
}

export type ObserveCallback = (notifier:(v:any) => void) => () => void;
