// SPIKE-1 / macOS — warm first-buffer latency of AVSpeechSynthesizer.write(_:toBufferCallback:)
//
// WHAT IT MEASURES
//   t0 = the instant `synth.write(utterance)` is called
//   t1 = the first invocation of the buffer callback carrying a NON-EMPTY AVAudioPCMBuffer
//   first-buffer latency = t1 - t0, in a process that has already synthesized at least once.
//
// WHY
//   docs/design/010-provider-seam-and-resident-service.md section 8.2 (SPIKE-1) gates milestone M9
//   on this number. Pass condition: median warm first-buffer <= 150 ms, leaving >= 350 ms of the
//   500 ms R4.2 budget. Falsifier: a median above 350 ms — residency alone would then not buy the
//   budget and the neural engine returns to the critical path.
//
// SILENCE (PITFALLS P31)
//   `write(_:toBufferCallback:)` is headless by construction: it renders to PCM buffers and never
//   opens an audio device. This probe NEVER calls speakUtterance and NEVER spawns a player.
//   Do not add one. The author is voice-first and sits at this machine.
//
// RUN
//   swiftc -O scripts/spikes/spike1-macos-firstbuffer.swift -o /tmp/spike1 && /tmp/spike1
//   flags: --n <count>   warm utterances per arm (default 20)
//          --idle <sec>  idle-hold window for the RSS/CPU sample (default 10)
//          --json        emit the raw arrays as JSON as well as the table

import AVFoundation
import Foundation
import Darwin

// ── args ─────────────────────────────────────────────────────────────────────
var warmN = 20
var idleSeconds = 10.0
var wantJson = false
do {
  var it = CommandLine.arguments.dropFirst().makeIterator()
  while let a = it.next() {
    switch a {
    case "--n": if let v = it.next(), let i = Int(v) { warmN = i }
    case "--idle": if let v = it.next(), let d = Double(v) { idleSeconds = d }
    case "--json": wantJson = true
    default: break
    }
  }
}

// ── corpus: a real agent reply, sentence-split. Length distribution is honest. ─
// Source: a routine assistant reply of the kind this plugin speaks aloud.
let sentences: [String] = [
  "I read the three design documents and the measurement pass before changing anything.",
  "The gap you are hearing between sentences is the audio device, not the process spawn.",
  "Process fork and exec costs about two milliseconds, which is a rounding error here.",
  "The temp file round trip is a third of a millisecond, so removing it buys nothing.",
  "That leaves roughly eight hundred and ninety milliseconds of CoreAudio device open and teardown.",
  "So the milestone should be scoped as holding the device open across chunks.",
  "Pooling player processes while still opening the device per chunk would ship and change nothing.",
  "I also checked whether the synthesizer itself is on the critical path.",
  "A real sentence through the system synthesizer takes about one point one seconds end to end.",
  "That is already twice the five hundred millisecond budget with playback set to zero.",
  "The neural engine synthesizes the same sentence in about sixty milliseconds.",
  "But the command line tool only returns once the entire wave file has been written.",
  "The streaming API delivers buffers as they are produced, which is a different quantity.",
  "Nobody has measured the time from the write call to the first buffer in a warm process.",
  "That single number decides whether the milestone builds a service or swaps an engine.",
  "If it is under one hundred and fifty milliseconds, residency alone buys the budget.",
  "If it is above three hundred and fifty, the neural engine returns to the critical path.",
  "I have written the probe so that it never opens an audio device or plays a sample.",
  "The equivalent probes for Windows and Linux are committed but remain unmeasured.",
  "I will report the median, the spread, the cold start penalty and the idle cost.",
]

// ── high-resolution clock ────────────────────────────────────────────────────
@inline(__always) func nowNs() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
@inline(__always) func msSince(_ t0: UInt64) -> Double { Double(nowNs() - t0) / 1_000_000.0 }

// ── stats ────────────────────────────────────────────────────────────────────
func pct(_ xs: [Double], _ p: Double) -> Double {
  guard !xs.isEmpty else { return .nan }
  let s = xs.sorted()
  if s.count == 1 { return s[0] }
  let idx = p * Double(s.count - 1)
  let lo = Int(idx.rounded(.down)), hi = Int(idx.rounded(.up))
  if lo == hi { return s[lo] }
  return s[lo] + (s[hi] - s[lo]) * (idx - Double(lo))
}
func f(_ d: Double) -> String { String(format: "%.1f", d) }

