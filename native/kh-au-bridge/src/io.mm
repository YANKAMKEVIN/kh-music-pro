// Pont natif V14b, étape 5 : entrée et sortie de la carte son prises par le natif.
//
// Web Audio ne fait plus que calculer le mixage (contexte sans sortie, setSinkId « none ») ; un AudioWorklet en fin de
// chaîne écrit le son dans un tampon circulaire partagé, que la carte son lit ici. Dans l'autre sens, le micro est écrit
// ici dans un second tampon, qu'un AudioWorklet relit comme une source. Aucun mixage en natif.
//
// Deux horloges : Web Audio, sans sortie, avance sur une horloge logicielle ; la carte son (et le micro, qui peut être un
// autre appareil) sur la sienne. Pour que les tampons ne se vident ni ne débordent, chaque sens garde un niveau cible
// et le natif rééchantillonne très légèrement (rapport 1 ± 0,3 % au plus, interpolation cubique) pour y rester.
//
// Mémoire partagée : en-tête Int32[32] (128 octets), puis tampon de sortie Float32 [2][N], puis tampon d'entrée [2][N].
//   [0] écrit par le worklet de sortie (en échantillons, compteur qui boucle)   [1] lu par le natif
//   [2] écrit par le natif (entrée)                                             [3] lu par le worklet d'entrée
//   [4] niveau cible de l'entrée   [5] débordements de sortie (worklet)   [6] manques d'entrée (worklet)
//   [7] taille N   [8] blocs écrits (worklet de sortie)   [9] blocs lus (worklet d'entrée)   [10] voies d'entrée
#include <node.h>
#include <v8.h>
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <dispatch/dispatch.h>
#include <mach/mach_time.h>
#include <atomic>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

using namespace v8;

