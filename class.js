const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const panR =function(x){return sin(quarterPI*(1+x));}, panL =function(x){return cos(quarterPI*(1+x));}

class ParameterHandler{
    constructor(){
        this.descriptors = {};
    }
    setup(parameters) {
        for (let p of parameters) {
            if (p.ramp) {
                parameterDescriptors.push(p);
                continue;
            }
            this.descriptors[p.name] = p;
            this[p.name] = p.defaultValue;
        }
    }
    change(id, value) {
        let p = this.descriptors[id];
        if(!p)return;
        let clampedValue = clamp(parseFloat(value), p.minValue, p.maxValue);
        this[id] = clampedValue;
        if(p.callback) p.callback(clampedValue);
        if (value == clampedValue) return id + " " + value;
        else return id + " clamped " + clampedValue;
    }
}

class MasterAmp{
    constructor(iniTarget){
        this.setTarget = new SetTarget(0, 0.1, iniTarget);
        this.gain = 0;
        this.preTarget = iniTarget;
        this.preMax = 0;
        this.prePeakL = this.prePeakR = 0;
        this.peakCount = 0;
        this.analyserInterval = round(0.5*Fs);
        this.sqSumL = this.sqSumR = 0;
    }
    change(v){
        this.setTarget.setValue(v);
        this.preTarget = v;
    }
    analyse(l,r,i,fi,processor){
        this.sqSumL += l[i] * l[i];
        this.sqSumR += r[i] * r[i];
        this.prePeakL = max( this.prePeakL, abs(l[i]) );
        this.prePeakR = max( this.prePeakR, abs(r[i]) );
        if(this.peakCount++<this.analyserInterval)return;
        let pl = this.prePeakL;
        let pr = this.prePeakR;
        this.preMax = max(pl, pr, this.preMax);
        let rmsLVal = sqrt(this.sqSumL/this.analyserInterval);
        let rmsRVal = sqrt(this.sqSumR/this.analyserInterval);
        processor.port.postMessage({id:"vu",value:{l:pl,r:pr,max:this.preMax,time:fi/Fs,rmsLVal,rmsRVal}});
        this.sqSumL = this.sqSumR = 0;
        this.prePeakL = this.prePeakR = this.peakCount = 0;
    }
    exec(l,r,i,fi,processor,constParams){
        this.analyse(l,r,i,fi, processor);
        let preMax = max( abs(l[i]), abs(r[i]) ), ma = preMax*this.gain;

        if (ma> 1){
            let target = this.gain/ma;
            if(this.preTarget<target)return;
            this.preTarget = target;
            this.setTarget.setValue(target);

            constParams.change("masterAmp",target);
            processor.port.postMessage(`masterAmp ${target}`);
            processor.port.postMessage({ id: "masterAmp", value: target });
        }

        this.gain = this.setTarget.exec();
        l[i] *= this.gain;
        r[i] *= this.gain;
    }
};

class SetTarget {
    constructor(iniValue = 0, tc = 0.01, iniTargetValue = iniValue) {
        this.v0 = this.gain = iniValue;
        this.v1 = iniTargetValue;
        this.t = 0;
        this.setTC(tc);
    }
    setTC(v) { this.TC = v * Fs; }
    setValue(targetValue) {
        this.v0 = this.gain;
        this.v1 = targetValue;
        this.t = 0;
    }
    exec() {
        this.gain = this.v1 + (this.v0 - this.v1) * exp(-(this.t++ / this.TC));
        return this.gain;
    }
}


class Mixer{
    constructor(numTracks=64, numAux=0){
        this.tracks = [];
        for(let i=0;i<numTracks;i++)this.tracks.push({
            amp:1, pan:0, l:panL(0), r:panR(0),
            aux:[{ amp: 0.2 }]
        });
        this.numAux = numAux;
        this.aux = [];

        for(let i=0;i<numAux;i++){
            this.aux.push({
                amp:1, pan:0, l:panL(0), r:panR(0),
                bufferL: new Array(128).fill(0),
                bufferR: new Array(128).fill(0),
                func: null,
            });
        }
    }
    setTrack(n,pan=0,amp=1, ...auxAmp){
        let trk = this.tracks[n];
        trk.pan = pan;
        trk.amp = amp;
        trk.l = panL(pan) *amp;
        trk.r = panR(pan) *amp;
        for(let i=0, l=auxAmp.length;i<l;i++){
            trk.aux[i].amp = auxAmp[i];
        }
    }
    setAux(n, func){
        this.aux[n].func = func;
    }
    track(n,s,L,R,i){
        let trk =this.tracks[n];
        let outL = s *trk.l;
        let outR = s *trk.r;
        L[i] += outL;
        R[i] += outR;
        for(let j=0,l = this.numAux; j<l; j++){
            this.aux[j].bufferL[i] += outL * trk.aux[j].amp;
            this.aux[j].bufferR[i] += outR * trk.aux[j].amp;
        }
    }
    outputAux(L,R,i){
        for(let j=0,len = this.aux.length; j<len; j++){
            let ax = this.aux[j];
            ax.func(ax.bufferL[i] *ax.l, ax.bufferR[i] *ax.r, L, R, i);
            ax.bufferL[i] = ax.bufferR[i] = 0;
        }
    }
}

