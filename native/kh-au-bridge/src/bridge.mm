// Pont natif V14b, étape 4 : héberge des Audio Units dans le processus de la version bureau.
//
// Échange avec l'AudioWorklet par un SharedArrayBuffer, sans copie ni message :
//   Int32 [0] demande (le worklet l'incrémente)   [1] fait (le natif y recopie la demande traitée)
//         [2] nombre d'échantillons du bloc        [3..15] réservé
//   Float32 à partir de l'octet 64 : entrée [voies][max], puis sortie [voies][max]
// Un fil natif à priorité temps réel guette la demande, fait tourner le plugin (AudioUnitRender) et rend la main.
// Le worklet attend la réponse dans le même bloc : le pont n'ajoute aucun retard, seulement la latence propre du plugin.
#include <node.h>
#include <v8.h>
#include <AudioToolbox/AudioToolbox.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <mach/thread_policy.h>
#include <pthread.h>
#include <atomic>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <unistd.h>

using namespace v8;

namespace {

struct Slot {
  std::shared_ptr<BackingStore> store;   // garde la mémoire partagée en vie tant que le plugin tourne
  int32_t* hdr = nullptr;
  float* in = nullptr;
  float* out = nullptr;
  int ch = 2, max = 128;
  double sr = 48000;
  AudioUnit au = nullptr;
  std::thread th;
  std::atomic<bool> run{false};
  Float64 sampleTime = 0;
  AudioBufferList* abl = nullptr;
  std::string name;
};

std::map<int, std::unique_ptr<Slot>> slots;
int nextId = 1;

OSStatus feed(void* ref, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 frames, AudioBufferList* io) {
  auto* s = static_cast<Slot*>(ref);
  for (UInt32 c = 0; c < io->mNumberBuffers; c++) memcpy(io->mBuffers[c].mData, s->in + c * s->max, frames * sizeof(float));
  return noErr;
}

void realtime() {
  // Même réglage que les fils audio de Core Audio : quantum court, garanti à chaque période.
  mach_timebase_info_data_t tb; mach_timebase_info(&tb);
  auto ticks = [&](double ms) { return uint32_t(ms * 1e6 * tb.denom / tb.numer); };
  thread_time_constraint_policy_data_t p{ ticks(2.9), ticks(0.5), ticks(2.9), 1 };
  thread_policy_set(pthread_mach_thread_np(pthread_self()), THREAD_TIME_CONSTRAINT_POLICY, (thread_policy_t)&p, THREAD_TIME_CONSTRAINT_POLICY_COUNT);
}

void loop(Slot* s) {
  pthread_setname_np("kh-au-bridge");
  realtime();
  int32_t last = __atomic_load_n(&s->hdr[1], __ATOMIC_ACQUIRE);
  int idle = 0;
  while (s->run.load(std::memory_order_relaxed)) {
    int32_t req = __atomic_load_n(&s->hdr[0], __ATOMIC_ACQUIRE);
    if (req == last) {
      // Attente active brève juste après un bloc (le suivant arrive dans ~2,7 ms), puis petits sommeils.
      if (++idle < 2000) { __builtin_arm_yield(); continue; }
      usleep(50); continue;
    }
    idle = 0;
    UInt32 frames = UInt32(std::min(s->max, std::max(0, s->hdr[2])));
    for (int c = 0; c < s->ch; c++) { s->abl->mBuffers[c].mData = s->out + c * s->max; s->abl->mBuffers[c].mDataByteSize = frames * 4; }
    AudioTimeStamp ts{}; ts.mSampleTime = s->sampleTime; ts.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags fl = 0;
    if (AudioUnitRender(s->au, &fl, &ts, 0, frames, s->abl) != noErr)
      for (int c = 0; c < s->ch; c++) memcpy(s->out + c * s->max, s->in + c * s->max, frames * 4);   // en cas d'erreur, le son passe tel quel
    s->sampleTime += frames;
    last = req;
    __atomic_store_n(&s->hdr[1], req, __ATOMIC_RELEASE);
  }
}

OSType code(Isolate* iso, Local<Value> v) {
  String::Utf8Value u(iso, v);
  std::string t = *u ? *u : ""; t.resize(4, ' ');
  return (OSType(uint8_t(t[0])) << 24) | (OSType(uint8_t(t[1])) << 16) | (OSType(uint8_t(t[2])) << 8) | OSType(uint8_t(t[3]));
}
void err(Isolate* iso, const char* m) { iso->ThrowException(Exception::Error(String::NewFromUtf8(iso, m).ToLocalChecked())); }
Slot* find(const FunctionCallbackInfo<Value>& a) {
  auto it = slots.find(a[0]->Int32Value(a.GetIsolate()->GetCurrentContext()).FromMaybe(0));
  return it == slots.end() ? nullptr : it->second.get();
}

/** open(sab, type, sousType, fabricant, fréquence, voies, max) → identifiant */
void Open(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  if (a.Length() < 7 || !a[0]->IsSharedArrayBuffer()) return err(iso, "open(sab, type, sousType, fabricant, fréquence, voies, max)");
  auto s = std::make_unique<Slot>();
  s->store = a[0].As<SharedArrayBuffer>()->GetBackingStore();
  s->sr = a[4]->NumberValue(cx).FromMaybe(48000);
  s->ch = a[5]->Int32Value(cx).FromMaybe(2);
  s->max = a[6]->Int32Value(cx).FromMaybe(128);
  if (s->store->ByteLength() < size_t(64 + 8 * s->ch * s->max)) return err(iso, "mémoire partagée trop petite");
  auto* base = static_cast<uint8_t*>(s->store->Data());
  s->hdr = reinterpret_cast<int32_t*>(base);
  s->in = reinterpret_cast<float*>(base + 64);
  s->out = s->in + s->ch * s->max;

  AudioComponentDescription d{ code(iso, a[1]), code(iso, a[2]), code(iso, a[3]), 0, 0 };
  AudioComponent comp = AudioComponentFindNext(nullptr, &d);
  if (!comp) return err(iso, "plugin introuvable");
  if (AudioComponentInstanceNew(comp, &s->au) != noErr) return err(iso, "plugin impossible à créer");
  CFStringRef nm = nullptr;
  if (AudioComponentCopyName(comp, &nm) == noErr && nm) {
    char buf[256]; CFStringGetCString(nm, buf, sizeof buf, kCFStringEncodingUTF8); s->name = buf; CFRelease(nm);
  }
  AudioStreamBasicDescription f{};
  f.mSampleRate = s->sr; f.mFormatID = kAudioFormatLinearPCM;
  f.mFormatFlags = AudioFormatFlags(kAudioFormatFlagsNativeFloatPacked) | AudioFormatFlags(kAudioFormatFlagIsNonInterleaved);
  f.mBytesPerPacket = f.mBytesPerFrame = 4; f.mFramesPerPacket = 1; f.mChannelsPerFrame = UInt32(s->ch); f.mBitsPerChannel = 32;
  UInt32 maxf = UInt32(s->max);
  AURenderCallbackStruct cb{ feed, s.get() };
  if (AudioUnitSetProperty(s->au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &f, sizeof f) ||
      AudioUnitSetProperty(s->au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &f, sizeof f) ||
      AudioUnitSetProperty(s->au, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maxf, sizeof maxf) ||
      AudioUnitSetProperty(s->au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof cb) ||
      AudioUnitInitialize(s->au)) {
    AudioComponentInstanceDispose(s->au);
    return err(iso, "format refusé par le plugin");
  }
  s->abl = static_cast<AudioBufferList*>(calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer) * s->ch));
  s->abl->mNumberBuffers = UInt32(s->ch);
  for (int c = 0; c < s->ch; c++) s->abl->mBuffers[c].mNumberChannels = 1;
  s->hdr[1] = s->hdr[0];
  s->run = true;
  Slot* raw = s.get();
  s->th = std::thread(loop, raw);
  int id = nextId++;
  slots[id] = std::move(s);
  a.GetReturnValue().Set(id);
}

