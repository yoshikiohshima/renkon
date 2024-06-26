import {matrix3d} from "./matrix";

export function galleyView(scenes:HTMLElement[]) {
    let elems = scenes.map((scene) => {
        let elem = document.createElement("div");

        // let duration = scene.getAttribute("duration");
        let background = scene.getAttribute("background");
        let fills = [...scene.querySelectorAll("fill")];

        elem.style.width = "960px";
        elem.style.height = "960px";
        elem.style.transformOrigin = "0 0";
        
        if (background) {
            elem.style.background = `url(${background})`;
            elem.style.backgroundSize = `contain`;
            elem.style.backgroundRepeat = `no-repeat`;
        }

        fills.forEach((fill) => {
            let width = parseFloat(fill.getAttribute("width")!);
            if (Number.isNaN(width)) {width = 960;}
            let height = parseFloat(fill.getAttribute("height")!);
            if (Number.isNaN(height)) {height = 960;}
            let quad = JSON.parse(fill.getAttribute("quad")!);
            let transform = matrix3d(
                [[0, 0], [width, 0], [width, height], [0, height]],
                quad
            )

            let clone = createSurface(width, height);
            
            clone.style.transform = transform;
            elem.appendChild(clone);
        });

        let rest = [...scene.childNodes].filter((elem) => {
            return (elem as any).localName !== "screen";
        });
        let clones = rest.map((r) => r.cloneNode(true));
        clones.forEach((c) => elem.appendChild(c));

        return elem;
    });

    if (scenes.length === 0) {
        const elem = document.createElement("div");
        elem.classList.add("topLevel");
        return [elem];
    }

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

function createSurface(width:number, height:number) {
    const composited = document.createElement('div')
    composited.style.backgroundColor = 'black'
    composited.style.position = 'relative'
    composited.style.top = '0'
    composited.style.left = '0'
    composited.style.transformOrigin = '0 0'
    const iframe = document.createElement('iframe')
    iframe.width = `${width}`
    iframe.height = `${height}`
    iframe.style.margin = '0'
    composited.style.width = `${width}`
    composited.style.height = `${height}`
    composited.appendChild(iframe)
    return composited;
}