namespace {

constexpr int HDR = 32, MAXF = 4096;

inline int32_t ld(int32_t* p) { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
inline void st(int32_t* p, int32_t v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }

// Interpolation cubique (Hermite à 4 points) entre x1 et x2, t dans [0, 1).
inline float hermite(float x0, float x1, float x2, float x3, float t) {
  float c1 = 0.5f * (x2 - x0), c2 = x0 - 2.5f * x1 + 2.f * x2 - 0.5f * x3, c3 = 0.5f * (x3 - x0) + 1.5f * (x1 - x2);
  return ((c3 * t + c2) * t + c1) * t + x1;
}

// Régulateur du niveau d'un tampon : moyenne glissante (~0,5 s), puis proportionnel + intégral → rapport de lecture.
struct Servo {
  double avg = -1, integ = 0, step = 1, target = 256;
  double kp = 1e-5, ki = 1e-6, lim = 0.003;
  double lo = 1e9, hi = -1e9;   // niveaux extrêmes vus (pour le bilan)
  void reset(double t) { avg = -1; integ = 0; step = 1; target = t; lo = 1e9; hi = -1e9; }
  void update(double level, double dt) {
    lo = std::min(lo, level); hi = std::max(hi, level);
    if (avg < 0) avg = level;
    avg += (level - avg) * std::min(1.0, dt / 0.5);
    double err = avg - target;
    integ = std::max(-lim / ki, std::min(lim / ki, integ + err * dt));
    step = 1 + std::max(-lim, std::min(lim, kp * err + ki * integ));
  }
};

struct IO {
  std::shared_ptr<BackingStore> store;
  int32_t* h = nullptr;
  float* outRing[2]{};
  float* inRing[2]{};
  uint32_t N = 8192;
  double sr = 48000, hostHz = 24e6;
  AudioUnit outU = nullptr, inU = nullptr;
  AudioDeviceID outDev = 0, inDev = 0;
  std::string outName, inName;
  int inCh = 1;
  float gain = 1;

  // Sortie : position de lecture (entier qui boucle + fraction).
  uint32_t rInt = 0; double rFrac = 0; bool outOn = false;
  Servo so;
  std::atomic<uint64_t> outCalls{0}, outFrames{0}, outUnder{0}, outStarts{0}, overloads{0};
  uint64_t lastHost = 0; uint32_t lastN = 0; std::atomic<uint64_t> gaps{0}; std::atomic<double> maxGap{0};

  // Entrée : petite file locale des échantillons du micro, relue au rapport du régulateur.
  std::vector<float> fifo[2]; uint64_t fw = 0; double fr = 0; uint32_t wIn = 0; bool inOn = false;
  std::vector<float> inBuf[2]; AudioBufferList* inAbl = nullptr;
  Servo si;
  std::atomic<uint64_t> inCalls{0}, inFrames{0}, inOver{0};

  // Mesure du trajet (même méthode qu'à l'étape 3) : instant du premier échantillon fort qui sort, puis qui revient.
  std::atomic<int> armed{0}; float outThr = 0.1f, inMin = 0.003f, floor = 0;
  std::atomic<double> tOut{0}, tIn{0};
};

std::unique_ptr<IO> io;

AudioObjectPropertyAddress addr(AudioObjectPropertySelector s, AudioObjectPropertyScope sc = kAudioObjectPropertyScopeGlobal) {
  return { s, sc, kAudioObjectPropertyElementMain };
}
UInt32 u32(AudioObjectID o, AudioObjectPropertySelector s, AudioObjectPropertyScope sc = kAudioObjectPropertyScopeGlobal) {
  auto a = addr(s, sc); UInt32 v = 0, sz = 4;
  return AudioObjectGetPropertyData(o, &a, 0, nullptr, &sz, &v) == noErr ? v : 0;
}
std::string devName(AudioDeviceID d) {
  auto a = addr(kAudioObjectPropertyName); CFStringRef n = nullptr; UInt32 sz = sizeof n;
  if (AudioObjectGetPropertyData(d, &a, 0, nullptr, &sz, &n) != noErr || !n) return "?";
  char b[256]; CFStringGetCString(n, b, sizeof b, kCFStringEncodingUTF8); CFRelease(n); return b;
}
int channels(AudioDeviceID d, AudioObjectPropertyScope sc) {
  auto a = addr(kAudioDevicePropertyStreamConfiguration, sc); UInt32 sz = 0;
  if (AudioObjectGetPropertyDataSize(d, &a, 0, nullptr, &sz) != noErr || !sz) return 0;
  std::vector<uint8_t> m(sz); auto* l = reinterpret_cast<AudioBufferList*>(m.data());
  if (AudioObjectGetPropertyData(d, &a, 0, nullptr, &sz, l) != noErr) return 0;
  int n = 0; for (UInt32 i = 0; i < l->mNumberBuffers; i++) n += int(l->mBuffers[i].mNumberChannels);
  return n;
}
std::vector<AudioDeviceID> devices() {
  auto a = addr(kAudioHardwarePropertyDevices); UInt32 sz = 0;
  AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, nullptr, &sz);
  std::vector<AudioDeviceID> v(sz / 4);
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, nullptr, &sz, v.data());
  return v;
}
// Appareil dont le nom contient `part` (sans tenir compte de la casse), ou celui du système si `part` est vide.
AudioDeviceID findDev(const std::string& part, bool input) {
  auto sc = input ? kAudioObjectPropertyScopeInput : kAudioObjectPropertyScopeOutput;
  if (part.empty()) return u32(kAudioObjectSystemObject, input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice);
  for (auto d : devices()) {
    std::string n = devName(d), a = n, b = part;
    for (auto& c : a) c = char(tolower(c));
    for (auto& c : b) c = char(tolower(c));
    if (a.find(b) != std::string::npos && channels(d, sc) > 0) return d;
  }
  return 0;
}
// Latence déclarée d'un sens, en échantillons : appareil + marge + flux + tampon (comme à l'étape 3).
UInt32 declared(AudioDeviceID d, AudioObjectPropertyScope sc) {
  auto a = addr(kAudioDevicePropertyStreams, sc); UInt32 sz = 0, stream = 0;
  if (AudioObjectGetPropertyDataSize(d, &a, 0, nullptr, &sz) == noErr && sz >= 4) {
    std::vector<AudioStreamID> ids(sz / 4); AudioObjectGetPropertyData(d, &a, 0, nullptr, &sz, ids.data());
    stream = u32(ids[0], kAudioStreamPropertyLatency);
  }
  return u32(d, kAudioDevicePropertyLatency, sc) + u32(d, kAudioDevicePropertySafetyOffset, sc) + stream + u32(d, kAudioDevicePropertyBufferFrameSize);
}

