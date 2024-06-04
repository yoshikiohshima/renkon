export type NodeId = string;
export type VarName = string;

export type ScriptCell = {
    code: string,
    body: (...args: any[]) => Array<any>,
    id: string,
    inputs: Array<string>,
    outputs: Array<string>
}

export type ProgramState = {
    order: Array<NodeId>;
    nodes: Map<NodeId, ScriptCell>;
    promises: Map<VarName, Promise<any>>;
    resolved: Map<Promise<any>, any>;
    inputArray: Map<NodeId, Array<any>>;
    outputs: Map<NodeId, any>
}
