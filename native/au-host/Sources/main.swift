// Hôte Audio Unit minimal, hors temps réel (prototype V14b, étape 2).
//
//   au-host list                                   Audio Units d'effet installés
//   au-host params <type> <sous-type> <fabricant>  paramètres d'un plugin
//   au-host process <type> <sous-type> <fabricant> in.wav out.wav [adresse=valeur ...] [--tail s]
//   au-host gen tones|impulse out.wav              signal de test (48 kHz, stéréo)
//   au-host analyse file.wav [fréquence ...]       niveau global, niveau par fréquence, pics
import AVFoundation
import AudioToolbox

func fourCC(_ s: String) -> OSType {
    var r: OSType = 0
    for c in s.utf8.prefix(4) { r = (r << 8) | OSType(c) }
    for _ in s.utf8.count..<4 { r = (r << 8) | 0x20 }   // « dls » → « dls  »
    return r
}
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

func desc(_ a: ArraySlice<String>) -> AudioComponentDescription {
    let v = Array(a)
    guard v.count >= 3 else { fail("type, sous-type et fabricant attendus (ex. : aufx lpas appl)") }
    return AudioComponentDescription(componentType: fourCC(v[0]), componentSubType: fourCC(v[1]),
                                     componentManufacturer: fourCC(v[2]), componentFlags: 0, componentFlagsMask: 0)
}

func load(_ d: AudioComponentDescription) async -> AVAudioUnit {
    do { return try await AVAudioUnit.instantiate(with: d, options: []) }
    catch { fail("Plugin introuvable ou refusé : \(error)") }
}

func readAll(_ url: URL) -> AVAudioPCMBuffer {
    do {
        let f = try AVAudioFile(forReading: url)
        let b = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: AVAudioFrameCount(f.length))!
        try f.read(into: b)
        return b
    } catch { fail("Lecture impossible de \(url.path) : \(error)") }
}

func write(_ b: AVAudioPCMBuffer, _ url: URL) {
    do {
        var s = b.format.settings
        s[AVLinearPCMIsNonInterleaved] = false   // un fichier WAV est toujours entrelacé
        let f = try AVAudioFile(forWriting: url, settings: s, commonFormat: .pcmFormatFloat32, interleaved: false)
        try f.write(from: b)
    } catch { fail("Écriture impossible de \(url.path) : \(error)") }
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("Commandes : list, params, process, gen, analyse") }

switch args[1] {
case "list":
    let any = AudioComponentDescription(componentType: kAudioUnitType_Effect, componentSubType: 0, componentManufacturer: 0, componentFlags: 0, componentFlagsMask: 0)
    for c in AVAudioUnitComponentManager.shared().components(matching: any) {
        print(c.audioComponentDescription.componentSubType, c.manufacturerName, "-", c.name)
    }

case "params":
    let u = await load(desc(args[2...]))
    print("Plugin :", u.name, "| latence déclarée :", u.auAudioUnit.latency * 1000, "ms | traîne :", u.auAudioUnit.tailTime, "s")
    for p in u.auAudioUnit.parameterTree?.allParameters ?? [] {
        print("  \(p.address)\t\(p.displayName)\t\(p.minValue)…\(p.maxValue) \(p.unitName ?? "")\t= \(p.value)")
    }

case "process":
    guard args.count >= 7 else { fail("process <type> <sous-type> <fabricant> in.wav out.wav [adresse=valeur ...] [--tail s]") }
    let u = await load(desc(args[2...4]))
    let input = readAll(URL(fileURLWithPath: args[5]))
    var tail = 0.0
    var i = 7
    while i < args.count {
        if args[i] == "--tail", i + 1 < args.count { tail = Double(args[i + 1]) ?? 0; i += 2; continue }
        let kv = args[i].split(separator: "=")
        guard kv.count == 2, let a = UInt64(kv[0]), let v = Float(kv[1]) else { fail("Paramètre mal écrit : \(args[i])") }
        guard let p = u.auAudioUnit.parameterTree?.parameter(withAddress: a) else { fail("Paramètre inconnu : \(a)") }
        p.value = v
        i += 1
    }
    let fmt = input.format, sr = fmt.sampleRate
    let engine = AVAudioEngine(), player = AVAudioPlayerNode()
    engine.attach(player); engine.attach(u)
    engine.connect(player, to: u, format: fmt)
    engine.connect(u, to: engine.mainMixerNode, format: fmt)
    do {
        try engine.enableManualRenderingMode(.offline, format: fmt, maximumFrameCount: 512)
        try engine.start()
    } catch { fail("Moteur : \(error)") }
    player.scheduleBuffer(input, completionHandler: nil)
    player.play()
    let total = AVAudioFrameCount(Double(input.frameLength) + tail * sr)
    let out = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: total)!
    let block = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 512)!
    let t0 = Date()
    while out.frameLength < total {
        let n = min(512, total - out.frameLength)
        do {
            guard try engine.renderOffline(n, to: block) == .success else { fail("Rendu interrompu") }
        } catch { fail("Rendu : \(error)") }
        for c in 0..<Int(fmt.channelCount) {
            memcpy(out.floatChannelData![c] + Int(out.frameLength), block.floatChannelData![c], Int(block.frameLength) * 4)
        }
        out.frameLength += block.frameLength
    }
    let dt = Date().timeIntervalSince(t0), dur = Double(total) / sr
    engine.stop()
    write(out, URL(fileURLWithPath: args[6]))
    print(String(format: "Plugin : %@ | latence déclarée : %.2f ms | %.2f s de son traités en %.1f ms (%.0f× le temps réel), blocs de 512",
                 u.name, u.auAudioUnit.latency * 1000, dur, dt * 1000, dur / dt))

