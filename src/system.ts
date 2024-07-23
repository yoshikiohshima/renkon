import { basicSetup, EditorView } from "codemirror"
//import { html, htmlLanguage } from "https://esm.sh/@codemirror/lang-html@v6.4.9"
//import { javascript } from "https://esm.sh/@codemirror/lang-javascript@v6.0.1"
import {setupProgram, newProgramState, evaluator} from "./language";
import {ProgramState} from "./types";
import { getContentFromHTML, loadFile, makeHTMLFromContent, saveFile } from "./load";

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

export function view() {
    const url = new URL(window.location.toString());
    let maybeDoc = url.searchParams.get("doc");
    let semi;
    if (maybeDoc) {
        semi = maybeDoc.indexOf(";");
        if (semi >= 0) {
            maybeDoc = maybeDoc.slice(0, semi);
        }
    }

    const renkon:HTMLElement = document.body.querySelector("#renkon")!;
    const programState = newProgramState(Date.now());
    (window as any).programState = programState;
    let {dock, editorView} = createEditorDock(renkon, programState);
    document.body.appendChild(dock);

    if (myResizeHandler) {
        window.removeEventListener("resize", myResizeHandler);
    }
    myResizeHandler = resizeHandler;
    window.addEventListener("resize", myResizeHandler)

    if (maybeDoc) {
        document.querySelector("#fileName")!.textContent = maybeDoc;
        load(renkon, editorView, programState);
        if (programState.evaluatorRunning === 0) {
            evaluator(programState);
        }
        return;       
    }

    update(renkon, editorView, programState);
    if (programState.evaluatorRunning === 0) {
        evaluator(programState);
    }
}

function createEditorDock(renkon:HTMLElement, programState:ProgramState) {
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
        extensions: [basicSetup, EditorView.lineWrapping],
        parent: editor,
    });
    editorView.dom.style.height = "500px";
    editorView.dom.style.width = "60vw";

    const updateButton = dock.querySelector("#updateButton")! as HTMLButtonElement;
    updateButton.textContent = "Update";
    updateButton.onclick = () => update(renkon, editorView, programState);

    const loadButton = dock.querySelector("#loadButton")! as HTMLButtonElement;
    loadButton.textContent = "Load";
    loadButton.onclick = () => load(renkon, editorView, programState);

    const saveButton = dock.querySelector("#saveButton")! as HTMLButtonElement;
    saveButton.textContent = "Save";
    saveButton.onclick = () => save(renkon, editorView, programState);


    const drawerButton = dock.querySelector("#drawerButton")! as HTMLButtonElement;
    drawerButton.onclick = () => toggleDock(dock as HTMLElement);
    toggleDock(dock as HTMLElement, false);
    return {dock, editorView, updateButton};
}   

function update(renkon:HTMLElement, editorView:EditorView, programState: ProgramState) {
    renkon.innerHTML = editorView.state.doc.toString();
    let scripts = [...renkon.querySelectorAll("script[type='reactive']")] as HTMLScriptElement[];
    let text = scripts.map((s) => s.textContent).filter((s) => s);
    setupProgram(text as string[], programState);
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

function save(_renkon:HTMLElement, editorView:EditorView, _programState:ProgramState) {
    const fileName = document.querySelector("#fileName")!.textContent;
    if (!fileName) {return;}
    const content = editorView.state.doc.toString();
    const html = makeHTMLFromContent(content);
    saveFile(fileName, html);
}

async function load(renkon:HTMLElement, editorView:EditorView, programState:ProgramState) {
    const fileName = document.querySelector("#fileName")!.textContent;
    if (!fileName) {return;}
    const html = await loadFile(fileName);
    const content = getContentFromHTML(html);
    editorView.dispatch({changes: {from: 0, to: editorView.state.doc.length, insert: content}});
    update(renkon, editorView, programState);
}
