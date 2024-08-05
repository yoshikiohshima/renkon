// From https://github.com/ggerganov/llama.cpp/blob/master/examples/server/public/completion.js

const paramDefaults = {
    stream: true,
    n_predict: 500,
    temperature: 0.2,
    stop: ["</s>"]
};
  
let generation_settings = null;
  
  
export async function* llama(prompt, params = {}, config = {}) {
  console.log("llama");
    let controller = config.controller;
  
    if (!controller) {
      controller = new AbortController();
    }
  
    const completionParams = { ...paramDefaults, ...params, prompt };
  
    const response = await fetch(config.url || "/completion", {
      method: 'POST',
      body: JSON.stringify(completionParams),
      headers: {
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(params.api_key ? {'Authorization': `Bearer ${params.api_key}`} : {})
      },
      signal: controller.signal,
    });
  
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
  
    let content = "";
    let leftover = ""; // Buffer for partially read lines
  
    try {
      let cont = true;
  
      while (cont) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
  
        // Add any leftover data to the current chunk of data
        const text = leftover + decoder.decode(result.value);
  
        // Check if the last character is a line break
        const endsWithLineBreak = text.endsWith('\n');
  
        // Split the text into lines
        let lines = text.split('\n');
  
        // If the text doesn't end with a line break, then the last line is incomplete
        // Store it in leftover to be added to the next chunk of data
        if (!endsWithLineBreak) {
          leftover = lines.pop();
        } else {
          leftover = ""; // Reset leftover if we have a line break at the end
        }
  
        // Parse all sse events and add them to result
        const regex = /^(\S+):\s(.*)$/gm;
        for (const line of lines) {
          const match = regex.exec(line);
          if (match) {
            result[match[1]] = match[2]
            // since we know this is llama.cpp, let's just decode the json in data
            if (result.data) {
              // part of the OpenAI contract
              if (result.data.startsWith('[DONE]')) {
                cont = false;
                break;
              }
              result.data = JSON.parse(result.data);
              content += result.data.content;
  
              // yield
              yield result;
  
              // if we got a stop token from server, we will break here
              if (result.data.stop) {
                if (result.data.generation_settings) {
                  generation_settings = result.data.generation_settings;
                }
                cont = false;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error("llama error: ", e);
      }
      throw e;
    }
    finally {
      controller.abort();
    }
  
    return content;
}
