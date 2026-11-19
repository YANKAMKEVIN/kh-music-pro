// Sortie Core Audio minimale (silence) sur une carte : compte les surcharges du HAL et les rappels en retard, sans KH Music Pro.
// Usage : swiftc -O qa/halseul.swift -o /tmp/halseul && /tmp/halseul <partie du nom de la carte> <secondes> <tampon>   (ex. Scarlett 1200 128)
import CoreAudio; import AudioToolbox; import Foundation
let want = CommandLine.arguments[1], secs = Double(CommandLine.arguments[2])!, buf = UInt32(CommandLine.arguments[3])!
func a(_ s: AudioObjectPropertySelector, _ sc: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress { .init(mSelector: s, mScope: sc, mElement: kAudioObjectPropertyElementMain) }
var pa = a(kAudioHardwarePropertyDevices); var sz: UInt32 = 0
AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &pa, 0, nil, &sz)
var ids = [AudioDeviceID](repeating: 0, count: Int(sz) / 4); AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &pa, 0, nil, &sz, &ids)
var dev: AudioDeviceID = 0
for d in ids { var na = a(kAudioObjectPropertyName); var n: Unmanaged<CFString>?; var s2 = UInt32(8); AudioObjectGetPropertyData(d, &na, 0, nil, &s2, &n)
  if let v = n?.takeRetainedValue() as String?, v.contains(want) { dev = d; break } }
var b = buf; var ba = a(kAudioDevicePropertyBufferFrameSize); AudioObjectSetPropertyData(dev, &ba, 0, nil, 4, &b)
final class St { var calls = 0, gaps = 0, over = 0, last: UInt64 = 0, lastN: UInt32 = 0, maxGap = 0.0 }
let st = St(); var tb = mach_timebase_info(); mach_timebase_info(&tb); let hz = 1e9 * Double(tb.denom) / Double(tb.numer)
var oa = a(kAudioDeviceProcessorOverload)
AudioObjectAddPropertyListenerBlock(dev, &oa, nil) { _, _ in st.over += 1; print(String(format: "%7.1f s surcharge", Date().timeIntervalSince(t0))); fflush(stdout) }
var desc = AudioComponentDescription(componentType: kAudioUnitType_Output, componentSubType: kAudioUnitSubType_HALOutput, componentManufacturer: kAudioUnitManufacturer_Apple, componentFlags: 0, componentFlagsMask: 0)
var u: AudioUnit?; AudioComponentInstanceNew(AudioComponentFindNext(nil, &desc)!, &u)
AudioUnitSetProperty(u!, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &dev, 4)
var cb = AURenderCallbackStruct(inputProc: { ref, fl, ts, _, n, abl in
  let s = Unmanaged<St>.fromOpaque(ref).takeUnretainedValue(); s.calls += 1
  let h = ts.pointee.mHostTime
  if s.last != 0 { let got = Double(h - s.last) / hz, exp = Double(s.lastN) / 48000; if abs(got - exp) > 0.5 * exp { s.gaps += 1; s.maxGap = max(s.maxGap, got * 1000) } }
  s.last = h; s.lastN = n
  for b in UnsafeMutableAudioBufferListPointer(abl!) { memset(b.mData, 0, Int(b.mDataByteSize)) }
  return noErr }, inputProcRefCon: Unmanaged.passUnretained(st).toOpaque())
AudioUnitSetProperty(u!, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, UInt32(MemoryLayout<AURenderCallbackStruct>.size))
AudioUnitInitialize(u!); AudioOutputUnitStart(u!)
let t0 = Date()
var gb: UInt32 = 0; var s4 = UInt32(4); AudioObjectGetPropertyData(dev, &ba, 0, nil, &s4, &gb)
print("carte \(dev), tampon \(gb)"); fflush(stdout)
while Date().timeIntervalSince(t0) < secs { RunLoop.main.run(until: Date().addingTimeInterval(60))
  print(String(format: "%5.0f s : rappels %d, surcharges %d, retards %d (max %.1f ms)", Date().timeIntervalSince(t0), st.calls, st.over, st.gaps, st.maxGap)); fflush(stdout) }
AudioOutputUnitStop(u!)