// ---------- Sortie : le fil de la carte son lit ce que Web Audio a écrit ----------
OSStatus render(void* ref, AudioUnitRenderActionFlags* fl, const AudioTimeStamp* ts, UInt32, UInt32 n, AudioBufferList* abl) {
  IO* s = static_cast<IO*>(ref);
  float* o[2] = { static_cast<float*>(abl->mBuffers[0].mData), static_cast<float*>(abl->mBuffers[abl->mNumberBuffers > 1 ? 1 : 0].mData) };
  s->outCalls++;
  if (s->lastHost && (ts->mFlags & kAudioTimeStampHostTimeValid)) {
    double got = double(ts->mHostTime - s->lastHost) / s->hostHz, expect = s->lastN / s->sr;
    if (std::fabs(got - expect) > 0.5 * expect) { s->gaps++; if (got * 1000 > s->maxGap) s->maxGap = got * 1000; }
  }
  s->lastHost = ts->mHostTime; s->lastN = n;
  const uint32_t M = s->N - 1;
  uint32_t w = uint32_t(ld(&s->h[0]));
  double avail = double(int32_t(w - s->rInt)) - s->rFrac;
  if (!s->outOn) {
    // Démarrage (ou reprise après un manque) : on attend le niveau cible, et on jette l'excédent ancien.
    if (avail >= s->so.target + n + 4) {
      s->rInt = w - uint32_t(s->so.target); s->rFrac = 0; s->outOn = true; s->outStarts++;
      avail = s->so.target;
    } else {
      memset(o[0], 0, n * 4); if (o[1] != o[0]) memset(o[1], 0, n * 4);
      *fl |= kAudioUnitRenderAction_OutputIsSilence;
      if (avail > s->N / 2) { s->rInt = w - uint32_t(s->so.target); st(&s->h[1], int32_t(s->rInt)); }
      return noErr;
    }
  }
  s->so.update(avail, n / s->sr);
  double step = s->so.step;
  if (avail < n * step + 4) {   // Web Audio n'a pas fourni à temps : silence, et on repart au niveau cible
    s->outUnder++; s->outOn = false;
    memset(o[0], 0, n * 4); if (o[1] != o[0]) memset(o[1], 0, n * 4);
    return noErr;
  }
  uint32_t ri = s->rInt; double fr = s->rFrac;
  int armed = s->armed.load(std::memory_order_relaxed);
  for (UInt32 k = 0; k < n; k++) {
    float t = float(fr);
    for (int c = 0; c < 2; c++) {
      const float* r = s->outRing[c];
      float v = hermite(r[(ri - 1) & M], r[ri & M], r[(ri + 1) & M], r[(ri + 2) & M], t) * s->gain;
      if (o[1] == o[0] && c == 1) break;
      o[c][k] = v;
    }
    if (armed == 1 && std::fabs(o[0][k]) > s->outThr * s->gain) {
      s->tOut = double(ts->mHostTime) / s->hostHz + k / s->sr; s->armed = armed = 2;
    }
    fr += step; uint32_t adv = uint32_t(fr); ri += adv; fr -= adv;
  }
  s->rInt = ri; s->rFrac = fr;
  st(&s->h[1], int32_t(ri));
  s->outFrames += n;
  return noErr;
}

