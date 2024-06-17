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

export type EventType = 
    typeof eventType | typeof delayType | typeof fbyType | typeof promiseType;

export type ResolveRecord = {
    value: any,
    time: number
}

export interface Event {
    type: EventType,
    cleanup?: (() => void) | null, 
    queue: Array<{value:any, time:number}>
}

export interface DelayedEvent extends Event {
    delay: number,
    varName: VarName,
}

export interface PromiseEvent extends Event {
    promise: Promise<any>,
}

export interface FbyStream<I, T> extends Event {
    init: I,
    current: I,
    updater: (c: I, v: T) => I,
    varName: VarName,
}

export type Stream = Event | DelayedEvent | Promise<any>;

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
