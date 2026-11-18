// Pont natif V14b, étape 4 : héberge des Audio Units dans le processus de la version bureau.
//
// Échange avec l'AudioWorklet par un SharedArrayBuffer, sans copie ni message :
//   Int32 [0] demande (le worklet l'incrémente)   [1] fait (le natif y recopie la demande traitée)
//         [2] nombre d'échantillons du bloc        [3] instrument : nombre d'évènements MIDI du bloc   [4..15] réservé
//   Float32 à partir de l'octet 64 : entrée [voies][max], puis sortie [voies][max]
//   Instrument (V19) : ensuite EVMAX évènements de deux Int32 : position dans le bloc, puis statut | donnée 1 << 8 | donnée 2 << 16.
// Un fil natif à priorité temps réel guette la demande, fait tourner le plugin (AudioUnitRender) et rend la main.
// Le worklet attend la réponse dans le même bloc : le pont n'ajoute aucun retard, seulement la latence propre du plugin.
#include <node.h>
#include <v8.h>
#include <AudioToolbox/AudioToolbox.h>
#import <AppKit/AppKit.h>
#import <CoreAudioKit/CoreAudioKit.h>
#import <QuartzCore/QuartzCore.h>
#import <AudioToolbox/AUCocoaUIView.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <mach/thread_policy.h>
#include <pthread.h>
#include <atomic>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <vector>
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
  bool inst = false;            // instrument (aumu) : pas d'entrée audio, des évènements MIDI
  int32_t* ev = nullptr;
};
constexpr int EVMAX = 256;

std::map<int, std::unique_ptr<Slot>> slots;
int nextId = 1;

OSStatus feed(void* ref, AudioUnitRenderActionFlags*, const AudioTimeStamp*, UInt32, UInt32 frames, AudioBufferList* io) {
  auto* s = static_cast<Slot*>(ref);
  for (UInt32 c = 0; c < io->mNumberBuffers; c++) memcpy(io->mBuffers[c].mData, s->in + c * s->max, frames * sizeof(float));
  return noErr;
}

// Pause d'attente active : instruction propre à chaque puce (Apple ou Intel).
inline void pause() {
#if defined(__arm64__) || defined(__aarch64__)
  __builtin_arm_yield();
#else
  __builtin_ia32_pause();
#endif
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
      if (++idle < 2000) { pause(); continue; }
      usleep(50); continue;
    }
    idle = 0;
    UInt32 frames = UInt32(std::min(s->max, std::max(0, s->hdr[2])));
    for (int c = 0; c < s->ch; c++) { s->abl->mBuffers[c].mData = s->out + c * s->max; s->abl->mBuffers[c].mDataByteSize = frames * 4; }
    // Instrument : les notes et contrôles du bloc, chacun à sa position (l'AudioWorklet les a rangés avant de demander le calcul).
    if (s->inst) {
      int n = std::min(EVMAX, std::max(0, s->hdr[3]));
      for (int i = 0; i < n; i++) {
        int32_t off = std::min(int32_t(frames) - 1, std::max(0, s->ev[2 * i])), m = s->ev[2 * i + 1];
        MusicDeviceMIDIEvent(s->au, UInt32(m & 255), UInt32((m >> 8) & 127), UInt32((m >> 16) & 127), UInt32(off));
      }
    }
    AudioTimeStamp ts{}; ts.mSampleTime = s->sampleTime; ts.mFlags = kAudioTimeStampSampleTimeValid;
    AudioUnitRenderActionFlags fl = 0;
    if (AudioUnitRender(s->au, &fl, &ts, 0, frames, s->abl) != noErr) {
      if (s->inst) for (int c = 0; c < s->ch; c++) memset(s->out + c * s->max, 0, frames * 4);   // instrument en erreur : silence
      else for (int c = 0; c < s->ch; c++) memcpy(s->out + c * s->max, s->in + c * s->max, frames * 4);   // en cas d'erreur, le son passe tel quel
    }
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
  AudioComponentDescription d{ code(iso, a[1]), code(iso, a[2]), code(iso, a[3]), 0, 0 };
  s->inst = d.componentType == kAudioUnitType_MusicDevice;
  if (s->store->ByteLength() < size_t(64 + 8 * s->ch * s->max + (s->inst ? 8 * EVMAX : 0))) return err(iso, "mémoire partagée trop petite");
  auto* base = static_cast<uint8_t*>(s->store->Data());
  s->hdr = reinterpret_cast<int32_t*>(base);
  s->in = reinterpret_cast<float*>(base + 64);
  s->out = s->in + s->ch * s->max;
  if (s->inst) s->ev = reinterpret_cast<int32_t*>(base + 64 + 8 * s->ch * s->max);

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
  // Un instrument n'a pas d'entrée audio : seule sa sortie est réglée.
  bool bad = s->inst
    ? (AudioUnitSetProperty(s->au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &f, sizeof f) ||
       AudioUnitSetProperty(s->au, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maxf, sizeof maxf))
    : (AudioUnitSetProperty(s->au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &f, sizeof f) ||
       AudioUnitSetProperty(s->au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &f, sizeof f) ||
       AudioUnitSetProperty(s->au, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0, &maxf, sizeof maxf) ||
       AudioUnitSetProperty(s->au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof cb));
  if (bad || AudioUnitInitialize(s->au)) {
    AudioComponentInstanceDispose(s->au);
    return err(iso, "format refusé par le plugin");
  }
  s->abl = static_cast<AudioBufferList*>(calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer) * s->ch));
  s->abl->mNumberBuffers = UInt32(s->ch);
  for (int c = 0; c < s->ch; c++) s->abl->mBuffers[c].mNumberChannels = 1;
  s->hdr[1] = s->hdr[0]; s->hdr[3] = 0;
  s->run = true;
  Slot* raw = s.get();
  s->th = std::thread(loop, raw);
  int id = nextId++;
  slots[id] = std::move(s);
  a.GetReturnValue().Set(id);
}