/** setParam(id, adresse, valeur) */
void SetParam(const FunctionCallbackInfo<Value>& a) {
  auto cx = a.GetIsolate()->GetCurrentContext();
  if (Slot* s = find(a))
    AudioUnitSetParameter(s->au, AudioUnitParameterID(a[1]->Uint32Value(cx).FromMaybe(0)), kAudioUnitScope_Global, 0, Float32(a[2]->NumberValue(cx).FromMaybe(0)), 0);
}

/** info(id) → { name, latency (s), tail (s) } */
void Info(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Slot* s = find(a);
  if (!s) return;
  Float64 lat = 0, tail = 0; UInt32 sz = sizeof(Float64);
  AudioUnitGetProperty(s->au, kAudioUnitProperty_Latency, kAudioUnitScope_Global, 0, &lat, &sz); sz = sizeof(Float64);
  AudioUnitGetProperty(s->au, kAudioUnitProperty_TailTime, kAudioUnitScope_Global, 0, &tail, &sz);
  Local<Object> o = Object::New(iso);
  o->Set(cx, String::NewFromUtf8Literal(iso, "name"), String::NewFromUtf8(iso, s->name.c_str()).ToLocalChecked()).Check();
  o->Set(cx, String::NewFromUtf8Literal(iso, "latency"), Number::New(iso, lat)).Check();
  o->Set(cx, String::NewFromUtf8Literal(iso, "tail"), Number::New(iso, tail)).Check();
  a.GetReturnValue().Set(o);
}