// ---------- Entrée : le micro est écrit pour Web Audio ----------
OSStatus capture(void* ref, AudioUnitRenderActionFlags* fl, const AudioTimeStamp* ts, UInt32 bus, UInt32 n, AudioBufferList*) {
  IO* s = static_cast<IO*>(ref);
  if (n > MAXF) return noErr;
  for (int c = 0; c < s->inCh; c++) { s->inAbl->mBuffers[c].mData = s->inBuf[c].data(); s->inAbl->mBuffers[c].mDataByteSize = n * 4; }
  if (AudioUnitRender(s->inU, fl, ts, bus, n, s->inAbl) != noErr) return noErr;
  s->inCalls++; s->inFrames += n;
  const uint64_t FM = s->fifo[0].size() - 1;
  // Mesure : bruit de fond tant que le clic n'est pas sorti, puis premier échantillon qui le dépasse nettement.
  int armed = s->armed.load(std::memory_order_relaxed);
  for (UInt32 k = 0; k < n; k++) {
    float x = s->inBuf[0][k];
    if (armed == 1) s->floor = std::max(s->floor, std::fabs(x));
    else if (armed == 2 && std::fabs(x) > std::max(s->inMin, 5 * s->floor) && double(ts->mHostTime) / s->hostHz + k / s->sr > s->tOut) {
      s->tIn = double(ts->mHostTime) / s->hostHz + k / s->sr; s->armed = armed = 3;
    }
    for (int c = 0; c < s->inCh; c++) s->fifo[c][(s->fw + k) & FM] = s->inBuf[c][k];
  }
  s->fw += n;
  const uint32_t M = s->N - 1;
  int32_t used = int32_t(s->wIn - uint32_t(ld(&s->h[3])));
  if (used > int32_t(s->N / 2)) { s->inOver++; s->fr = double(s->fw) - 2; return noErr; }   // Web Audio ne lit plus (contexte suspendu)
  if (!s->inOn) { s->fr = double(s->fw) - n; s->inOn = true; }
  s->si.update(used, n / s->sr);
  double step = s->si.step, fr = s->fr;
  while (fr + 2 < double(s->fw)) {
    uint64_t i = uint64_t(fr); float t = float(fr - double(i));
    for (int c = 0; c < s->inCh; c++) {
      const std::vector<float>& f = s->fifo[c];
      s->inRing[c][s->wIn & M] = hermite(f[(i - 1) & FM], f[i & FM], f[(i + 1) & FM], f[(i + 2) & FM], t);
    }
    s->wIn++; fr += step;
  }
  s->fr = fr;
  st(&s->h[2], int32_t(s->wIn));
  return noErr;
}

void overload(IO* s) { s->overloads++; }
OSStatus onOverload(AudioObjectID, UInt32, const AudioObjectPropertyAddress*, void* r) { overload(static_cast<IO*>(r)); return noErr; }

void err(Isolate* iso, const char* m) { iso->ThrowException(Exception::Error(String::NewFromUtf8(iso, m).ToLocalChecked())); }
std::string str(Isolate* iso, Local<Value> v) { String::Utf8Value u(iso, v); return *u ? *u : ""; }
double num(Isolate* iso, Local<Object> o, const char* k, double d) {
  auto cx = iso->GetCurrentContext(); Local<Value> v;
  if (!o->Get(cx, String::NewFromUtf8(iso, k).ToLocalChecked()).ToLocal(&v) || !v->IsNumber()) return d;
  return v->NumberValue(cx).FromMaybe(d);
}
std::string text(Isolate* iso, Local<Object> o, const char* k) {
  Local<Value> v;
  if (!o->Get(iso->GetCurrentContext(), String::NewFromUtf8(iso, k).ToLocalChecked()).ToLocal(&v) || !v->IsString()) return "";
  return str(iso, v);
}

AudioStreamBasicDescription fmt(double sr, int ch) {
  AudioStreamBasicDescription f{};
  f.mSampleRate = sr; f.mFormatID = kAudioFormatLinearPCM;
  f.mFormatFlags = AudioFormatFlags(kAudioFormatFlagsNativeFloatPacked) | AudioFormatFlags(kAudioFormatFlagIsNonInterleaved);
  f.mBytesPerPacket = f.mBytesPerFrame = 4; f.mFramesPerPacket = 1; f.mChannelsPerFrame = UInt32(ch); f.mBitsPerChannel = 32;
  return f;
}

