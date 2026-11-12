// Prototype V14b, étape 3 : l'hôte en temps réel, sur la carte son.
//
// Mesure de latence sans larsen : on ne renvoie jamais le micro vers les haut-parleurs. Un clic est
// produit en temps réel, passe (ou non) par un plugin AU, sort sur les haut-parleurs, et le micro l'enregistre.
// Les deux côtés sont datés avec l'horloge de la machine (mHostTime) : l'écart donne le trajet réel.
import AVFoundation
import AudioToolbox
import CoreAudio

// ---------- Propriétés Core Audio ----------
func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func u32(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32 {
    var a = addr(sel, scope), v: UInt32 = 0, size = UInt32(4)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == noErr ? v : 0
}
func devName(_ id: AudioDeviceID) -> String {
    var a = addr(kAudioObjectPropertyName), n: Unmanaged<CFString>?, size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, &n) == noErr, let s = n?.takeRetainedValue() else { return "?" }
    return s as String
}
func allDevices() -> [AudioDeviceID] {
    var a = addr(kAudioHardwarePropertyDevices), size: UInt32 = 0
    let sys = AudioObjectID(kAudioObjectSystemObject)
    AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size)
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / 4)
    AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids)
    return ids
}
func channelCount(_ id: AudioDeviceID, _ scope: AudioObjectPropertyScope) -> Int {
    var a = addr(kAudioDevicePropertyStreamConfiguration, scope), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let p = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
    defer { p.deallocate() }
    guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, p) == noErr else { return 0 }
    return UnsafeMutableAudioBufferListPointer(p.assumingMemoryBound(to: AudioBufferList.self)).reduce(0) { $0 + Int($1.mNumberChannels) }
}
func findDevice(_ part: String, _ scope: AudioObjectPropertyScope) -> AudioDeviceID {
    guard let d = allDevices().first(where: { devName($0).localizedCaseInsensitiveContains(part) && channelCount($0, scope) > 0 }) else {
        fail("Périphérique introuvable : \(part)")
    }
    return d
}
func setBufferSize(_ id: AudioDeviceID, _ frames: UInt32) {
    var a = addr(kAudioDevicePropertyBufferFrameSize), v = frames
    AudioObjectSetPropertyData(id, &a, 0, nil, UInt32(4), &v)
}
/// Latence déclarée d'un sens (en échantillons) : appareil + marge de sécurité + flux + tampon.
func declared(_ id: AudioDeviceID, _ scope: AudioObjectPropertyScope) -> (dev: UInt32, safety: UInt32, stream: UInt32, buffer: UInt32) {
    var a = addr(kAudioDevicePropertyStreams, scope), size: UInt32 = 0, stream: UInt32 = 0
    if AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size >= 4 {
        var ids = [AudioStreamID](repeating: 0, count: Int(size) / 4)
        AudioObjectGetPropertyData(id, &a, 0, nil, &size, &ids)
        stream = u32(ids[0], kAudioStreamPropertyLatency)
    }
    return (u32(id, kAudioDevicePropertyLatency, scope), u32(id, kAudioDevicePropertySafetyOffset, scope), stream, u32(id, kAudioDevicePropertyBufferFrameSize))
}

let hostHz = Double(AudioGetHostClockFrequency())

// ---------- Mémoire préallouée, écrite par le fil audio ----------
final class Capture {
    let cap: Int, data: UnsafeMutablePointer<Float>
    var n = 0
    var blockStart = [Int](repeating: 0, count: 1 << 16), blockHost = [UInt64](repeating: 0, count: 1 << 16), blocks = 0
    init(seconds: Double, sr: Double) { cap = Int(seconds * sr); data = .allocate(capacity: cap) }
    /// Instant (horloge machine, en s) de l'échantillon i.
    func time(_ i: Int, _ sr: Double) -> Double {
        var b = 0
        while b + 1 < blocks && blockStart[b + 1] <= i { b += 1 }
        return Double(blockHost[b]) / hostHz + Double(i - blockStart[b]) / sr
    }
}
final class Clicker {
    var frame = 0, every = 0, first = 0, len = 0, freq = 2000.0, amp: Float = 0.3
    var clickHost = [Double](repeating: 0, count: 256), clicks = 0
    var lastHost: UInt64 = 0, lastFrames: UInt32 = 0, gaps = 0, maxGap = 0.0
}

