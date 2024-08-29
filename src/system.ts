import { basicSetup, EditorView } from "codemirror";

//import { html, htmlLanguage } from "https://esm.sh/@codemirror/lang-html@v6.4.9"
//import { javascript } from "https://esm.sh/@codemirror/lang-javascript@v6.0.1"
import {ProgramState} from "./language";
import { getContentFromHTML, loadFile, makeHTMLFromContent, saveFile } from "./load";

let myResizeHandler: (() => void) | null;

const css = `html, body, #renkon {
    height: 100%;
}
body {
    margin: 0px;
}

.dock {
    position: fixed;
    top: 300px;
    left: 0px;
    display: flex;
    box-shadow: 10px 10px 5px #4d4d4d, -10px -10px 5px #dddddd;
    transition: left 0.5s;
    background-color: white;
}

.dock .editor {
    flex-grow: 1;
    margin: 0px 20px 0px 20px;
    background-color: #ffffff;
    border: 1px solid black;
}

.dock #buttonRow {
    display: flex;
}

.dock #drawerButton {
    align-self: center;
    padding: 40px 8px 40px 8px;
}

.dock #updateButton {
    margin-left: 40px;
}

.dock #fileName {
    border: 1px black solid;
    min-width: 160px;
    margin: 10px 10px 10px 10px;
}

.dock .button {
    margin: 10px 0px 10px 0px;
}
`;

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

export function view(optApp?:any) {
    const url = new URL(window.location.toString());
    let maybeDoc = url.searchParams.get("doc");
    let semi;
    if (maybeDoc) {
        semi = maybeDoc.indexOf(";");
        if (semi >= 0) {
            maybeDoc = maybeDoc.slice(0, semi);
        }
    }

    let hideEditor = url.searchParams.get("hideEditor");

    const renkon:HTMLElement = document.body.querySelector("#renkon")!;
    const programState = new ProgramState(Date.now(), optApp);
    (window as any).programState = programState;
    let {dock, editorView} = createEditorDock(renkon, programState);
    if (hideEditor) {
        (dock as HTMLElement).style.display = "none";
    }
    document.body.appendChild(dock);

    if (myResizeHandler) {
        window.removeEventListener("resize", myResizeHandler);
    }
    myResizeHandler = resizeHandler;
    window.addEventListener("resize", myResizeHandler)

    if (maybeDoc) {
        document.querySelector("#fileName")!.textContent = maybeDoc;
        load(renkon, editorView, programState);
        return;       
    }

    update(renkon, editorView, programState);
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

    if (!document.head.querySelector("#renkon-css")) {
        const style = document.createElement("style");
        style.textContent = css;
        style.id = "renkon-css";
        document.head.appendChild(style);
    };

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
    programState.setupProgram(text as string[]);
    if (programState.evaluatorRunning === 0) {
        programState.evaluator();
    }
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
