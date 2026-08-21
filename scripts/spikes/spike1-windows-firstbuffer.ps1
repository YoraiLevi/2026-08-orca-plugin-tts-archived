# SPIKE-1 / Windows — warm first-buffer latency of System.Speech SetOutputToAudioStream
#
# STATUS: UNMEASURED. This script has never been executed. It is committed so the number is one
# command away for anyone with a Windows machine, rather than an estimate in a design document.
# Whoever runs it: paste the output into docs/.research/spike1-resident-synth.md section 4 and
# relabel that section's rows from [claimed] to [measured-here] with the machine and date.
#
# WHAT IT MEASURES
#   t0 = the instant Speak()/SpeakSsml() is called on a synthesizer whose output is a Stream
#   t1 = the first Write() into that stream carrying count > 0 bytes
#   The macOS arm measures the callback that delivers the first PCM buffer; on Windows the
#   synthesizer PUSHES into a stream we own, so the first Write with a non-zero count is the same
#   observable event. Design 010 section 8.2 calls this "first Read"; the stream is write-side from
#   the synthesizer's point of view, and this is that boundary.
#
# SILENCE (PITFALLS P31)
#   SetOutputToAudioStream renders to the stream and NEVER opens an audio device.
#   Do NOT add SetOutputToDefaultAudioDevice. Do NOT call SoundPlayer. This probe must stay silent.
#
# PASS CONDITION (010 section 8.2): median warm first-buffer <= 150 ms.
# FALSIFIER: median > 350 ms — residency alone does not buy the R4.2 budget on Windows.
#
# RUN
#   powershell -ExecutionPolicy Bypass -File scripts\spikes\spike1-windows-firstbuffer.ps1
#   optional: -WarmN 20 -IdleSeconds 30
#
# CAVEAT, stated up front (010 section 9, residual U2): whether this sees the OneCore voices or
# only the SAPI 5 *Desktop* voices depends on .NET Framework vs .NET 10. The script prints the voice
# it actually bound so the reader can tell which tier the number belongs to.

