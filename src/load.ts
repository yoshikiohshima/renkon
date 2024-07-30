const baseURL = "http://localhost:8000/";

export function loadFile(fileName:string) {
  const fetchName = fileName.startsWith("http") ? fileName : baseURL + fileName;
  return fetch(fetchName).then((resp) => resp.text());
}

export function saveFile(fileName:string, content:string) {
  return fetch(baseURL + fileName, {
    method: "POST",
    mode: "no-cors",
    cache: "no-cache",
    credentials: "same-origin",
    headers: {
      "Content-Type": "text/html",
    },
    body: content
  });
}

export function getContentFromHTML(text:string) {
  const div = document.createElement("div");
  div.innerHTML = text;
  const renkon = div.querySelector("#renkon");
  if (!renkon) {
    return "";
  }
  return renkon.innerHTML;
}

export function makeHTMLFromContent(text:string) {
  const header = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8"> 
    <link id="style" rel="stylesheet" href="./src/style.css" />
  </head>
  <body>
`;

  const footer = `
  <script type="module">
  import("./src/main.js").then((mod) => mod.view());
    </script>
  </body>
</html>`;

  return header + text + footer;
}
