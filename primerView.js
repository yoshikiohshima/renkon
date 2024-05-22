import { basicSetup, EditorView } from "https://esm.sh/codemirror@v6.0.1"
//import { html, htmlLanguage } from "https://esm.sh/@codemirror/lang-html@v6.4.9"
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@v6.0.1"

const viewForEditor = new Map();

export function primerView(dom) {
    let scenes = dom.querySelectorAll("scene");

    let galley = document.createElement("div");
    galley.classList.add("galley");
    let galleyChildren = galleyView(scenes);
    galleyChildren.forEach((c) => galley.appendChild(c));
    
    let editor = createEditor(dom);
    viewForEditor.set(editor, galley);

    let container = document.createElement("div");
    container.classList.add("topContainer");
    container.appendChild(galley);
    container.appendChild(editor);
    return container;
}

export function galleyView(scenes) {
    let elems = [...scenes].map((scene) => {
        let elem = document.createElement("div");

        let duration = scene.getAttribute("duration");
        let background = scene.getAttribute("background");
        let fills = scene.querySelectorAll("fill");
        fills = [...fills];

        elem.style.width = "960px";
        elem.style.height = "960px";
        elem.style.transformOrigin = "0 0";
        
        if (background) {
            elem.style.background = `url(${background})`;
            elem.style.backgroundSize = `contain`;
            elem.style.backgroundRepeat = `no-repeat`;
        }

        fills.forEach((fill) => {
            let width = parseFloat(fill.getAttribute("width"));
            if (Number.isNaN(width)) {width = 960;}
            let height = parseFloat(fill.getAttribute("height"));
            if (Number.isNaN(height)) {height = 960;}
            let quad = JSON.parse(fill.getAttribute("quad"));
            let transform = matrix3d(
                [[0, 0], [width, 0], [width, height], [0, height]],
                quad
            )

            let clone = createSurface(width, height);
            
            clone.style.transform = transform;
            elem.appendChild(clone);
        })

        let rest = [...scene.childNodes].filter((elem) => {
            return elem.localName !== "screen";
        });
        let clones = rest.map((r) => r.cloneNode(true));
        clones.forEach((c) => elem.appendChild(c));

        return elem;
    });
    let slider = document.createElement("input");
    slider.type = "range";
    slider.classList.add("timeSlider");
    let buttons = playButtons();
    return [...elems, slider, buttons];
}

function playButtons() {
    const elem = document.createElement("div");
    elem.innerHTML = `<div style="margin-left: 0.4em; margin-top: 1em;">
    <button id="playPause" name="b" type="button" style="width: 2em; font-size: 1.5em; padding-top: 0.2em; margin-right: 0.4em;">⏵</button>
    <button id="forward" type="button" style="font-size: 1.5em; padding-top: 0.2em;">⏮</button>
    <button id="backward type="button" style="font-size: 1.5em; padding-top: 0.2em;">⏭</button>
    <output id="readout" name="o" style="margin-left: 0.4em;">0:00 / 0:00</output>
    </div>`;
    return elem;
}

function createSurface(width, height) {
    const composited = document.createElement('div')
    composited.style.backgroundColor = 'black'
    composited.style.position = 'relative'
    composited.style.top = '0'
    composited.style.left = '0'
    composited.style.transformOrigin = '0 0'
    const iframe = document.createElement('iframe')
    iframe.width = width
    iframe.height = height
    iframe.style.margin = '0'
    composited.style.width = width
    composited.style.height = height
    composited.appendChild(iframe)
    return composited;
}

function createEditor(dom) {
    const editor = document.createElement("div");
    editor.classList.add("editor");
    const editorView = new EditorView({
        doc: dom.innerHTML.trim(),
        extensions: [basicSetup],
        parent: editor,
    });
    let button = document.createElement("button");
    button.classList.add("updateButton");
    button.textContent = "Update";
    button.onclick = () => update(editorView);
    editor.appendChild(button);
    return editor;
}

function update(editorView) {
    let editorDiv = editorView.dom.parentNode;
    let galley = viewForEditor.get(editorDiv);
    const div = document.createElement("div")
    div.innerHTML = editorView.state.doc.toString();
    let scenes = div.querySelectorAll("scene");
    let newGalleyChildren = galleyView(scenes);
    while (galley.lastChild) {
        galley.lastChild.remove();
    }
    newGalleyChildren.forEach((c) => galley.appendChild(c));
}

function matrix3d (originalPos, targetPos) {
    let H, from, i, j, p, to;
    from = (function() {
        let _i, _len, _results;
        _results = [];
        for (_i = 0, _len = originalPos.length; _i < _len; _i++) {
            p = originalPos[_i];
            _results.push({
                x: p[0] - originalPos[0][0],
                y: p[1] - originalPos[0][1]
            });
        }
        return _results;
    })();
    to = (function() {
        let _i, _len, _results;
        _results = [];
        for (_i = 0, _len = targetPos.length; _i < _len; _i++) {
            p = targetPos[_i];
            _results.push({
                x: p[0] - originalPos[0][0],
                y: p[1] - originalPos[0][1]
            });
        }
        return _results;
    })();
    H = getTransform(from, to);
    return "matrix3d(" + (((function() {
        let _i, _results;
        _results = [];
        for (i = _i = 0; _i < 4; i = ++_i) {
            _results.push((function() {
                let _j, _results1;
                _results1 = [];
                for (j = _j = 0; _j < 4; j = ++_j) {
                    _results1.push(H[j][i].toFixed(20));
                }
                return _results1;
            })());
        }
        return _results;
    })()).join(',')) + ")";
}

function getTransform(from, to) {
    let A, H, b, h, i, k_i, lhs, rhs, _i, _j, _k, _ref;
    console.assert((from.length === (_ref = to.length) && _ref === 4));
    A = [];
    for (i = _i = 0; _i < 4; i = ++_i) {
        A.push([from[i].x, from[i].y, 1, 0, 0, 0, -from[i].x * to[i].x, -from[i].y * to[i].x]);
        A.push([0, 0, 0, from[i].x, from[i].y, 1, -from[i].x * to[i].y, -from[i].y * to[i].y]);
    }
    b = [];
    for (i = _j = 0; _j < 4; i = ++_j) {
        b.push(to[i].x);
        b.push(to[i].y);
    }
    h = numeric.solve(A, b);
    H = [[h[0], h[1], 0, h[2]], [h[3], h[4], 0, h[5]], [0, 0, 1, 0], [h[6], h[7], 0, 1]];
    for (i = _k = 0; _k < 4; i = ++_k) {
        lhs = numeric.dot(H, [from[i].x, from[i].y, 0, 1]);
        k_i = lhs[3];
        rhs = numeric.dot(k_i, [to[i].x, to[i].y, 0, 1]);
        console.assert(numeric.norm2(numeric.sub(lhs, rhs)) < 1e-9, "Not equal:", lhs, rhs);
    }
    return H;
}

/* globals numeric */