param(
  [int]$WarmN = 20,
  [double]$IdleSeconds = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

# A Stream that timestamps the first non-empty Write. This is the instrument; everything else is
# scaffolding around it.
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;

public class FirstWriteProbeStream : Stream {
    public long FirstWriteTicks = -1;
    public long LastWriteTicks  = -1;
    public long TotalBytes      = 0;
    public int  WriteCalls      = 0;
    public long T0Ticks         = 0;

    public void Reset(long t0) {
        FirstWriteTicks = -1; LastWriteTicks = -1; TotalBytes = 0; WriteCalls = 0; T0Ticks = t0;
    }
    public double FirstWriteMs {
        get { return FirstWriteTicks < 0 ? Double.NaN
                   : (FirstWriteTicks - T0Ticks) * 1000.0 / Stopwatch.Frequency; }
    }
    public double TotalMs {
        get { return LastWriteTicks < 0 ? Double.NaN
                   : (LastWriteTicks - T0Ticks) * 1000.0 / Stopwatch.Frequency; }
    }
    public override void Write(byte[] buffer, int offset, int count) {
        if (count > 0) {
            long t = Stopwatch.GetTimestamp();
            if (FirstWriteTicks < 0) FirstWriteTicks = t;
            LastWriteTicks = t;
            TotalBytes += count;
            WriteCalls++;
        }
    }
    public override bool CanRead  { get { return false; } }
    public override bool CanSeek  { get { return false; } }
    public override bool CanWrite { get { return true;  } }
    public override long Length   { get { return TotalBytes; } }
    public override long Position { get { return TotalBytes; } set { } }
    public override void Flush() { }
    public override int Read(byte[] b, int o, int c) { throw new NotSupportedException(); }
    public override long Seek(long o, SeekOrigin s)  { throw new NotSupportedException(); }
    public override void SetLength(long v) { }
}
'@

function Percentile([double[]]$xs, [double]$p) {
  if ($xs.Count -eq 0) { return [double]::NaN }
  $s = $xs | Sort-Object
  if ($s.Count -eq 1) { return $s[0] }
  $idx = $p * ($s.Count - 1)
  $lo = [math]::Floor($idx); $hi = [math]::Ceiling($idx)
  if ($lo -eq $hi) { return $s[[int]$lo] }
  return $s[[int]$lo] + ($s[[int]$hi] - $s[[int]$lo]) * ($idx - $lo)
}

# The same corpus as the macOS arm, so the two numbers compare.
$sentences = @(
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
  "I will report the median, the spread, the cold start penalty and the idle cost."
)

$synth  = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stream = New-Object FirstWriteProbeStream
$fmt    = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
            22050,
            [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
            [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToAudioStream($stream, $fmt)

Write-Output "SPIKE1_PROBE=windows-firstbuffer"
Write-Output ("SPIKE1_RUNTIME=" + [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription)
Write-Output ("SPIKE1_VOICE=" + $synth.Voice.Name + " id=" + $synth.Voice.Id)
Write-Output ("SPIKE1_INSTALLED_VOICES=" + (($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }) -join '; '))
Write-Output "SPIKE1_WARM_N=$WarmN"

$proc = [System.Diagnostics.Process]::GetCurrentProcess()
Write-Output ("SPIKE1_RSS_AT_START_BYTES=" + $proc.WorkingSet64)

function Measure-One([string]$text, [bool]$ssml) {
  $stream.Reset([System.Diagnostics.Stopwatch]::GetTimestamp())
  if ($ssml) {
    $escaped = $text -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;'
    $synth.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$escaped</speak>")
  } else {
    $synth.Speak($text)
  }
  return [pscustomobject]@{
    FirstMs = $stream.FirstWriteMs
    TotalMs = $stream.TotalMs
    Bytes   = $stream.TotalBytes
    Calls   = $stream.WriteCalls
  }
}

# ARM 0 — COLD. The first Speak() in this process. Reported alone, never averaged in.
$cold = Measure-One $sentences[0] $false
Write-Output ("SPIKE1_COLD_FIRSTBUFFER_MS=" + [math]::Round($cold.FirstMs,1))
Write-Output ("SPIKE1_COLD_TOTAL_MS=" + [math]::Round($cold.TotalMs,1) + " bytes=" + $cold.Bytes + " writeCalls=" + $cold.Calls)
$proc.Refresh()
Write-Output ("SPIKE1_RSS_AFTER_FIRST_SYNTH_BYTES=" + $proc.WorkingSet64)

# ARM 1 — WARM, plain string.
$warm = @()
for ($i = 0; $i -lt $WarmN; $i++) {
  $warm += Measure-One $sentences[(($i + 1) % $sentences.Count)] $false
}
$warmFb = [double[]]($warm | ForEach-Object { $_.FirstMs })
Write-Output ("SPIKE1_WARM_FIRSTBUFFER_MS_RAW=" + (($warmFb | ForEach-Object { [math]::Round($_,1) }) -join ' '))
Write-Output ("SPIKE1_WARM_FIRSTBUFFER_MIN=" + [math]::Round(($warmFb | Measure-Object -Minimum).Minimum,1) +
              " P50=" + [math]::Round((Percentile $warmFb 0.5),1) +
              " P95=" + [math]::Round((Percentile $warmFb 0.95),1) +
              " MAX=" + [math]::Round(($warmFb | Measure-Object -Maximum).Maximum,1) +
              " N=" + $warmFb.Count)
Write-Output ("SPIKE1_COLD_PENALTY_MS=" + [math]::Round($cold.FirstMs - (Percentile $warmFb 0.5),1))

# ARM 2 — WARM, SSML. SSML is the only route to pitch on Windows (010 extension 6), so its cost
# has to be known before the seam depends on it.
$ssml = @()
for ($i = 0; $i -lt $WarmN; $i++) {
  $ssml += Measure-One $sentences[(($i + 1) % $sentences.Count)] $true
}
$ssmlFb = [double[]]($ssml | ForEach-Object { $_.FirstMs })
Write-Output ("SPIKE1_SSML_FIRSTBUFFER_MS_RAW=" + (($ssmlFb | ForEach-Object { [math]::Round($_,1) }) -join ' '))
Write-Output ("SPIKE1_SSML_FIRSTBUFFER_MIN=" + [math]::Round(($ssmlFb | Measure-Object -Minimum).Minimum,1) +
              " P50=" + [math]::Round((Percentile $ssmlFb 0.5),1) +
              " P95=" + [math]::Round((Percentile $ssmlFb 0.95),1) +
              " MAX=" + [math]::Round(($ssmlFb | Measure-Object -Maximum).Maximum,1) +
              " N=" + $ssmlFb.Count)
Write-Output ("SPIKE1_SSML_MINUS_PLAIN_P50_MS=" + [math]::Round((Percentile $ssmlFb 0.5) - (Percentile $warmFb 0.5),1))

# ARM 3 — IDLE COST. A process that has synthesized and is now waiting.
$proc.Refresh()
$rss0 = $proc.WorkingSet64
$cpu0 = $proc.TotalProcessorTime
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $IdleSeconds
$sw.Stop()
$proc.Refresh()
$rss1 = $proc.WorkingSet64
$cpu1 = $proc.TotalProcessorTime
$idleCpuSec = ($cpu1 - $cpu0).TotalSeconds
Write-Output ("SPIKE1_IDLE_WINDOW_S=" + [math]::Round($sw.Elapsed.TotalSeconds,1))
Write-Output ("SPIKE1_IDLE_RSS_BEFORE_BYTES=" + $rss0)
Write-Output ("SPIKE1_IDLE_RSS_AFTER_BYTES=" + $rss1)
Write-Output ("SPIKE1_IDLE_RSS_AFTER_MB=" + [math]::Round($rss1 / 1MB, 1))
Write-Output ("SPIKE1_IDLE_CPU_SECONDS=" + [math]::Round($idleCpuSec, 4))
Write-Output ("SPIKE1_IDLE_CPU_PERCENT=" + [math]::Round($idleCpuSec / $sw.Elapsed.TotalSeconds * 100, 3))

$median = Percentile $warmFb 0.5
$verdict = if ($median -le 150) { "PASS" } elseif ($median -gt 350) { "FAIL-FALSIFIES-010" } else { "MARGINAL" }
Write-Output ("SPIKE1_VERDICT=" + $verdict + " median=" + [math]::Round($median,1) + " pass<=150 falsifier>350")

$synth.Dispose()
