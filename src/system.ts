import { basicSetup, EditorView } from "codemirror"
//import { html, htmlLanguage } from "https://esm.sh/@codemirror/lang-html@v6.4.9"
//import { javascript } from "https://esm.sh/@codemirror/lang-javascript@v6.0.1"
import {setupProgram, evaluate} from "./language";
import {ProgramState} from "./types";
import { getContentFromHTML, loadFile, makeHTMLFromContent, saveFile } from "./load";

let programState: ProgramState = {
    order: [],
    nodes: new Map(),
    streams: new Map(),
    resolved: new Map(),
    inputArray: new Map(),
    outputs: new Map(),
    time: 0,
}

let evaluatorRunning:number|undefined = undefined;

let myResizeHandler: (() => void) | null;

function resizeHandler() {
    const dock:HTMLElement = document.querySelector("#dock")!;
    if (!dock) {return;}
    const toOpen = dock.classList.contains("opened");
    const width = dock.getBoundingClientRect().width;
    dock.classList.toggle("opened", toOpen);
    if (toOpen) {
        dock.style.left = `${window.innerWidth - width}px`;
    } else {
        dock.style.left = `${window.innerWidth - 80}px`;
    }
}

const pageLoadTime = Date.now();
function evaluator() {
    const now = Date.now();
    evaluatorRunning = window.requestAnimationFrame(evaluator);
    programState.time = now - pageLoadTime;
    evaluate(programState);
}

export function view() {
    const renkon:HTMLElement = document.body.querySelector("#renkon")!;
    let {dock, editorView} = createEditorDock(renkon);
    document.body.appendChild(dock);

    if (myResizeHandler) {
        window.removeEventListener("resize", myResizeHandler);
    }
    myResizeHandler = resizeHandler;
    window.addEventListener("resize", myResizeHandler)

    update(renkon, editorView);
    if (evaluatorRunning === undefined) {
        evaluator();
    }
}

function createEditorDock(renkon:HTMLElement) {
    const div = document.createElement("div");
    div.innerHTML = `
<div id="dock" class="dock">
   <div id="drawerButton">◀️</div>
   <div id="drawerBody">
     <div id="buttonRow">
       <button id="updateButton" class="updateButton button">Update</button>
       <div contentEditable id="fileName"></div>
       <button id="loadButton" class="loadButton button">Load</button>
       <button id="saveButton" class="saveButton button">Save</button>
     </div>
     <div id="editor" class="editor"></div>
  </div>
</div>
`;

    const dock = div.querySelector("#dock")!;
    const editor = dock!.querySelector("#editor")!;

    editor.classList.add("editor");
    const editorView = new EditorView({
        doc: renkon.innerHTML.trim(),
        extensions: [basicSetup],
        parent: editor,
    });
    editorView.dom.style.height = "500px";

    const updateButton = dock.querySelector("#updateButton")! as HTMLButtonElement;
    updateButton.textContent = "Update";
    updateButton.onclick = () => update(renkon, editorView);

    const loadButton = dock.querySelector("#loadButton")! as HTMLButtonElement;
    loadButton.textContent = "Load";
    loadButton.onclick = () => load(renkon, editorView);

    const saveButton = dock.querySelector("#saveButton")! as HTMLButtonElement;
    saveButton.textContent = "Save";
    saveButton.onclick = () => save(renkon, editorView);


    const drawerButton = dock.querySelector("#drawerButton")! as HTMLButtonElement;
    drawerButton.onclick = () => toggleDock(dock as HTMLElement);
    toggleDock(dock as HTMLElement, false);
    return {dock, editorView, updateButton};
}   

function update(renkon:HTMLElement, editorView:EditorView) {
    renkon.innerHTML = editorView.state.doc.toString();
    let scripts = [...renkon.querySelectorAll("script[type='reactive']")];

    setupProgram(scripts as HTMLScriptElement[], programState);
}

function toggleDock(dock:HTMLElement, force?:boolean) {
    const toOpen = force !== undefined ? force : !dock.classList.contains("opened");
    const width = dock.getBoundingClientRect().width;
    dock.classList.toggle("opened", toOpen);
    if (toOpen) {
        dock.style.left = `${window.innerWidth - width}px`;
    } else {
        dock.style.left = `${window.innerWidth - 80}px`;
    }
}

function save(_renkon:HTMLElement, editorView:EditorView) {
    const fileName = document.querySelector("#fileName")!.textContent;
    if (!fileName) {return;}
    const content = editorView.state.doc.toString();
    const html = makeHTMLFromContent(content);
    saveFile(fileName, html);
}

async function load(renkon:HTMLElement, editorView:EditorView) {
    const fileName = document.querySelector("#fileName")!.textContent;
    if (!fileName) {return;}
    const html = await loadFile(fileName);
    const content = getContentFromHTML(html);
    editorView.dispatch({changes: {from: 0, to: editorView.state.doc.length, insert: content}});
    update(renkon, editorView);
}