// ── process resource sampling ────────────────────────────────────────────────
func rssBytes() -> UInt64 {
  var info = task_vm_info_data_t()
  var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
  let kr = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
      task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
    }
  }
  return kr == KERN_SUCCESS ? info.phys_footprint : 0
}
func cpuSeconds() -> Double {
  var u = rusage()
  guard getrusage(RUSAGE_SELF, &u) == 0 else { return .nan }
  let user = Double(u.ru_utime.tv_sec) + Double(u.ru_utime.tv_usec) / 1e6
  let sys  = Double(u.ru_stime.tv_sec) + Double(u.ru_stime.tv_usec) / 1e6
  return user + sys
}

// ── the measured unit ────────────────────────────────────────────────────────
/// One synthesis. Returns (firstBufferMs, totalMs, frames, buffers, wordCallbacks).
/// Blocks on the current run loop until the terminating empty buffer arrives.
final class Recorder: NSObject, AVSpeechSynthesizerDelegate {
  var wordRanges: [NSRange] = []
  func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange,
                         utterance u: AVSpeechUtterance) { wordRanges.append(r) }
}

struct Sample {
  let firstBufferMs: Double
  /// Time to the first buffer containing a sample above the silence floor. A non-empty buffer of
  /// zeros would make `firstBufferMs` optimistic; this is the control that would catch it.
  let firstAudibleMs: Double
  let totalMs: Double
  let frames: Int
  let buffers: Int
  let words: Int
  let sampleRate: Double
  let firstBufferPeak: Float
}

/// Peak absolute sample in a buffer, across whichever representation AVFoundation handed us.
func peak(_ pcm: AVAudioPCMBuffer) -> Float {
  let n = Int(pcm.frameLength)
  guard n > 0 else { return 0 }
  var m: Float = 0
  if let ch = pcm.floatChannelData {
    for i in 0..<n { m = max(m, abs(ch[0][i])) }
  } else if let ch = pcm.int16ChannelData {
    for i in 0..<n { m = max(m, abs(Float(ch[0][i])) / 32768.0) }
  } else if let ch = pcm.int32ChannelData {
    for i in 0..<n { m = max(m, abs(Float(ch[0][i])) / 2147483648.0) }
  }
  return m
}

func synthesize(_ synth: AVSpeechSynthesizer, _ rec: Recorder,
                _ utterance: AVSpeechUtterance, timeout: TimeInterval = 20) -> Sample? {
  rec.wordRanges.removeAll()
  var firstBufferNs: UInt64 = 0
  var firstAudibleNs: UInt64 = 0
  var endNs: UInt64 = 0
  var frames = 0
  var buffers = 0
  var rate = 0.0
  var firstPeak: Float = 0
  var done = false
  let lock = NSLock()
  let silenceFloor: Float = 0.001

  let t0 = nowNs()
  synth.write(utterance) { buf in
    let t = nowNs()
    guard let pcm = buf as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 {
      // AVFoundation signals end-of-stream with a zero-length buffer.
      lock.lock(); endNs = t; done = true; lock.unlock()
      return
    }
    let p = peak(pcm)
    lock.lock(); defer { lock.unlock() }
    if firstBufferNs == 0 { firstBufferNs = t; firstPeak = p; rate = pcm.format.sampleRate }
    if firstAudibleNs == 0 && p > silenceFloor { firstAudibleNs = t }
    buffers += 1
    frames += Int(pcm.frameLength)
  }

  let deadline = Date().addingTimeInterval(timeout)
  while true {
    lock.lock(); let d = done; lock.unlock()
    if d { break }
    if Date() >= deadline { return nil }
    RunLoop.current.run(until: Date().addingTimeInterval(0.002))
  }
  guard firstBufferNs != 0 else { return nil }
  return Sample(firstBufferMs: Double(firstBufferNs - t0) / 1e6,
                firstAudibleMs: firstAudibleNs == 0 ? .nan : Double(firstAudibleNs - t0) / 1e6,
                totalMs: Double(endNs - t0) / 1e6,
                frames: frames, buffers: buffers, words: rec.wordRanges.count,
                sampleRate: rate, firstBufferPeak: firstPeak)
}