/** getState(id) → état complet du plugin (kAudioUnitProperty_ClassInfo), en base64 ; '' s'il ne le donne pas.
 *  Indispensable pour un instrument dont le son ne tient pas dans ses seuls réglages (Serum, Kontakt…). */
void GetState(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate();
  Slot* s = find(a);
  std::string out;
  CFPropertyListRef pl = nullptr; UInt32 sz = sizeof pl;
  if (s && AudioUnitGetProperty(s->au, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl, &sz) == noErr && pl) {
    @autoreleasepool {
      CFDataRef data = CFPropertyListCreateData(kCFAllocatorDefault, pl, kCFPropertyListBinaryFormat_v1_0, 0, nullptr);
      if (data) { out = [[(NSData*)data base64EncodedStringWithOptions:0] UTF8String]; CFRelease(data); }
    }
    CFRelease(pl);
  }
  a.GetReturnValue().Set(String::NewFromUtf8(iso, out.c_str()).ToLocalChecked());
}
/** setState(id, base64) → true si le plugin a repris l'état. */
void SetState(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate();
  Slot* s = find(a);
  bool ok = false;
  String::Utf8Value u(iso, a[1]);
  if (s && *u && **u) {
    @autoreleasepool {
      NSData* data = [[NSData alloc] initWithBase64EncodedString:[NSString stringWithUTF8String:*u] options:0];
      if (data) {
        CFPropertyListRef pl = CFPropertyListCreateWithData(kCFAllocatorDefault, (CFDataRef)data, kCFPropertyListImmutable, nullptr, nullptr);
        if (pl) {
          ok = AudioUnitSetProperty(s->au, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl, sizeof pl) == noErr;
          CFRelease(pl);
        }
        [data release];
      }
    }
  }
  a.GetReturnValue().Set(ok);
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

/** params(id) → [{ address, name, min, max, def, value, unit, flags }] : réglages modifiables du plugin (portée globale).
 *  flags : drapeaux Core Audio (kAudioUnitParameterFlag_DisplayLogarithmic = affichage logarithmique, etc.). */
void Params(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Slot* s = find(a);
  Local<Array> arr = Array::New(iso); uint32_t n = 0;
  if (!s) { a.GetReturnValue().Set(arr); return; }
  UInt32 sz = 0;
  if (AudioUnitGetPropertyInfo(s->au, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global, 0, &sz, nullptr) || !sz) { a.GetReturnValue().Set(arr); return; }
  std::vector<AudioUnitParameterID> ids(sz / sizeof(AudioUnitParameterID));
  if (AudioUnitGetProperty(s->au, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global, 0, ids.data(), &sz)) { a.GetReturnValue().Set(arr); return; }
  auto num = [&](Local<Object> o, const char* k, double v) { o->Set(cx, String::NewFromUtf8(iso, k).ToLocalChecked(), Number::New(iso, v)).Check(); };
  for (AudioUnitParameterID id : ids) {
    AudioUnitParameterInfo pi{}; UInt32 psz = sizeof pi;
    if (AudioUnitGetProperty(s->au, kAudioUnitProperty_ParameterInfo, kAudioUnitScope_Global, id, &pi, &psz)) continue;
    if (!(pi.flags & kAudioUnitParameterFlag_IsWritable)) continue;
    char buf[256] = "";
    if ((pi.flags & kAudioUnitParameterFlag_HasCFNameString) && pi.cfNameString) {
      CFStringGetCString(pi.cfNameString, buf, sizeof buf, kCFStringEncodingUTF8);
      if (pi.flags & kAudioUnitParameterFlag_CFNameRelease) CFRelease(pi.cfNameString);
    } else strlcpy(buf, pi.name, sizeof buf);
    AudioUnitParameterValue v = pi.defaultValue;
    AudioUnitGetParameter(s->au, id, kAudioUnitScope_Global, 0, &v);
    Local<Object> o = Object::New(iso);
    num(o, "address", id);
    o->Set(cx, String::NewFromUtf8Literal(iso, "name"), String::NewFromUtf8(iso, buf).ToLocalChecked()).Check();
    // Réglage à choix (kAudioUnitParameterUnit_Indexed) : noms des valeurs, s'il les fournit.
    if (pi.unit == kAudioUnitParameterUnit_Indexed) {
      CFArrayRef names = nullptr; UInt32 nsz = sizeof names;
      if (AudioUnitGetProperty(s->au, kAudioUnitProperty_ParameterValueStrings, kAudioUnitScope_Global, id, &names, &nsz) == noErr && names) {
        Local<Array> vs = Array::New(iso);
        for (CFIndex k = 0; k < CFArrayGetCount(names); k++) {
          char nb[256] = "";
          CFStringGetCString((CFStringRef)CFArrayGetValueAtIndex(names, k), nb, sizeof nb, kCFStringEncodingUTF8);
          vs->Set(cx, uint32_t(k), String::NewFromUtf8(iso, nb).ToLocalChecked()).Check();
        }
        CFRelease(names);
        o->Set(cx, String::NewFromUtf8Literal(iso, "values"), vs).Check();
      }
    }
    num(o, "min", pi.minValue); num(o, "max", pi.maxValue); num(o, "def", pi.defaultValue); num(o, "value", v); num(o, "unit", pi.unit); num(o, "flags", double(pi.flags));
    arr->Set(cx, n++, o).Check();
  }
  a.GetReturnValue().Set(arr);
}

/** presets(id) → [{ number, name }] : préréglages d'usine du plugin (vide s'il n'en a pas). */
void Presets(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Local<Array> arr = Array::New(iso);
  Slot* s = find(a);
  CFArrayRef list = nullptr; UInt32 sz = sizeof list;
  if (s && AudioUnitGetProperty(s->au, kAudioUnitProperty_FactoryPresets, kAudioUnitScope_Global, 0, &list, &sz) == noErr && list) {
    for (CFIndex k = 0; k < CFArrayGetCount(list); k++) {
      auto* pr = static_cast<const AUPreset*>(CFArrayGetValueAtIndex(list, k));
      char nb[256] = "";
      if (pr->presetName) CFStringGetCString(pr->presetName, nb, sizeof nb, kCFStringEncodingUTF8);
      Local<Object> o = Object::New(iso);
      o->Set(cx, String::NewFromUtf8Literal(iso, "number"), Number::New(iso, pr->presetNumber)).Check();
      o->Set(cx, String::NewFromUtf8Literal(iso, "name"), String::NewFromUtf8(iso, nb).ToLocalChecked()).Check();
      arr->Set(cx, uint32_t(k), o).Check();
    }
    CFRelease(list);
  }
  a.GetReturnValue().Set(arr);
}

/** setPreset(id, numéro) → true si le plugin a pris le préréglage d'usine (ses réglages changent : les relire par params). */
void SetPreset(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Slot* s = find(a);
  bool ok = false;
  CFArrayRef list = nullptr; UInt32 sz = sizeof list;
  int32_t want = a[1]->Int32Value(cx).FromMaybe(-1);
  if (s && AudioUnitGetProperty(s->au, kAudioUnitProperty_FactoryPresets, kAudioUnitScope_Global, 0, &list, &sz) == noErr && list) {
    for (CFIndex k = 0; k < CFArrayGetCount(list) && !ok; k++) {
      auto* pr = static_cast<const AUPreset*>(CFArrayGetValueAtIndex(list, k));
      if (pr->presetNumber == want) ok = AudioUnitSetProperty(s->au, kAudioUnitProperty_PresentPreset, kAudioUnitScope_Global, 0, pr, sizeof(AUPreset)) == noErr;
    }
    CFRelease(list);
  }
  a.GetReturnValue().Set(ok);
}


// ---------- Fenêtre graphique du plugin (V17) ----------
// La vue Cocoa fournie par le plugin (kAudioUnitProperty_CocoaUI) ou, à défaut, la vue générique d'Apple (AUGenericView),
// dans une fenêtre native flottante. Les réglages changés dans cette fenêtre vivent dans le plugin : la page les relit (params).
std::map<int, NSWindow*> windows;

NSView* makeView(AudioUnit au, bool& generic) {
  generic = false;
  UInt32 sz = 0; ::Boolean wr = false;
  if (AudioUnitGetPropertyInfo(au, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, &sz, &wr) == noErr && sz >= sizeof(AudioUnitCocoaViewInfo)) {
    auto* info = (AudioUnitCocoaViewInfo*)malloc(sz);
    NSView* v = nil;
    if (AudioUnitGetProperty(au, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, info, &sz) == noErr) {
      NSBundle* b = [NSBundle bundleWithURL:(NSURL*)info->mCocoaAUViewBundleLocation];
      Class c = b ? [b classNamed:(NSString*)info->mCocoaAUViewClass[0]] : nil;
      if (c && [c conformsToProtocol:@protocol(AUCocoaUIBase)]) {
        id<AUCocoaUIBase> f = [[c alloc] init];
        v = [f uiViewForAudioUnit:au withSize:NSMakeSize(480, 320)];
        [v retain]; [(id)f release];
      }
      UInt32 n = (sz - sizeof(CFURLRef)) / sizeof(CFStringRef);
      CFRelease(info->mCocoaAUViewBundleLocation); for (UInt32 i = 0; i < n; i++) CFRelease(info->mCocoaAUViewClass[i]);
    }
    free(info);
    if (v) return v;
  }
  generic = true;
  AUGenericView* g = [[AUGenericView alloc] initWithAudioUnit:au displayFlags:AUViewTitleDisplayFlag | AUViewPropertiesDisplayFlag | AUViewParametersDisplayFlag];
  [g setShowsExpertParameters:YES];
  return g;
}

/** uiOpen(id) → { generic, width, height } : ouvre (ou ramène devant) la fenêtre du plugin. */
void UiOpen(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  int id = a[0]->Int32Value(cx).FromMaybe(0);
  auto it = slots.find(id);
  if (it == slots.end()) { iso->ThrowException(Exception::Error(String::NewFromUtf8Literal(iso, "plugin inconnu"))); return; }
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow* w = windows.count(id) ? windows[id] : nil;
    bool generic = false;
    if (!w) {
      NSView* v = makeView(it->second->au, generic);
      NSRect r = NSMakeRect(240, 240, MAX(320, v.frame.size.width), MAX(160, v.frame.size.height));
      w = [[NSWindow alloc] initWithContentRect:r styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable backing:NSBackingStoreBuffered defer:NO];
      [w setReleasedWhenClosed:NO];
      [w setTitle:[NSString stringWithUTF8String:it->second->name.c_str()]];
      [w setContentView:v]; [v release];
      [w setLevel:NSFloatingWindowLevel];
      windows[id] = w;
    }
    [w makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [CATransaction flush];   // la page n'a pas de boucle d'évènements du Mac : on applique l'affichage tout de suite
    Local<Object> o = Object::New(iso);
    o->Set(cx, String::NewFromUtf8Literal(iso, "generic"), v8::Boolean::New(iso, generic)).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "width"), Number::New(iso, w.frame.size.width)).Check();
    o->Set(cx, String::NewFromUtf8Literal(iso, "height"), Number::New(iso, w.frame.size.height)).Check();
    a.GetReturnValue().Set(o);
  }
}
/** uiClose(id) : ferme la fenêtre du plugin. */
void UiClose(const FunctionCallbackInfo<Value>& a) {
  auto cx = a.GetIsolate()->GetCurrentContext();
  int id = a[0]->Int32Value(cx).FromMaybe(0);
  auto it = windows.find(id);
  if (it == windows.end()) return;
  [it->second orderOut:nil]; [it->second close]; [it->second release]; windows.erase(it);
  [CATransaction flush];
}
/** uiIsOpen(id) : la fenêtre est-elle affichée (l'utilisateur a pu la fermer par son bouton) ? */
void UiIsOpen(const FunctionCallbackInfo<Value>& a) {
  auto cx = a.GetIsolate()->GetCurrentContext();
  auto it = windows.find(a[0]->Int32Value(cx).FromMaybe(0));
  a.GetReturnValue().Set(it != windows.end() && [it->second isVisible]);
}
/** uiPump() : distribue les évènements du système (clics, touches) aux fenêtres des plugins. */
void UiPump(const FunctionCallbackInfo<Value>&) {
  if (windows.empty()) return;
  @autoreleasepool {
    for (int i = 0; i < 64; i++) {
      NSEvent* e = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:nil inMode:NSDefaultRunLoopMode dequeue:YES];
      if (!e) break;
      [NSApp sendEvent:e];
    }
  }
}