/** close(id) */
void Close(const FunctionCallbackInfo<Value>& a) {
  auto cx = a.GetIsolate()->GetCurrentContext();
  auto it = slots.find(a[0]->Int32Value(cx).FromMaybe(0));
  if (it == slots.end()) return;
  Slot* s = it->second.get();
  s->run = false; if (s->th.joinable()) s->th.join();
  AudioUnitUninitialize(s->au); AudioComponentInstanceDispose(s->au); free(s->abl);
  slots.erase(it);
}

/** list() → [{ type, subtype, manufacturer, name }] : Audio Units d'effet installés */
void List(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Local<Array> arr = Array::New(iso); uint32_t n = 0;
  AudioComponentDescription d{ kAudioUnitType_Effect, 0, 0, 0, 0 };
  auto str = [&](OSType t) { char c[5] = { char(t >> 24), char(t >> 16), char(t >> 8), char(t), 0 }; return String::NewFromUtf8(iso, c).ToLocalChecked(); };
  for (AudioComponent c = AudioComponentFindNext(nullptr, &d); c; c = AudioComponentFindNext(c, &d)) {
    AudioComponentDescription cd; AudioComponentGetDescription(c, &cd);
    CFStringRef nm = nullptr; char buf[256] = "?";
    if (AudioComponentCopyName(c, &nm) == noErr && nm) { CFStringGetCString(nm, buf, sizeof buf, kCFStringEncodingUTF8); CFRelease(nm); }
    Local<Object> o = Object::New(iso);
    o->Set(cx, String::NewFromUtf8Literal(iso, "type"), str(cd.componentType)).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "subtype"), str(cd.componentSubType)).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "manufacturer"), str(cd.componentManufacturer)).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "name"), String::NewFromUtf8(iso, buf).ToLocalChecked()).Check();
    arr->Set(cx, n++, o).Check();
  }
  a.GetReturnValue().Set(arr);
}

}  // namespace

void RegisterIO(Isolate* iso, Local<Object> exports, Local<Context> context);   // io.mm : entrée et sortie de la carte son

NODE_MODULE_INIT(/* exports, module, context */) {
  Isolate* iso = Isolate::GetCurrent();
  auto add = [&](const char* n, FunctionCallback f) {
    exports->Set(context, String::NewFromUtf8(iso, n).ToLocalChecked(), FunctionTemplate::New(iso, f)->GetFunction(context).ToLocalChecked()).Check();
  };
  add("open", Open); add("setParam", SetParam); add("info", Info); add("close", Close); add("list", List);
  RegisterIO(iso, exports, context);
}
