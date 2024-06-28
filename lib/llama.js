//const API_URL = 'http://substrate.home.arpa:8081';
const API_URL = "https://substrate.home.arpa/llama-3-8b-instruct/v1";
//const API_URL = "/mixtral-8x7b-instruct/v1/completions";

export async function test(question) {
    let instruction = `You reply questions in a faithful matter.`;

    // let question = `Here are two entries: "${t}" and "${c}" What is your answer?`;

    const result = await chat_completion(instruction, question);
    return result;
}

async function chat_completion(instruction, question) {
    const n_keep = await tokenize(instruction).then((tokens) => tokens.length);
    const chat = [];
    const slot_id = -1;

    const prompt = format_prompt5(chat, instruction, question);

    const result = await fetch(`${API_URL}/completion`, {
        method: 'POST',
        headers: {
            'Connection': 'keep-alive',
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
            frequency_penalty: 0,
            grammar: "",
            image_data: [],
            mirostat: 0,
            mirostat_eta: 0.1,
            mirostat_tau: 5,
            n_predict: 4006,
            n_probs: 0,
            n_keep,
            presence_penalty: 0,
            prompt,
            temperature: 0.7,
            repeat_last_n: 256,
            repeat_penalty: 1.18,
            cache_prompt: false,
            slot_id,
            stop: ['</s>', 'Llama:', 'User:'],
            stream: false,
            tfs_z: 1,
            top_k: 40,
            top_p: 0.5,
            typical_p: 1,
        })
    })

    console.log(result);
    if (!result.ok) {
        return
    }

    const text = await result.text();

    try {
        let json = JSON.parse(text.trim());
        return json.content;
    } catch (e) {
        console.log(e);
    }
}

function format_prompt5(chat, instruction, question) {
    return `${instruction}\n\nUser: ${question}\n\nLLama:`
}

async function tokenize(content) {
    const result = await fetch(`${API_URL}/tokenize`, {
        method: 'POST',
        body: JSON.stringify({ content })
    })

    if (!result.ok) {
        return []
    }

    return result.json().then((json) => {
        return json.tokens;
    });
}

/* globals fetch */
