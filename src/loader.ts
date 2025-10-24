import { ProgramState } from "./language";

export function loader(programState:ProgramState, docName:string, maybeFetch:(typeof fetch|undefined)) {
    const myFetch = maybeFetch || fetch;

    myFetch(docName).then((resp) => resp.text()).then((result) => {
        const index = result.indexOf("{__codeMap: true, value:");
        let code:Array<[string, string]>;
        if (index < 0) {
            const json = JSON.parse(result);
            if (json.version !== 1) {
                console.log("unknown type of data");
            }
            code = JSON.parse(result).code.values;
        } else {
            let data1 = JSON.parse(result.slice(0, index));
            let windowEnabledMap = new Map();
            if (data1?.windowEnabled?.map?.values) {
                windowEnabledMap = new Map(data1?.windowEnabled?.map?.values);
            }
            let windowTypesMap = new Map();
            if (data1?.windowTypes?.map?.values) {
                windowTypesMap = new Map(data1?.windowTypes?.map?.values);
            }
            const data2 = result.slice(index);
            const array = eval("(" + data2 + ")");
            code = array.value;
            code = code.filter((pair) => (
                !windowEnabledMap.get(pair[0]) ||
                    (windowEnabledMap.get(pair[0]).enabled && windowTypesMap.get(pair[0]) === "code")
            ));
        }
        programState.setupProgram(code.map((pair) => ({blockId: pair[0], code: pair[1]})), docName);
        programState.evaluate(Date.now());
    }).catch((err) => {
        console.error(`${docName} could not be loaded`, err);
    });
}
