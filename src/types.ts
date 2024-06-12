export type NodeId = string;
export type VarName = string;

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: NodeId,
    inputs: Array<string>,
    outputs: Array<string>
}

export const eventType = Symbol("renkon-event");
export const delayType = Symbol("renkon-delay");

export type EventType = typeof eventType | typeof delayType;

export type ResolveRecord = {
    value: any,
    time: number
}

export interface Event {
    type: EventType,
    promise: Promise<any>, 
    updater: () => void | null;
    cleanup: (() => void) | null, 
    then: (v:any) => any,
    queue: Array<{value:any, time:number}>
}

export interface DelayedEvent {
    type: EventType,
    delay: number,
    queue: Array<{value:any, time:number}>
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