func measureOnce(spk: AudioDeviceID, mic: AudioDeviceID, buffer: UInt32, plugin: AVAudioUnit?, clicks: Int, amp: Float) async -> (lat: [Double], misses: Int, sr: Double) {
    setBufferSize(spk, buffer); setBufferSize(mic, buffer)
    let outE = AVAudioEngine(), inE = AVAudioEngine()
    do {
        try outE.outputNode.auAudioUnit.setDeviceID(spk)
        try inE.inputNode.auAudioUnit.setDeviceID(mic)
    } catch { fail("Choix du périphérique : \(error)") }
    let sr = outE.outputNode.outputFormat(forBus: 0).sampleRate
    let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!

    let ck = Clicker()
    ck.every = Int(0.6 * sr); ck.first = Int(0.8 * sr); ck.len = Int(0.006 * sr); ck.amp = amp
    let src = AVAudioSourceNode(format: fmt) { _, ts, frames, abl -> OSStatus in
        let out = UnsafeMutableAudioBufferListPointer(abl)[0].mData!.assumingMemoryBound(to: Float.self)
        let host = ts.pointee.mHostTime
        for k in 0..<Int(frames) {
            let f = ck.frame + k, rel = f - ck.first
            var v: Float = 0
            if rel >= 0 && ck.clicks < clicks {
                let p = rel % ck.every
                if p == 0 && rel / ck.every == ck.clicks {
                    ck.clickHost[ck.clicks] = Double(host) / hostHz + Double(k) / sr; ck.clicks += 1
                }
                if p < ck.len && rel / ck.every < clicks { v = ck.amp * Float(sin(2 * .pi * ck.freq * Double(p) / sr)) }
            }
            out[k] = v
        }
        ck.frame += Int(frames)
        return noErr
    }
    outE.attach(src)
    if let p = plugin {
        outE.attach(p)
        outE.connect(src, to: p, format: fmt)
        outE.connect(p, to: outE.mainMixerNode, format: fmt)
    } else {
        outE.connect(src, to: outE.mainMixerNode, format: fmt)
    }

    let total = Double(clicks) * 0.6 + 1.5
    let cap = Capture(seconds: total + 1, sr: sr)
    let inFmt = inE.inputNode.outputFormat(forBus: 0)
    let sink = AVAudioSinkNode { ts, frames, abl -> OSStatus in
        let d = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: abl))[0].mData!.assumingMemoryBound(to: Float.self)
        if cap.blocks < cap.blockStart.count { cap.blockStart[cap.blocks] = cap.n; cap.blockHost[cap.blocks] = ts.pointee.mHostTime; cap.blocks += 1 }
        let m = min(Int(frames), cap.cap - cap.n)
        if m > 0 { cap.data.advanced(by: cap.n).update(from: d, count: m); cap.n += m }
        return noErr
    }
    inE.attach(sink)
    inE.connect(inE.inputNode, to: sink, format: inFmt)
    do { try inE.start(); try outE.start() } catch { fail("Démarrage : \(error)") }
    try? await Task.sleep(nanoseconds: UInt64(total * 1e9))
    outE.stop(); inE.stop()

    let isr = inFmt.sampleRate
    var lat: [Double] = [], misses = 0
    for c in 0..<ck.clicks {
        let tc = ck.clickHost[c]
        // Échantillon du micro correspondant à l'instant du clic.
        guard let i0 = (0..<cap.n).first(where: { cap.time($0, isr) >= tc }) else { misses += 1; continue }
        var floor: Float = 0
        for i in max(0, i0 - Int(0.1 * isr))..<i0 { floor = max(floor, abs(cap.data[i])) }
        let thr = max(0.003, floor * 5)
        if let hit = (i0..<min(cap.n, i0 + Int(0.4 * isr))).first(where: { abs(cap.data[$0]) > thr }) {
            lat.append((cap.time(hit, isr) - tc) * 1000)
        } else { misses += 1 }
    }
    cap.data.deallocate()
    return (lat, misses, sr)
}