func plainUtterance(_ s: String, voice: AVSpeechSynthesisVoice?) -> AVSpeechUtterance {
  let u = AVSpeechUtterance(string: s)
  u.voice = voice
  return u
}

/// SSML arm. `<speak>` wrapper only — no prosody tags — so the arm isolates the cost of the SSML
/// PARSE PATH rather than measuring a different utterance.
func ssmlUtterance(_ s: String, voice: AVSpeechSynthesisVoice?) -> AVSpeechUtterance? {
  let escaped = s
    .replacingOccurrences(of: "&", with: "&amp;")
    .replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;")
  guard let u = AVSpeechUtterance(ssmlRepresentation: "<speak>\(escaped)</speak>") else { return nil }
  u.voice = voice
  return u
}

// ── run ──────────────────────────────────────────────────────────────────────
let voice = AVSpeechSynthesisVoice(language: "en-US")
let synth = AVSpeechSynthesizer()
let rec = Recorder()
synth.delegate = rec

print("SPIKE1_PROBE=macos-firstbuffer")
print("SPIKE1_VOICE=\(voice?.identifier ?? "nil") quality=\(voice?.quality.rawValue ?? -1)")
print("SPIKE1_WARM_N=\(warmN)")
print("SPIKE1_RSS_AT_START_BYTES=\(rssBytes())")

// ── ARM 0: COLD. The first write() in this process. Reported alone, never averaged in. ──
let coldStartRss = rssBytes()
guard let cold = synthesize(synth, rec, plainUtterance(sentences[0], voice: voice)) else {
  print("SPIKE1_ERROR=cold synthesis produced no buffer"); exit(1)
}
print("SPIKE1_COLD_FIRSTBUFFER_MS=\(f(cold.firstBufferMs))")
print("SPIKE1_COLD_FIRSTAUDIBLE_MS=\(f(cold.firstAudibleMs))")
print("SPIKE1_FORMAT_SAMPLERATE=\(cold.sampleRate) audioSeconds=\(f(Double(cold.frames)/cold.sampleRate))")
print("SPIKE1_COLD_TOTAL_MS=\(f(cold.totalMs)) frames=\(cold.frames) buffers=\(cold.buffers) words=\(cold.words)")
print("SPIKE1_RSS_AFTER_FIRST_SYNTH_BYTES=\(rssBytes()) delta=\(rssBytes() &- coldStartRss)")

// ── ARM 1: WARM, plain string ──
var warm: [Sample] = []
for i in 0..<warmN {
  let s = sentences[(i + 1) % sentences.count]
  guard let smp = synthesize(synth, rec, plainUtterance(s, voice: voice)) else {
    print("SPIKE1_ERROR=warm sample \(i) timed out"); exit(1)
  }
  warm.append(smp)
}
let warmFb = warm.map { $0.firstBufferMs }
print("SPIKE1_WARM_FIRSTBUFFER_MS_RAW=\(warmFb.map { f($0) }.joined(separator: " "))")
print("SPIKE1_WARM_FIRSTBUFFER_MIN=\(f(warmFb.min()!)) P50=\(f(pct(warmFb,0.5))) P95=\(f(pct(warmFb,0.95))) MAX=\(f(warmFb.max()!)) N=\(warmFb.count)")
let warmAud = warm.map { $0.firstAudibleMs }
print("SPIKE1_WARM_FIRSTAUDIBLE_MS_RAW=\(warmAud.map { f($0) }.joined(separator: " "))")
print("SPIKE1_WARM_FIRSTAUDIBLE_MIN=\(f(warmAud.min()!)) P50=\(f(pct(warmAud,0.5))) P95=\(f(pct(warmAud,0.95))) MAX=\(f(warmAud.max()!)) N=\(warmAud.count)")
print("SPIKE1_WARM_FIRSTBUFFER_PEAKS=\(warm.map { String(format: "%.4f", $0.firstBufferPeak) })")
print("SPIKE1_WARM_REALTIME_FACTOR=\(warm.map { f((Double($0.frames)/$0.sampleRate*1000.0)/$0.totalMs) })")
let warmTotals = warm.map { $0.totalMs }
print("SPIKE1_WARM_TOTAL_MS_P50=\(f(pct(warmTotals,0.5))) MIN=\(f(warmTotals.min()!)) MAX=\(f(warmTotals.max()!))")
print("SPIKE1_WARM_WORDCALLBACKS=\(warm.map { $0.words })")
print("SPIKE1_WARM_BUFFERS=\(warm.map { $0.buffers })")
print("SPIKE1_COLD_PENALTY_MS=\(f(cold.firstBufferMs - pct(warmFb,0.5)))")