AudioUnit halUnit() {
  AudioComponentDescription d{ kAudioUnitType_Output, kAudioUnitSubType_HALOutput, kAudioUnitManufacturer_Apple, 0, 0 };
  AudioComponent c = AudioComponentFindNext(nullptr, &d);
  AudioUnit u = nullptr;
  return c && AudioComponentInstanceNew(c, &u) == noErr ? u : nullptr;
}

void stopIO() {
  if (!io) return;
  auto oa = addr(kAudioDeviceProcessorOverload);
  if (io->outU) { AudioOutputUnitStop(io->outU); AudioUnitUninitialize(io->outU); AudioComponentInstanceDispose(io->outU); }
  if (io->inU) { AudioOutputUnitStop(io->inU); AudioUnitUninitialize(io->inU); AudioComponentInstanceDispose(io->inU); }
  if (io->outDev) AudioObjectRemovePropertyListener(io->outDev, &oa, onOverload, io.get());
  free(io->inAbl);
  io.reset();
}

/**
 * ioStart(sab, { sampleRate, output, input, buffer, outTarget, inTarget, gain }) → { output, input, inChannels, ... }
 * output / input : partie du nom de l'appareil ('' = celui du système ; input: null = pas d'entrée).
 */
void IoStart(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  if (a.Length() < 2 || !a[0]->IsSharedArrayBuffer() || !a[1]->IsObject()) return err(iso, "ioStart(sab, options)");
  stopIO();
  auto o = a[1].As<Object>();
  auto s = std::make_unique<IO>();
  s->store = a[0].As<SharedArrayBuffer>()->GetBackingStore();
  s->sr = num(iso, o, "sampleRate", 48000);
  s->hostHz = double(AudioGetHostClockFrequency());
  s->gain = float(num(iso, o, "gain", 1));
  auto* base = static_cast<uint8_t*>(s->store->Data());
  s->h = reinterpret_cast<int32_t*>(base);
  s->N = uint32_t(s->h[7]);
  if (!s->N || (s->N & (s->N - 1)) || s->store->ByteLength() < size_t(HDR * 4 + 16 * s->N)) return err(iso, "mémoire partagée incorrecte");
  float* f = reinterpret_cast<float*>(base + HDR * 4);
  s->outRing[0] = f; s->outRing[1] = f + s->N; s->inRing[0] = f + 2 * s->N; s->inRing[1] = f + 3 * s->N;
  s->so.reset(num(iso, o, "outTarget", 384));
  s->si.reset(num(iso, o, "inTarget", 384));
  UInt32 buffer = UInt32(num(iso, o, "buffer", 128));

  // Sortie.
  s->outDev = findDev(text(iso, o, "output"), false);
  if (!s->outDev) return err(iso, "sortie introuvable");
  s->outName = devName(s->outDev);
  { auto ba = addr(kAudioDevicePropertyBufferFrameSize); AudioObjectSetPropertyData(s->outDev, &ba, 0, nullptr, 4, &buffer); }
  s->outU = halUnit();
  auto f2 = fmt(s->sr, 2);
  AURenderCallbackStruct rcb{ render, s.get() };
  if (!s->outU ||
      AudioUnitSetProperty(s->outU, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &s->outDev, sizeof s->outDev) ||
      AudioUnitSetProperty(s->outU, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &f2, sizeof f2) ||
      AudioUnitSetProperty(s->outU, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &rcb, sizeof rcb) ||
      AudioUnitInitialize(s->outU)) { io = std::move(s); stopIO(); return err(iso, "sortie impossible à ouvrir"); }

  // Entrée (facultative).
  Local<Value> inV;
  bool wantIn = o->Get(cx, String::NewFromUtf8Literal(iso, "input")).ToLocal(&inV) && !inV->IsNull();
  if (wantIn) {
    s->inDev = findDev(inV->IsString() ? str(iso, inV) : "", true);
    if (!s->inDev) { io = std::move(s); stopIO(); return err(iso, "entrée introuvable"); }
    s->inName = devName(s->inDev);
    s->inCh = std::max(1, std::min(2, channels(s->inDev, kAudioObjectPropertyScopeInput)));
    { auto ba = addr(kAudioDevicePropertyBufferFrameSize); AudioObjectSetPropertyData(s->inDev, &ba, 0, nullptr, 4, &buffer); }
    for (int c = 0; c < 2; c++) { s->fifo[c].assign(16384, 0.f); s->inBuf[c].assign(MAXF, 0.f); }
    s->inAbl = static_cast<AudioBufferList*>(calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer) * 2));
    s->inAbl->mNumberBuffers = UInt32(s->inCh);
    for (int c = 0; c < s->inCh; c++) s->inAbl->mBuffers[c].mNumberChannels = 1;
    s->inU = halUnit();
    UInt32 on = 1, off = 0;
    auto fi = fmt(s->sr, s->inCh);
    AURenderCallbackStruct icb{ capture, s.get() };
    UInt32 maxf = MAXF;
    if (!s->inU ||
        AudioUnitSetProperty(s->inU, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &on, 4) ||
        AudioUnitSetProperty(s->inU, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, 0, &off, 4) ||
        AudioUnitSetProperty(s->inU, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &s->inDev, sizeof s->inDev) ||
        AudioUnitSetProperty(s->inU, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 1, &fi, sizeof fi) ||
        AudioUnitSetProperty(s->inU, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maxf, 4) ||
        AudioUnitSetProperty(s->inU, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, 0, &icb, sizeof icb) ||
        AudioUnitInitialize(s->inU)) {
      io = std::move(s); stopIO(); return err(iso, "entrée impossible à ouvrir");
    }
  }
  s->h[10] = wantIn ? s->inCh : 0;
  st(&s->h[4], int32_t(s->si.target));
  s->rInt = uint32_t(ld(&s->h[0]));
  st(&s->h[1], int32_t(s->rInt));   // le worklet voit tout de suite la place libre (sinon, tampon plein = blocage)
  s->wIn = uint32_t(ld(&s->h[3]));
  st(&s->h[2], int32_t(s->wIn));
  auto oa = addr(kAudioDeviceProcessorOverload);
  AudioObjectAddPropertyListener(s->outDev, &oa, onOverload, s.get());
  io = std::move(s);
  if (io->inU && AudioOutputUnitStart(io->inU)) { stopIO(); return err(iso, "entrée impossible à démarrer"); }
  if (AudioOutputUnitStart(io->outU)) { stopIO(); return err(iso, "sortie impossible à démarrer"); }

  Local<Object> r = Object::New(iso);
  auto set = [&](const char* k, Local<Value> v) { r->Set(cx, String::NewFromUtf8(iso, k).ToLocalChecked(), v).Check(); };
  set("output", String::NewFromUtf8(iso, io->outName.c_str()).ToLocalChecked());
  set("input", io->inU ? String::NewFromUtf8(iso, io->inName.c_str()).ToLocalChecked().As<Value>() : Null(iso).As<Value>());
  set("inChannels", Integer::New(iso, io->inU ? io->inCh : 0));
  set("outDeclared", Number::New(iso, declared(io->outDev, kAudioObjectPropertyScopeOutput) / io->sr));
  set("inDeclared", Number::New(iso, io->inU ? declared(io->inDev, kAudioObjectPropertyScopeInput) / io->sr : 0));
  { Float64 v = 0; UInt32 sz = 8; auto ra = addr(kAudioDevicePropertyNominalSampleRate); AudioObjectGetPropertyData(io->outDev, &ra, 0, nullptr, &sz, &v); set("outRate", Number::New(iso, v)); }
  if (io->inU) { Float64 v = 0; UInt32 sz = 8; auto ra = addr(kAudioDevicePropertyNominalSampleRate); AudioObjectGetPropertyData(io->inDev, &ra, 0, nullptr, &sz, &v); set("inRate", Number::New(iso, v)); }
  set("buffer", Integer::New(iso, int32_t(u32(io->outDev, kAudioDevicePropertyBufferFrameSize))));
  a.GetReturnValue().Set(r);
}

