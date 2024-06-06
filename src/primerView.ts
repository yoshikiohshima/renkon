import { basicSetup, EditorView } from "codemirror"
//import { html, htmlLanguage } from "https://esm.sh/@codemirror/lang-html@v6.4.9"
//import { javascript } from "https://esm.sh/@codemirror/lang-javascript@v6.0.1"
import {setupProgram, evaluate} from "./language";
import {ProgramState} from "./types";

let programState: ProgramState = {
    order: [],
    nodes: new Map(),
    streams: new Map(),
    resolved: new Map(),
    inputArray: new Map(),
    outputs: new Map(),
}

let evaluateTimeout: number | null = null;
let requestEvaluation:() => void = () => {
    if (evaluateTimeout !== null) {return;}
    evaluateTimeout = setTimeout(() => {
        evaluateTimeout = null;
        evaluate(programState, performance.now(), requestEvaluation);
    }, 0);
};

export function primerView(source:HTMLElement) {
    let {dock, editorView, updateButton} = createEditorDock(source.innerHTML.trim());
    document.body.appendChild(dock);
    updateButton.onclick = () => update(source, editorView);
    update(source, editorView);
}

function createEditorDock(initialText:string) {
    const div = document.createElement("div");
    div.innerHTML = `
<div id="dock" class="dock">
   <div id="drawerButton">◀️</div>
   <div id="drawerBody">
     <div id="buttonRow">
       <button id="updateButton" class="updateButton">Update</button>
     </div>
     <div id="editor" class="editor"></div>
  </div>
</div>
`;

    const dock = div.querySelector("#dock")!;
    const editor = dock!.querySelector("#editor")!;

    editor.classList.add("editor");
    const editorView = new EditorView({
        doc: initialText,
        extensions: [basicSetup],
        parent: editor,
    });

    const updateButton = dock.querySelector("#updateButton")! as HTMLButtonElement;
    updateButton.textContent = "Update";

    const drawerButton = dock.querySelector("#drawerButton")! as HTMLButtonElement;
    drawerButton.onclick = () => toggleDock(dock);
    return {dock, editorView, updateButton};
}   

function update(renkon:HTMLElement, editorView:EditorView) {
    renkon.innerHTML = editorView.state.doc.toString();
    let scripts = [...renkon.querySelectorAll("script[type='reactive']")];

    setupProgram(scripts as Array<HTMLScriptElement>, programState);
    evaluate(programState, performance.now(), requestEvaluation);
}

function toggleDock(dock:HTMLElement) {
    dock.classList.toggle("closed", !dock.classList.contains ("closed"));
}