class ADSR {// multi trigger, linear
    constructor(a = 0.01, d = 0.1, s = 0.3, r = 0.1) {
        this.inc = this.dDec = this.rDec = this.vol = this.index = 0;
        [this.ai, this.di, this.ri, this.s] = [a * Fs, d * Fs, r * Fs, s];
        this.aTarget = this.dTarget = 0;
        this.isDecaying = false;
        this.isOn = false;
        this.amp = 1;
        this.gate = 0;
    }
    setA(arg) { this.ai = arg * Fs; }
    setD(arg) { this.di = arg * Fs; }
    setR(arg) { this.ri = arg * Fs; }
    setS(arg) { this.s = arg; }
    exec() {
        if (this.isOn) {
            if (!this.isDecaying) {
                if (this.vol < this.aTarget) this.vol = min(this.aTarget, this.vol + this.inc);
                else this.isDecaying = true;
            }
            else this.vol = max(this.dTarget, this.vol - this.dDec);
        }
        else this.vol = max(0, this.vol - this.rDec);
        return this.vol;
    }
    noteOn(amp = 1) {
        this.index = 0;
        this.amp = amp;
        this.inc = amp / this.ai;
        this.dDec = amp * (1 - this.s) / this.di;
        this.rDec = amp * this.s / this.ri;
        this.aTarget = amp;
        this.dTarget = amp * this.s;
        this.isDecaying = false;
        this.isOn = true;
    }
    noteOff() {
        this.isOn = false;
        this.rDec = this.amp * this.vol / this.ri;
    }
    input(gate, amp = 1) {
        if (gate == this.gate) return;
        if (gate) this.noteOn(amp);
        else this.noteOff();
        this.gate = gate;
    }
}

class WaveTableOsc{
    constructor(waveTable,fixedHarms=false){
        this.waveTable = waveTable;
        this.sampleRate = waveTable.sampleRate;
        this.maxHarms = waveTable.maxHarms;
        for(let i=1;i<=this.maxHarms;i*=2){
            waveTable[i].push(waveTable[i][0]);
        }
        this.acc = 0;
        
        if(this.maxHarms==1)fixedHarms = 1;
        if(fixedHarms){
            this.num = fixedHarms;
            this.exec = this.fixed;
        }
    }
    exec(hz){
        let num = clamp( pow(2,floor(log2(nyquistF/hz)) ), 1, this.maxHarms);// TODO:整数マップを作ってパフォーマンス比較
        let source = this.waveTable[num];
        this.acc += hz/Fs;
        let ind = (this.acc * this.sampleRate) % this.sampleRate;
        let x1 = floor(ind), x2 = x1+1, amt = ind-x1;
        let s = lerp(source[x1],source[x2],amt);
        return s;
    }
    fixed(hz){
        let source = this.waveTable[this.num];
        this.acc += hz/Fs;
        let ind = (this.acc * this.sampleRate) % this.sampleRate;
        let x1 = floor(ind), x2 = x1+1, amt = ind-x1;
        let s = lerp(source[x1],source[x2],amt);
        return s;
    }
    static create(waveTable,fixedHarms){let c=new WaveTableOsc(...arguments); return c.exec.bind(c);}
}

class PulseOsc extends WaveTableOsc{
    constructor(table){
        super(table);
    }
    exec(hz, duty=0.25, ratio=0.5){
        let num = clamp( pow(2,floor(log2(nyquistF/hz)) ), 1, this.maxHarms);// TODO:整数マップを作ってパフォーマンス比較
        let source = this.waveTable[num];
        this.acc += hz/Fs;
        
        let ind = (this.acc * this.sampleRate) % this.sampleRate;
        let x1 = floor(ind), x2 = x1+1, amt = ind-x1;
        let s = lerp(source[x1],source[x2],amt);

        let rInd = ((this.acc+duty) * this.sampleRate) % this.sampleRate;
        let rx1 = floor(rInd), rx2 = rx1+1, rAmt = rInd-rx1;
        let rs = lerp(source[rx1],source[rx2],rAmt);
        return s*(1-ratio) -rs*ratio;
    }
    static create(table){let c=new PulseOsc(...arguments); return c.exec.bind(c);}
}