void IoStop(const FunctionCallbackInfo<Value>&) { stopIO(); }

/** ioStats() → compteurs, niveaux des tampons, rapports des deux régulateurs, résultat de la dernière mesure. */
void IoStats(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  if (!io) return a.GetReturnValue().Set(Null(iso));
  IO* s = io.get();
  Local<Object> r = Object::New(iso);
  auto n = [&](const char* k, double v) { r->Set(cx, String::NewFromUtf8(iso, k).ToLocalChecked(), Number::New(iso, v)).Check(); };
  n("outCalls", double(s->outCalls)); n("outFrames", double(s->outFrames)); n("outUnderruns", double(s->outUnder)); n("outStarts", double(s->outStarts));
  n("overloads", double(s->overloads)); n("gaps", double(s->gaps)); n("maxGapMs", s->maxGap);
  n("outLevel", s->so.avg); n("outMin", s->so.lo); n("outMax", s->so.hi); n("outTarget", s->so.target); n("outPpm", (s->so.step - 1) * 1e6);
  n("inCalls", double(s->inCalls)); n("inFrames", double(s->inFrames)); n("inOverflows", double(s->inOver));
  n("inLevel", s->si.avg); n("inMin", s->si.lo); n("inMax", s->si.hi); n("inTarget", s->si.target); n("inPpm", (s->si.step - 1) * 1e6);
  n("armed", s->armed); n("tripMs", s->armed == 3 ? (s->tIn - s->tOut) * 1000 : -1); n("floor", s->floor);
  a.GetReturnValue().Set(r);
}

