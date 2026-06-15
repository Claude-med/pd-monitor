# -*- coding: utf-8 -*-
import sys, io, datetime
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")

AUDIO = "voice_47919.wav"
OUT = "voice.md"

def fmt(t):
    m, s = divmod(int(t), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

MODEL = "medium"
print(f"Loading model {MODEL} (CPU, int8)...", flush=True)
model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=16)

print("Transcribing...", flush=True)
segments, info = model.transcribe(
    AUDIO,
    language="th",
    beam_size=1,
    temperature=0.0,                    # ปิด temperature fallback -> decode รอบเดียวต่อหน้าต่าง
    vad_filter=True,
    vad_parameters=dict(min_silence_duration_ms=500, max_speech_duration_s=20),
    condition_on_previous_text=False,   # กันลูป/วนซ้ำข้ามหน้าต่าง
    no_repeat_ngram_size=3,             # กันวน token ซ้ำภายในหน้าต่าง
    repetition_penalty=1.15,
    compression_ratio_threshold=2.4,
    no_speech_threshold=0.6,
)
print(f"Detected language: {info.language} (p={info.language_probability:.2f}), "
      f"duration={info.duration:.1f}s", flush=True)

segs = []
for seg in segments:
    text = seg.text.strip()
    segs.append((seg.start, seg.end, text))
    print(f"[{fmt(seg.start)} - {fmt(seg.end)}] {text}", flush=True)

# Build full text grouped into paragraphs (~5 segments per paragraph)
full_lines = []
buf = []
for i, (st, en, tx) in enumerate(segs):
    buf.append(tx)
    if len(buf) >= 5:
        full_lines.append(" ".join(buf))
        buf = []
if buf:
    full_lines.append(" ".join(buf))
full_text = "\n\n".join(full_lines)

today = datetime.date.today().isoformat()
total = fmt(info.duration)

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write("# ถอดเสียง: voice_47919.aac\n\n")
    f.write(f"- ความยาว: {total} | ภาษา: ไทย | โมเดล: faster-whisper {MODEL}\n")
    f.write(f"- วันที่ถอด: {today} | จำนวนช่วง: {len(segs)}\n\n")
    f.write("---\n\n")
    f.write("## ข้อความเต็ม\n\n")
    f.write(full_text + "\n\n")
    f.write("---\n\n")
    f.write("## แบ่งตามช่วงเวลา\n\n")
    for st, en, tx in segs:
        f.write(f"**[{fmt(st)} - {fmt(en)}]** {tx}\n\n")

print(f"\nDONE -> {OUT} ({len(segs)} segments)", flush=True)