case "gen":
    guard args.count >= 4 else { fail("gen tones|impulse out.wav") }
    let sr = 48000.0, n = AVAudioFrameCount(sr * 3)
    let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 2)!
    let b = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: n)!
    b.frameLength = n
    for c in 0..<2 {
        let d = b.floatChannelData![c]
        for k in 0..<Int(n) {
            if args[2] == "tones" {
                // 200 Hz (doit passer un passe-bas) + 8 kHz (doit être coupé), même niveau.
                d[k] = Float(0.25 * sin(2 * .pi * 200 * Double(k) / sr) + 0.25 * sin(2 * .pi * 8000 * Double(k) / sr))
            } else {
                d[k] = k == Int(sr * 0.5) ? 0.8 : 0   // impulsion unique à 0,5 s
            }
        }
    }
    write(b, URL(fileURLWithPath: args[3]))

case "analyse":
    guard args.count >= 3 else { fail("analyse file.wav [fréquence ...]") }
    let b = readAll(URL(fileURLWithPath: args[2])), sr = b.format.sampleRate, n = Int(b.frameLength)
    let d = b.floatChannelData![0]
    var e = 0.0
    for k in 0..<n { e += Double(d[k] * d[k]) }
    print(String(format: "%@ : %.3f s, niveau global %.1f dBFS", (args[2] as NSString).lastPathComponent, Double(n) / sr, 10 * log10(max(e / Double(n), 1e-20))))
    for f in args.dropFirst(3).compactMap(Double.init) {
        // Goertzel : amplitude de la composante à f Hz.
        let w = 2 * .pi * f / sr, cw = 2 * cos(w)
        var s1 = 0.0, s2 = 0.0
        for k in 0..<n { let s = Double(d[k]) + cw * s1 - s2; s2 = s1; s1 = s }
        let amp = sqrt(s1 * s1 + s2 * s2 - cw * s1 * s2) * 2 / Double(n)
        print(String(format: "  %6.0f Hz : %.1f dBFS", f, 20 * log10(max(amp, 1e-10))))
    }
    // Pics isolés (> -40 dBFS, espacés d'au moins 10 ms) : utile pour l'impulsion et ses échos.
    var peaks: [(Int, Float)] = []
    var k = 0
    while k < n {
        if abs(d[k]) > 0.01 {
            var m = k
            let end = min(n, k + Int(sr * 0.01))
            for j in k..<end where abs(d[j]) > abs(d[m]) { m = j }
            peaks.append((m, d[m])); k = end
        } else { k += 1 }
    }
    for (p, v) in peaks.prefix(8) { print(String(format: "  pic à %.4f s (%.1f dBFS)", Double(p) / sr, 20 * log10(abs(Double(v))))) }

default:
    fail("Commande inconnue : \(args[1])")
}