/** close(id) */
void Close(const FunctionCallbackInfo<Value>& a) {
  auto cx = a.GetIsolate()->GetCurrentContext();
  auto it = slots.find(a[0]->Int32Value(cx).FromMaybe(0));
  if (it == slots.end()) return;
  Slot* s = it->second.get();
  { auto w = windows.find(it->first); if (w != windows.end()) { [w->second orderOut:nil]; [w->second close]; [w->second release]; windows.erase(w); [CATransaction flush]; } }
  s->run = false; if (s->th.joinable()) s->th.join();
  AudioUnitUninitialize(s->au); AudioComponentInstanceDispose(s->au); free(s->abl);
  slots.erase(it);
}

/** list() → [{ type, subtype, manufacturer, name }] : Audio Units d'effet et instruments (V19) installés */
void List(const FunctionCallbackInfo<Value>& a) {
  Isolate* iso = a.GetIsolate(); auto cx = iso->GetCurrentContext();
  Local<Array> arr = Array::New(iso); uint32_t n = 0;
  auto str = [&](OSType t) { char c[5] = { char(t >> 24), char(t >> 16), char(t >> 8), char(t), 0 }; return String::NewFromUtf8(iso, c).ToLocalChecked(); };
  for (OSType kind : { OSType(kAudioUnitType_Effect), OSType(kAudioUnitType_MusicDevice) })
  for (AudioComponentDescription d{ kind, 0, 0, 0, 0 }; ; ) {
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
  break;
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
  add("open", Open); add("setParam", SetParam); add("info", Info); add("close", Close); add("list", List); add("params", Params); add("presets", Presets); add("setPreset", SetPreset);
  add("getState", GetState); add("setState", SetState);
  add("uiOpen", UiOpen); add("uiClose", UiClose); add("uiIsOpen", UiIsOpen); add("uiPump", UiPump);
  RegisterIO(iso, exports, context);
}