/** ioArm(seuil de sortie) : prépare la mesure du trajet sur le prochain son fort qui sort. ioResetStats() : remet les extrêmes à zéro. */
void IoArm(const FunctionCallbackInfo<Value>& a) {
  if (!io) return;
  io->outThr = float(a[0]->NumberValue(a.GetIsolate()->GetCurrentContext()).FromMaybe(0.1));
  io->floor = 0; io->tOut = 0; io->tIn = 0; io->armed = 1;
}
void IoResetStats(const FunctionCallbackInfo<Value>&) {
  if (!io) return;
  io->so.lo = io->si.lo = 1e9; io->so.hi = io->si.hi = -1e9;
  io->outUnder = 0; io->inOver = 0; io->overloads = 0; io->gaps = 0; io->maxGap = 0; io->outStarts = 0;
}
void IoGain(const FunctionCallbackInfo<Value>& a) {
  if (io) io->gain = float(a[0]->NumberValue(a.GetIsolate()->GetCurrentContext()).FromMaybe(1));
}

/** ioDevices() → [{ name, inputs, outputs }] */
void IoDevices(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Local<Array> arr = Array::New(iso); uint32_t k = 0;
  for (auto d : devices()) {
    Local<Object> o = Object::New(iso);
    o->Set(cx, String::NewFromUtf8Literal(iso, "name"), String::NewFromUtf8(iso, devName(d).c_str()).ToLocalChecked()).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "inputs"), Integer::New(iso, channels(d, kAudioObjectPropertyScopeInput))).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "outputs"), Integer::New(iso, channels(d, kAudioObjectPropertyScopeOutput))).Check();
    arr->Set(cx, k++, o).Check();
  }
  a.GetReturnValue().Set(arr);
}

}  // namespace

void RegisterIO(Isolate* iso, Local<Object> exports, Local<Context> context) {
  auto add = [&](const char* n, FunctionCallback f) {
    exports->Set(context, String::NewFromUtf8(iso, n).ToLocalChecked(), FunctionTemplate::New(iso, f)->GetFunction(context).ToLocalChecked()).Check();
  };
  add("ioStart", IoStart); add("ioStop", IoStop); add("ioStats", IoStats); add("ioArm", IoArm);
  add("ioResetStats", IoResetStats); add("ioGain", IoGain); add("ioDevices", IoDevices);
}
