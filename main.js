Object.getOwnPropertyNames(Math).forEach(p => self[p] = Math[p]);
Number.prototype.step = function (step = 0.5) { let c = 1 / step; return parseInt(this * c) / c; }
Number.prototype.roundStep = function (step = 0.5) { let c = 1 / step; return round(this * c) / c; }
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const gE = id => { return document.getElementById(id) };
const gV = id => { return parseFloat(gE(id).value) };
let info, paramContainers;
let context, processor, wavCreator;
let connecting, exportState = 0, autoStart, local = false, countInit = 0;
let waveTables = {};

const waveTablePromises = ["saw32.dat", "tri32.dat"].map(v => fetchWaveTable(v));
let numScores = 5, cScoreNum = 5;
{
    if (document.location.href.indexOf("127.0.0.1") != -1) local = true;
    let search = new URLSearchParams(window.location.search);
    if (search.get("local") == "false") local = false;
    autoStart = search.get("autoplay") != "false";
    if (search.get("score") !== null) cScoreNum = search.get("score");
}

async function fetchWaveTable(url) {
    return fetch("wavetable/" + url)
        .then(res => res.arrayBuffer())
        .then(buffer => {
            let array = new Float32Array(buffer);
            let sampleRate = array[0], harms = 1;
            let output = waveTables[(url.split(".")[0])] = {};
            for (let i = 1, l = array.length; i < l; i += sampleRate) {
                output[harms] = Array.from(array.slice(i, i + sampleRate));
                harms *= 2;
            }
            output.sampleRate = sampleRate;
            output.maxHarms = harms / 2;
        })
        .catch(informError)
}

window.addEventListener("load", setup);
function setup() {
    info = gE("info");
    paramContainers = gE("param-container");
    for (let i = 1, selectEl = gE("select-score"); i <= numScores; i++) {
        let optEl = document.createElement("option");
        optEl.textContent = i;
        if (i == cScoreNum) optEl.selected = true;
        selectEl.append(optEl);
    }

    analyser.setup();
    setupEvents();
    Promise.all(waveTablePromises).then(init).catch(informError);
}

function informError(e) {
    console.log(e);
    info.textContent = e.type || e;
    throw new Error(e);
}


function setupEvents() {
    gE("init").addEventListener("click", init);
    gE("connect").addEventListener("click", connect);
    gE("export").addEventListener("click", _ => wavCreator.export());
    gE("record").addEventListener("click", _ => wavCreator.record());
    gE("select-score").addEventListener("change", e => {
        for (let o of e.target.children) {
            if (!o.selected) continue;
            cScoreNum = parseInt(o.textContent);
            if (!cScoreNum) cScoreNum = 0;
            init();
        }
    });
}

async function init() {
    if (exportState == 2) return;
    connecting = false;
    if (context) context.close();
    analyser.stop();

    let latencyHint = (++countInit === 1) ? 1 : gV("latency");
    context = new AudioContext({ latencyHint, sampleRate: 44100 });

    await context.audioWorklet.addModule(`worklet/score${cScoreNum}.js`)
        .catch(informError);

    setupWorklet();
    setupProcessor();
    setupWavCreator();

    if (exportState == 1) return;

    gE("latency").value = context.baseLatency;

    if (countInit === 1) {
        if (!autoStart) return;
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}. `
        info.textContent += `press any keys`;
        if (local) connect();
        else {
            window.addEventListener("keydown", autoConnect);
            window.addEventListener("mousemove", autoConnect);
            function autoConnect() {
                window.removeEventListener("keydown", autoConnect);
                window.removeEventListener("mousemove", autoConnect);
                connect();
            }
        }
    }
    else {
        connect();
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}.`;
    }
}

function setupWorklet() {
    paramContainers.innerHTML = "";
    let setupMessenger = new AudioWorkletNode(context, "setupWorklet");
    setupMessenger.onprocessorerror = informError;
    setupMessenger.port.onmessage = e => createParameters(e.data);
    setupMessenger.port.postMessage({ waveTables, });
}

function setupProcessor() {
    processor = new AudioWorkletNode(context, 'processor', { outputChannelCount: [2] });
    processor.onprocessorerror = informError;
    processor.port.onmessage = e => {
        if (typeof e.data == "string") info.textContent = e.data;
        else if (e.data.id == "vu") analyser.writeVu(e.data.value);
        else gE(e.data.id).value = e.data.value;
    }
}

function setupWavCreator() {
    wavCreator = new AudioWorkletNode(context, "wavCreator");
    wavCreator.onprocessorerror = informError;
    let recording = false;
    wavCreator.record = _ => {
        recording = !recording;
        info.textContent = recording ? "recording..." : "creating wav";
        wavCreator.port.postMessage("record");
    }
    wavCreator.export = _ => {
        exportState = 1;
        info.textContent = "wait...";
        init().then(_ => {
            exportState = 2;
            wavCreator.port.postMessage(gV("export-sec"));
        });
    }
    wavCreator.port.onmessage = e => {
        if (typeof e.data == "string") {
            info.textContent = e.data;
            return;
        }
        let blob = new Blob([e.data], { type: "audio/wav" });
        let urlObj = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = urlObj;
        a.textContent = "save wav, " + new Date().toLocaleString();
        a.download = document.title + cScoreNum;// + "----" + new Date().toLocaleString();
        gE("wav-output").insertBefore(a, gE("wav-output").firstChild);
        info.textContent = "wav created";
        exportState = 0;
    }
}

function connect() {
    if (exportState == 2) return;
    connecting = !connecting;
    context[(connecting ? "resume" : "suspend")]();
    processor[(connecting ? "connect" : "disconnect")](context.destination);
    analyser[(connecting ? "init" : "stop")]();
    info.textContent = (connecting ? "connected" : "disconnected");
}

function postMessage(id, value) {
    processor.port.postMessage({ id, value });
}
