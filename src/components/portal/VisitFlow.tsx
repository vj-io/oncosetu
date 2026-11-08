"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, CircleCheck, Mic, Square, Volume2 } from "lucide-react";
import { formatDateIN } from "@/core/copy";
import { tp, type PatientKey } from "@/i18n/patient";
import { buildReadback, QUESTION_IDS, TEST_KINDS, type Answer, type Answers, type QuestionId } from "@/server/portal/visit-model";
import { ErrorNote, PButton, PField, PInput, PLink, PSelect, PTextarea } from "./ui";

import type { Lang } from "@/core/types";
type Phase = "questions" | "review" | "saved";
type Field = "place" | "names" | "free" | "whenText";

// Minimal typing for the browser's speech recognition (not in lib.dom for every TS version).
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null; onend: (() => void) | null
  start(): void; stop(): void
};
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Drop detail fields when the answer is not "yes", and blank strings everywhere: what is sent is what is read back. */
function submittable(a: Answers): Answers {
  const out: Answers = {};
  for (const id of QUESTION_IDS) {
    const x = a[id];
    if (!x) continue;
    if (x.yn !== "yes") { out[id] = { yn: x.yn }; continue; }
    const c: Answer = { yn: "yes" };
    for (const k of ["place", "names", "free", "whenText"] as const) if (x[k]?.trim()) c[k] = x[k]!.trim();
    if (x.testKind) c.testKind = x.testKind;
    if (x.year != null) { c.year = x.year; if (x.month != null) c.month = x.month; }
    if (x.voice) c.voice = true;
    if (x.clips?.length) c.clips = x.clips;
    if (x.shadow?.length) c.shadow = x.shadow;
    out[id] = c;
  }
  return out;
}