// ── ARM 2: WARM, SSML ──
var ssml: [Sample] = []
var ssmlSupported = true
for i in 0..<warmN {
  let s = sentences[(i + 1) % sentences.count]
  guard let u = ssmlUtterance(s, voice: voice) else { ssmlSupported = false; break }
  guard let smp = synthesize(synth, rec, u) else {
    print("SPIKE1_ERROR=ssml sample \(i) timed out"); exit(1)
  }
  ssml.append(smp)
}
if ssmlSupported && !ssml.isEmpty {
  let fb = ssml.map { $0.firstBufferMs }
  print("SPIKE1_SSML_INIT=ok")
  print("SPIKE1_SSML_FIRSTBUFFER_MS_RAW=\(fb.map { f($0) }.joined(separator: " "))")
  print("SPIKE1_SSML_FIRSTBUFFER_MIN=\(f(fb.min()!)) P50=\(f(pct(fb,0.5))) P95=\(f(pct(fb,0.95))) MAX=\(f(fb.max()!)) N=\(fb.count)")
  print("SPIKE1_SSML_MINUS_PLAIN_P50_MS=\(f(pct(fb,0.5) - pct(warmFb,0.5)))")
  print("SPIKE1_SSML_WORDCALLBACKS=\(ssml.map { $0.words })")
} else {
  print("SPIKE1_SSML_INIT=nil — AVSpeechUtterance(ssmlRepresentation:) returned nil")
}

// ── ARM 3: IDLE COST. A process that has synthesized and is now waiting. ──
let idleRss0 = rssBytes()
let idleCpu0 = cpuSeconds()
let idleT0 = nowNs()
let idleDeadline = Date().addingTimeInterval(idleSeconds)
while Date() < idleDeadline { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
let idleWallMs = msSince(idleT0)
let idleRss1 = rssBytes()
let idleCpu1 = cpuSeconds()
print("SPIKE1_IDLE_WINDOW_S=\(f(idleWallMs / 1000.0))")
print("SPIKE1_IDLE_RSS_BEFORE_BYTES=\(idleRss0)")
print("SPIKE1_IDLE_RSS_AFTER_BYTES=\(idleRss1)")
print("SPIKE1_IDLE_RSS_AFTER_MB=\(f(Double(idleRss1) / 1_048_576.0))")
print("SPIKE1_IDLE_CPU_SECONDS=\(String(format: "%.4f", idleCpu1 - idleCpu0))")
print("SPIKE1_IDLE_CPU_PERCENT=\(String(format: "%.3f", (idleCpu1 - idleCpu0) / (idleWallMs / 1000.0) * 100.0))")
print("SPIKE1_TOTAL_CPU_SECONDS=\(String(format: "%.4f", idleCpu1))")

// ── verdict against 010 section 8.2 ──
// Gated on the CONSERVATIVE quantity — first audible sample, not first non-empty buffer.
let median = pct(warmAud, 0.5)
let verdict = median <= 150 ? "PASS" : (median > 350 ? "FAIL-FALSIFIES-010" : "MARGINAL")
print("SPIKE1_VERDICT=\(verdict) medianFirstAudible=\(f(median)) medianFirstBuffer=\(f(pct(warmFb,0.5))) pass<=150 falsifier>350")

if wantJson {
  let obj: [String: Any] = [
    "probe": "spike1-macos-firstbuffer",
    "coldFirstBufferMs": cold.firstBufferMs,
    "warmFirstBufferMs": warmFb,
    "warmTotalMs": warmTotals,
    "ssmlFirstBufferMs": ssml.map { $0.firstBufferMs },
    "idleRssBytes": idleRss1,
    "idleCpuSeconds": idleCpu1 - idleCpu0,
    "idleWindowSeconds": idleWallMs / 1000.0,
    "verdict": verdict,
  ]
  if let d = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
     let s = String(data: d, encoding: .utf8) {
    print("SPIKE1_JSON=\(s)")
  }
}