func runRealtime(_ a: [String]) async {
    // rt [tampons ...] : mesure, pour chaque taille de tampon, sans plugin puis avec AULowpass.
    let spk = findDevice("Haut-parleurs", kAudioObjectPropertyScopeOutput)
    let mic = findDevice("Micro", kAudioObjectPropertyScopeInput)
    print("Sortie : \(devName(spk)) | Entrée : \(devName(mic))")
    let sizes = a.compactMap { UInt32($0) }.isEmpty ? [512, 256, 128, 64] : a.compactMap { UInt32($0) }
    let lp = await load(AudioComponentDescription(componentType: kAudioUnitType_Effect, componentSubType: fourCC("lpas"), componentManufacturer: fourCC("appl"), componentFlags: 0, componentFlagsMask: 0))
    lp.auAudioUnit.parameterTree?.parameter(withAddress: 0)?.value = 18000   // presque transparent : on mesure le trajet, pas l'effet
    for b in sizes {
        for plug in [nil, lp] as [AVAudioUnit?] {
            let r = await measureOnce(spk: spk, mic: mic, buffer: b, plugin: plug, clicks: 8, amp: 0.3)
            let o = declared(spk, kAudioObjectPropertyScopeOutput), i = declared(mic, kAudioObjectPropertyScopeInput)
            let decl = Double(o.dev + o.safety + o.stream + o.buffer + i.dev + i.safety + i.stream + i.buffer) / r.sr * 1000
            let s = r.lat.sorted()
            let med = s.isEmpty ? .nan : s[s.count / 2]
            print(String(format: "tampon %4d | %@ | déclaré %.1f ms (sortie %d+%d+%d+%d, entrée %d+%d+%d+%d) | mesuré : médiane %.1f ms, min %.1f, max %.1f, ratés %d/%d | aller-retour d'une appli ≈ médiane + 2 tampons = %.1f ms",
                         b, plug == nil ? "sans plugin " : "AULowpass   ", decl, o.dev, o.safety, o.stream, o.buffer, i.dev, i.safety, i.stream, i.buffer,
                         med, s.first ?? .nan, s.last ?? .nan, r.misses, r.misses + r.lat.count, med + 2 * Double(b) / r.sr * 1000))
        }
    }
}

// ---------- Tenue dans la durée ----------
func runStress(_ a: [String]) async {
    // stress <secondes> <tampon> <nombre de plugins> : chaîne de plugins en temps réel sur les haut-parleurs,
    // signal à -100 dBFS (inaudible), décompte des surcharges signalées par Core Audio et des trous de rendu.
    let secs = Double(a.first ?? "300") ?? 300, buf = UInt32(a.dropFirst().first ?? "128") ?? 128, count = Int(a.dropFirst(2).first ?? "8") ?? 8
    let spk = findDevice("Haut-parleurs", kAudioObjectPropertyScopeOutput)
    setBufferSize(spk, buf)
    let kinds = ["nbeq", "lpas", "dcmp", "mrev", "dely", "lmtr", "pmeq", "hpas"]
    let e = AVAudioEngine()
    do { try e.outputNode.auAudioUnit.setDeviceID(spk) } catch { fail("Choix du périphérique : \(error)") }
    let sr = e.outputNode.outputFormat(forBus: 0).sampleRate, fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!
    let ck = Clicker()
    var seed: UInt32 = 1
    let src = AVAudioSourceNode(format: fmt) { _, ts, frames, abl -> OSStatus in
        let h = ts.pointee.mHostTime
        if ck.lastHost != 0 {
            let expect = Double(ck.lastFrames) / sr, got = Double(h &- ck.lastHost) / hostHz
            if abs(got - expect) > 0.5 * expect { ck.gaps += 1; ck.maxGap = max(ck.maxGap, got * 1000) }
        }
        ck.lastHost = h; ck.lastFrames = frames
        for buf in UnsafeMutableAudioBufferListPointer(abl) {
            let d = buf.mData!.assumingMemoryBound(to: Float.self)
            for k in 0..<Int(frames) { seed = seed &* 1664525 &+ 1013904223; d[k] = (Float(seed >> 9) / Float(1 << 23) - 0.5) * 2e-5 }
        }
        return noErr
    }
    e.attach(src)
    var prev: AVAudioNode = src
    var names: [String] = []
    for k in 0..<count {
        let u = await load(AudioComponentDescription(componentType: kAudioUnitType_Effect, componentSubType: fourCC(kinds[k % kinds.count]), componentManufacturer: fourCC("appl"), componentFlags: 0, componentFlagsMask: 0))
        e.attach(u); e.connect(prev, to: u, format: fmt); prev = u; names.append(u.name)
    }
    e.connect(prev, to: e.mainMixerNode, format: fmt)
    var overloads = 0
    let q = DispatchQueue(label: "overload")
    var oa = addr(kAudioDeviceProcessorOverload)
    AudioObjectAddPropertyListenerBlock(spk, &oa, q) { _, _ in overloads += 1 }
    do { try e.start() } catch { fail("Démarrage : \(error)") }
    print("Chaîne : \(names.joined(separator: " → ")) | tampon \(buf) (\(String(format: "%.1f", Double(buf) / sr * 1000)) ms) | \(Int(secs)) s")
    let t0 = Date()
    while Date().timeIntervalSince(t0) < secs {
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        print(String(format: "  %3.0f s : surcharges %d, trous de rendu %d", Date().timeIntervalSince(t0), q.sync { overloads }, ck.gaps))
    }
    e.stop()
    print(String(format: "Bilan : surcharges Core Audio %d, trous de rendu %d (plus long %.1f ms)", q.sync { overloads }, ck.gaps, ck.maxGap))
}
