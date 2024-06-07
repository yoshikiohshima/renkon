export type NodeId = string;
export type VarName = string;

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: NodeId,
    inputs: Array<string>,
    outputs: Array<string>
}

export const isGenerator = Symbol("renkon-generator");

export type Event = {
    [isGenerator]: boolean, 
    promise: Promise<any>, 
    updater: () => void,
    cleanup: (() => void) | null, 
    then: (v:any) => any
}

export type Stream = Event | Promise<any>;

export type ProgramState = {
    order: Array<NodeId>;
    nodes: Map<NodeId, ScriptCell>;
    streams: Map<VarName, Stream>;
    resolved: Map<Stream, any>;
    inputArray: Map<NodeId, Array<any>>;
    outputs: Map<NodeId, any>
}

export type ObserveCallback = (notifier:(v:any) => void) => () => void;