class Filter{
    constructor(fc=1000,type="lp",init=0){
        this.b1 = exp(-twoPI*fc/Fs);
        [this.a0, this.px, this.py] = type=="hp"?[(1+this.b1)/2, init, init]:[1-this.b1, init, init];
    }
    lp(x){ this.py = (this.a0*x) + (this.b1*this.py); return this.py; }
    hp(x){ let t=this; t.py=(t.a0*x) -t.a0*t.px +(t.b1*t.py);  t.px=x; return t.py; }
    static create(fc,type="lp",init){ let f=new Filter(fc,type,init); return f[type].bind(f);}
};

class FilterBq{
    constructor(fc=1000,q=1,type="lp",ini=0){
        [this.fc,this.q,this.y1,this.y2,this.x1,this.x2] = [fc,q,ini,ini,ini,ini];
        this.tpoS = twoPI/Fs;
        this.typeFunc = this[type];
    }
    exec(x,fc=this.fc,q=this.q){
        let t=this, w0= t.tpoS*fc, alpha=sin(w0)/2*q, cosW0=cos(w0);
        t.typeFunc(t, q, alpha, cosW0);
        t.a0=1+alpha; t.a1=-2*cosW0; t.a2=1-alpha; 
        let y = (t.b0/t.a0)*x + (t.b1/t.a0)*t.x1 + (t.b2/t.a0)*t.x2 - (t.a1/t.a0)*t.y1 - (t.a2/t.a0)*t.y2;
        t.x2=t.x1; t.x1=x; t.y2=t.y1; t.y1=y;
        return y;
    }
    lp(   t, q, alpha, cosW0){ t.b0=(1-cosW0)/2; t.b1=1-cosW0;   t.b2= t.b0; }
    hp(   t, q, alpha, cosW0){ t.b0=(1+cosW0)/2; t.b1=-(1+cosW0);t.b2= t.b0; }
    bp(   t, q, alpha, cosW0){ t.b0=q*alpha;     t.b1=0;         t.b2=-t.b0; }
    notch(t, q, alpha, cosW0){ t.b0=1;           t.b1=-2*cosW0;  t.b2=1;     }
    ap(   t, q, alpha, cosW0){ t.b0=1 - alpha;   t.b1=-2*cosW0;  t.b2=1+alpha;}
    static create(fc,q,type,ini){let c=new FilterBq(...arguments); return c.exec.bind(c);}
}


class FeedbackDelay {
    constructor(sec = 0.3, feedGain = 0.7, bufSec = 1) {
        this.feedGain = feedGain;
        this.buffer = new Array(floor(bufSec * Fs)).fill(0);
        this.bLen = this.t = this.buffer.length;
        this.d = round(sec * Fs);
    }
    exec(s) {
        let pre = this.buffer[(this.t - this.d) % this.bLen];
        this.buffer[this.t % this.bLen] = s + pre * this.feedGain;
        this.t++;
        return pre;
    }
    static create(sec, feedGain, bufSec) { let d = new FeedbackDelay(...arguments); return d.exec.bind(d); }
}

class ReverbSchroeder{
    constructor(sec=2){
        const g =t=> 10**(-3*t/sec);
        const t1 = 0.03985, t2 = 0.03610, t3 = 0.03327, t4 = 0.03015;
        this.comb1 = FeedbackDelay.create(t1, g(t1));
        this.comb2 = FeedbackDelay.create(t2, g(t2));
        this.comb3 = FeedbackDelay.create(t3, g(t3));
        this.comb4 = FeedbackDelay.create(t4, g(t4));
        this.all1 = this.AllpassDelay.create(0.00502, 0.7, 1, this);
        this.all2 = this.AllpassDelay.create(0.00173, 0.7, 1, this);
    }
    exec(s){
        let output = this.comb1(s) + this.comb2(s) + this.comb3(s) + this.comb4(s);
        output = this.all1(output);
        output = this.all2(output);
        return  output;
    }
    static create(sec){let c=new ReverbSchroeder(sec);return c.exec.bind(c);}
} // http://www.ari-web.com/service/soft/reverb-2.htm

ReverbSchroeder.prototype.AllpassDelay = class extends FeedbackDelay {
    exec(s) {
        let pre = this.buffer[(this.t - this.d) % this.bLen];
        let ind = this.t % this.bLen;
        this.buffer[ind] = s + pre * this.feedGain;
        this.t++;
        return pre -this.feedGain *this.buffer[ind];
    }
    static create(sec, feedGain, bufSec, parent) { let c = new parent.AllpassDelay(...arguments); return c.exec.bind(c); }
}
export {ParameterHandler, Mixer, MasterAmp, SetTarget, ADSR, Filter, FilterBq, ReverbSchroeder, WaveTableOsc, PulseOsc}