export function VisitFlow({
  lang, questions, canVoice, shadow = false, canSpeak, sarvam, currentYear, lastAnswered, station = false,
}: {
  /** sarvam: the server can transcribe (SARVAM_API_KEY set), so record audio instead of using the browser's recogniser */
  lang: Lang; canVoice: boolean; canSpeak: boolean; sarvam: boolean; currentYear: number; lastAnswered: string | null;
  /** The questions this hospital asks, in its order (FR-VOX-01). */
  questions: QuestionId[];
  /** Voice shadow mode (FR-VOX-03): the recording is kept for staff; what it says never fills the answer. Needs Sarvam. */
  shadow?: boolean;
  /** On the shared desk-station tablet (FR-VOX-02): sign out by itself once the answers are saved. */
  station?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("questions");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [reviewed, setReviewed] = useState(false);
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [saving, setSaving] = useState(false);
  const [confirmedSave, setConfirmedSave] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);

  // voice typing (only when the org turned it on): one recording at a time
  const speechSupported = useSyncExternalStore(() => () => {}, () => (sarvam ? typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia : !!recognitionCtor()), () => false); // false on the server, real value in the browser
  const voiceOn = canVoice && speechSupported && (!shadow || sarvam);
  const [listening, setListening] = useState<string | null>(null);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  useEffect(() => () => {
    rec.current?.stop();
    const r = recorder.current; // leaving the page: release the microphone, send nothing
    if (r && r.state !== "inactive") { r.onstop = () => r.stream.getTracks().forEach((t) => t.stop()); r.stop(); }
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step, phase]);

  const q = { id: questions[step] };
  const a = answers[q.id];

  function setA(id: QuestionId, patch: Partial<Answer>) {
    if (reviewed) setEdited(true);
    setAnswers((s) => ({ ...s, [id]: { ...(s[id] ?? { yn: "yes" as const }), ...patch } as Answer }));
  }

  function addSaid(qid: QuestionId, field: Field, said: string, clipId?: string) {
    if (reviewed) setEdited(true);
    setAnswers((s) => {
      const prev = s[qid] ?? { yn: "yes" as const };
      const cur = (prev[field] ?? "").trim();
      const clips = clipId ? [...(prev.clips ?? []), clipId].slice(-6) : prev.clips; // the recordings stay beside the answer (FR-VOX-05)
      return { ...s, [qid]: { ...prev, [field]: cur ? `${cur} ${said}` : said, voice: true, ...(clips ? { clips } : {}) } as Answer };
    });
  }

  // Sarvam path: record with MediaRecorder (≤ 30 s), the server transcribes, the text lands in the same field.
  async function record(id: string, field: Field) {
    const cur = recorder.current;
    if (cur?.state === "recording") { cur.stop(); if (listening === id) return; }
    setVoiceMsg(null);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return setVoiceMsg(tp(lang, "voiceFailed")); }
    const r = new MediaRecorder(stream), chunks: Blob[] = [], qid = q.id;
    let started = 0;
    r.onstart = (e) => { started = e.timeStamp; };
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async (e) => {
      stream.getTracks().forEach((t) => t.stop());
      setListening((x) => (x === id ? null : x));
      const body = new FormData();
      body.append("audio", new Blob(chunks, { type: r.mimeType }), "answer");
      body.append("lang", lang);
      body.append("seconds", String(Math.round((e.timeStamp - started) / 1000)));
      try {
        const res = await fetch("/api/p/voice/transcribe", { method: "POST", body });
        if (!res.ok) throw new Error(String(res.status));
        const out = (await res.json()) as { text?: string; clipId?: string; shadow?: string };
        if (out.shadow) { // shadow mode: keep the sealed token beside the answer; the patient's typing stays the answer
          const token = out.shadow;
          setAnswers((s) => { const prev = s[qid] ?? { yn: "yes" as const }; return { ...s, [qid]: { ...prev, shadow: [...(prev.shadow ?? []), token].slice(-6) } }; });
          return setVoiceMsg(tp(lang, "voiceShadowSaved"));
        }
        const said = out.text?.trim();
        if (!said) throw new Error("empty");
        addSaid(qid, field, said, out.clipId);
      } catch {
        setVoiceMsg(tp(lang, "voiceFailed"));
      }
    };
    recorder.current = r;
    setListening(id);
    r.start();
    setTimeout(() => { if (r.state === "recording") r.stop(); }, 30_000); // Sarvam's REST endpoint is for clips under 30 s
  }

  function speak(id: string, field: Field) {
    if (sarvam) return void record(id, field);
    const Ctor = recognitionCtor();
    if (!Ctor) return setVoiceMsg(tp(lang, "voiceUnsupported"));
    rec.current?.stop();
    if (listening === id) return setListening(null);
    const r = new Ctor();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.interimResults = false;
    r.continuous = false;
    const qid = q.id;
    r.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript?.trim();
      if (said) addSaid(qid, field, said);
    };
    r.onerror = () => { setVoiceMsg(tp(lang, "voiceFailed")); setListening(null); };
    r.onend = () => setListening((x) => (x === id ? null : x));
    rec.current = r;
    setVoiceMsg(null);
    setListening(id);
    r.start();
  }

  function next() {
    setError(null);
    if (!a?.yn) return setError(tp(lang, "err_choose"));
    if (a.yn === "yes" && q.id === "anything_else" && !a.free?.trim()) return setError(tp(lang, "err_free"));
    if (a.yn === "yes" && a.month != null && a.year == null) return setError(tp(lang, "err_year"));
    rec.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (step < questions.length - 1) return setStep(step + 1);
    setReviewed(true);
    setPhase("review");
  }

  async function save(confirmation: "confirmed" | "corrected" | "unconfirmed") {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/p/statements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: submittable(answers), lang, confirmation }),
      });
      if (res.status === 401) {
        // The session ended while the questions were open: sign in again, then come back here.
        const chosen = new URLSearchParams(window.location.search).get("lang");
        window.location.assign(station ? "/p/login?station=1" : `/p/login?next=/p/visit${chosen === "hi" || chosen === "en" || chosen === "hinglish" ? `&lang=${chosen}` : ""}`);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setConfirmedSave(confirmation !== "unconfirmed");
      setPhase("saved");
    } catch {
      setError(tp(lang, "visitSaveError"));
    }
    setSaving(false);
  }

  const readback = buildReadback(submittable(answers), lang, questions);

  // Spoken read-back (FR-VOX-04): Sarvam's voice when the server has it, else the browser's own voice.
  const player = useRef<HTMLAudioElement | null>(null);
  const [reading, setReading] = useState<"idle" | "loading" | "playing">("idle");
  async function read() {
    if (!canSpeak) return;
    if (sarvam) {
      if (player.current && !player.current.paused) { player.current.pause(); return setReading("idle"); }
      setReading("loading");
      try {
        const res = await fetch("/api/p/voice/readback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: submittable(answers), lang }) });
        if (!res.ok) throw new Error(String(res.status));
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        player.current = a;
        a.onended = () => { setReading("idle"); URL.revokeObjectURL(url); };
        await a.play();
        setReading("playing");
      } catch {
        setReading("idle");
        setError(tp(lang, "voiceFailed"));
      }
      return;
    }
    if (typeof speechSynthesis === "undefined") return;
    if (speechSynthesis.speaking) return speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance([readback.intro, ...readback.lines.map((l) => l.text)].join(" "));
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    speechSynthesis.speak(u);
  }

  const mic = (id: string, field: Field) =>
    voiceOn ? (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button" onClick={() => speak(id, field)} aria-pressed={listening === id}
          className="inline-flex min-h-12 items-center gap-2 border border-ink px-4 text-[16px] hover:bg-spotlight aria-pressed:bg-obsidian aria-pressed:text-gallery"
        >
          {listening === id ? <Square aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
          {tp(lang, listening === id ? "voiceStop" : "voiceStart")}
        </button>
        <span className="text-[16px] text-muted">{listening === id ? tp(lang, "voiceListening") : tp(lang, shadow ? "voiceShadowLabel" : "voiceLabel")}</span>
      </div>
    ) : null;

  const text = (id: string, field: Field, label: PatientKey, opts: { hint?: PatientKey; area?: boolean } = {}) => {
    const value = a?.[field] ?? "";
    const onChange = (v: string) => setA(q.id, { [field]: v });
    return (
      <div>
        <PField label={tp(lang, label)} hint={opts.hint ? tp(lang, opts.hint) : undefined}>
          {opts.area
            ? <PTextarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} />
            : <PInput value={value} onChange={(e) => onChange(e.target.value)} maxLength={400} />}
        </PField>
        {mic(id, field)}
      </div>
    );
  };

  const months = Array.from({ length: 12 }, (_, i) => formatDateIN(`2026-${String(i + 1).padStart(2, "0")}-01`, lang, "month").split(" ")[0]);
  const years = Array.from({ length: 16 }, (_, i) => currentYear - i);
  const when = (
    <fieldset className="grid gap-3 border border-rule px-4 py-4">
      <legend className="px-1 text-[17px] font-medium">{tp(lang, "f_when")}</legend>
      <div className="grid grid-cols-2 gap-3">
        <PField label={tp(lang, "f_month")}>
          <PSelect value={a?.month ?? ""} onChange={(e) => setA(q.id, { month: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">{tp(lang, "f_choose")}</option>
            {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </PSelect>
        </PField>
        <PField label={tp(lang, "f_year")}>
          <PSelect value={a?.year ?? ""} onChange={(e) => setA(q.id, { year: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">{tp(lang, "f_choose")}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </PSelect>
        </PField>
      </div>
      {text(`${q.id}-when`, "whenText", "f_whenText", { hint: "f_whenText_hint" })}
    </fieldset>
  );

  if (phase === "saved") {
    return (
      <div role="status" className="mt-8 grid gap-4 border border-sage bg-sage-tint px-5 py-6">
        <h2 ref={heading} tabIndex={-1} className="flex items-start gap-2 text-2xl text-sage-ink outline-none">
          <CircleCheck aria-hidden className="mt-1 size-6 shrink-0" />
          {tp(lang, confirmedSave ? "savedTitle" : "savedUnconfirmed")}
        </h2>
        {confirmedSave && <p className="text-[17px]">{tp(lang, "savedText")}</p>}
        {station ? (
          <StationSignOut lang={lang} />
        ) : (
          <div className="flex flex-wrap gap-3">
            <PLink href={`/p?lang=${lang}`} variant="secondary">{tp(lang, "backHome")}</PLink>
            <PLink href={`/p/upload?lang=${lang}`} variant="ghost">{tp(lang, "cardUploadTitle")}</PLink>
          </div>
        )}
      </div>
    );
  }

  if (phase === "review") {
    return (
      <section aria-labelledby="rv" className="mt-8 grid gap-5">
        <h2 id="rv" ref={heading} tabIndex={-1} className="text-2xl outline-none">{tp(lang, "reviewTitle")}</h2>
        <div className="border border-rule bg-surface px-5 py-5 shadow-placard">
          <p className="font-medium">{readback.intro}</p>
          <ul className="mt-3 grid gap-3">
            {readback.lines.map((l) => (
              <li key={l.q} className="flex items-start gap-3 text-[17px] leading-snug">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-setu-ink" />
                <span className="min-w-0 break-words">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {canSpeak && (
          <PButton variant="secondary" icon={<Volume2 />} loading={reading === "loading"} onClick={read} className="w-full sm:w-auto">{tp(lang, "readAloud")}</PButton>
        )}
        <p className="text-[16px] text-muted">{tp(lang, "reviewHelp")}</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2">
          <PButton big loading={saving} onClick={() => save(edited ? "corrected" : "confirmed")}>{saving ? tp(lang, "saving") : tp(lang, "confirmYes")}</PButton>
          <PButton big variant="secondary" disabled={saving} onClick={() => { setPhase("questions"); setStep(0); setError(null); }}>{tp(lang, "editAnswers")}</PButton>
        </div>
        <PButton variant="ghost" disabled={saving} onClick={() => save("unconfirmed")} className="justify-start">{tp(lang, "saveUnconfirmed")}</PButton>
      </section>
    );
  }

  const choices = q.id === "anything_else" ? (["yes", "no"] as const) : (["yes", "no", "unsure"] as const);
  return (
    <section aria-labelledby="qh" className="mt-8 grid gap-5">
      {lastAnswered && step === 0 && !reviewed && <p className="border border-rule bg-alcove px-4 py-3 text-[16px] text-muted">{tp(lang, "visitLast", { date: lastAnswered })}</p>}
      <div className="grid gap-2">
        <p className="text-[16px] text-muted">{tp(lang, "questionProgress", { n: step + 1, total: questions.length })}</p>
        <div aria-hidden className="h-2 border border-rule bg-alcove">
          <div className="h-full bg-setu transition-[width] duration-300" style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
        </div>
      </div>
      <h2 id="qh" ref={heading} tabIndex={-1} className="text-[1.65rem] leading-snug outline-none">{tp(lang, `q_${q.id}` as PatientKey)}</h2>

      <div role="radiogroup" aria-labelledby="qh" className={choices.length === 3 ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        {choices.map((c) => (
          <button
            key={c} type="button" role="radio" aria-checked={a?.yn === c}
            onClick={() => { setError(null); setA(q.id, { yn: c }); }}
            className="min-h-14 border border-ink px-4 py-3 text-[18px] font-medium transition-colors hover:bg-spotlight aria-checked:bg-obsidian aria-checked:text-gallery"
          >
            {tp(lang, c)}
          </button>
        ))}
      </div>

      {a?.yn === "yes" && (
        <div className="grid gap-5">
          {q.id === "other_hospital" && <>{text("place", "place", "f_place_hospital")}{when}</>}
          {q.id === "new_medicines" && <>{text("names", "names", "f_medicines", { hint: "f_medicines_hint", area: true })}{text("place", "place", "f_place_prescriber")}{when}</>}
          {q.id === "new_tests" && (
            <>
              <PField label={tp(lang, "f_testkind")}>
                <PSelect value={a.testKind ?? ""} onChange={(e) => setA(q.id, { testKind: (e.target.value || undefined) as Answer["testKind"] })}>
                  <option value="">{tp(lang, "f_choose")}</option>
                  {TEST_KINDS.map((k) => <option key={k} value={k}>{tp(lang, `kind_${k}` as PatientKey)}</option>)}
                </PSelect>
              </PField>
              {text("names", "names", "f_testname")}
              {text("place", "place", "f_place_test")}
              {when}
            </>
          )}
          {q.id === "admissions" && <>{text("place", "place", "f_place_admission")}{when}</>}
          {q.id === "anything_else" && text("free", "free", "f_free", { hint: "f_free_hint", area: true })}
        </div>
      )}

      {voiceMsg && <p role="status" className="text-[16px] text-muted">{voiceMsg}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        {step > 0 ? <PButton variant="secondary" onClick={() => { setError(null); setStep(step - 1); }}>{tp(lang, "back")}</PButton> : <span />}
        <PButton big onClick={next} className="sm:order-last">{tp(lang, "next")}</PButton>
      </div>
    </section>
  );
}

/** Desk station: count down, then end the session and return the tablet to the station sign-in for the next person. */
function StationSignOut({ lang }: { lang: Lang }) {
  const [left, setLeft] = useState(15);
  const out = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left > 0 || out.current) return;
    out.current = true;
    fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.assign("/p/login?station=1"));
  }, [left]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-[17px]" aria-live="polite">{tp(lang, "stationSignOut", { n: String(left) })}</p>
      <PButton variant="secondary" onClick={() => setLeft(0)}>{tp(lang, "stationDoneNow")}</PButton>
    </div>
  );
}
