"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Button, Dialog, EmptyState, SectionHeader, Skeleton, useToast } from "@/components/ui";
import { ensureDevice, checkDevice, wipeRevokedDevice } from "@/lib/offline/device";
import type { CapturedPage } from "@/lib/offline/image";
import { overdue, retryNow, type CaptureMeta } from "@/lib/offline/queue-state";
import {
  enqueueCapture, getDevice, getDeviceLabel, hasKeyBundle, listCaptures, loadCaptureList, recoverInterrupted,
  saveCaptureList, setDeviceLabel, setPin, unlockWithPin, updateCapture, wipeAll, wipeCapture, type CapturePatient,
} from "@/lib/offline/store";
import { syncQueue } from "@/lib/offline/sync";
import { onSwWipe, registerCaptureSw } from "@/lib/offline/sw-register";
import { PageCapture } from "./PageCapture";
import { PatientPicker } from "./PatientPicker";
import { PinGate } from "./PinGate";
import { QueuePanel } from "./QueuePanel";
import { NetworkPill, Notice, useOnline } from "./status";

type Phase = "boot" | "setup" | "locked" | "ready" | "unsupported";
type PatientList = { items: CapturePatient[]; source: "live" | "cache"; savedAt: number | null };

const defaultLabel = () => (/iPad|Tablet/i.test(navigator.userAgent) ? "Desk tablet" : "Desk device");
const SYNC_EVERY_MS = 15_000;

export function CaptureApp() {
  const online = useOnline();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("boot");
  const keyRef = useRef<CryptoKey | null>(null);
  const verified = useRef(false); // the server has said this device is not revoked, since we last came online
  const [caps, setCaps] = useState<CaptureMeta[]>([]);
  const [list, setList] = useState<PatientList | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState<CaptureMeta | null>(null);

  const getKey = useCallback(() => keyRef.current, []);
  const refresh = useCallback(async () => { try { setCaps(await listCaptures()); } catch { /* storage unavailable */ } }, []);
  const clearPages = useCallback(() => setPages((cur) => { cur.forEach((p) => URL.revokeObjectURL(p.url)); return []; }), []);

  const dropKey = useCallback(() => { keyRef.current = null; verified.current = false; setList(null); setSelected(null); clearPages(); }, [clearPages]);

  // FR-OFF-06: the server said this device is revoked. Everything local goes.
  const onRevoked = useCallback(async () => {
    await wipeRevokedDevice();
    dropKey();
    setCaps([]);
    setRevoked(true);
    setPhase("setup");
  }, [dropKey]);

  const sync = useCallback(async () => {
    const key = keyRef.current;
    if (!key || !verified.current) return; // never upload before the revocation check of this online session
    const out = await syncQueue(key, getDevice()?.deviceId ?? null, refresh);
    await refresh();
    if (out.revoked) return onRevoked();
    setAuthRequired(out.authRequired);
    if (out.synced) toast({ title: `${out.synced} capture${out.synced === 1 ? "" : "s"} synced`, description: "Confirmed by the server and removed from this device.", tone: "verified" });
  }, [refresh, onRevoked, toast]);

  // boot: storage check, service worker, locked/setup
  useEffect(() => {
    registerCaptureSw().catch(() => {});
    let alive = true;
    (async () => {
      try {
        const has = await hasKeyBundle();
        await refresh();
        if (!alive) return;
        setStandalone(matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
        setNow(Date.now());
        setPhase(has ? "locked" : "setup");
      } catch {
        if (alive) setPhase("unsupported");
      }
    })();
    const off = onSwWipe(() => { dropKey(); setCaps([]); setPhase("setup"); }); // signed out: the service worker wiped storage
    return () => { alive = false; off(); };
  }, [refresh, dropKey]);

  async function enter(key: CryptoKey) {
    keyRef.current = key;
    setPhase("ready");
    await recoverInterrupted();
    await refresh();
    const cached = await loadCaptureList(key).catch(() => null);
    if (cached) setList({ items: cached.items, source: "cache", savedAt: cached.savedAt });
    navigator.storage?.persist?.().then(setPersisted).catch(() => setPersisted(false));
  }

  // every time we are unlocked and online: register the device, ask if it was revoked, refresh the patient list, sync
  useEffect(() => {
    if (phase !== "ready") return;
    if (!online) { verified.current = false; return; }
    let alive = true;
    (async () => {
      const dev = await ensureDevice(getDeviceLabel() ?? defaultLabel());
      if (dev && (await checkDevice(dev.deviceId)) === "revoked") return onRevoked();
      verified.current = true;
      const key = keyRef.current;
      try {
        const res = await fetch("/api/devices/capture-list", { cache: "no-store" });
        if (res.status === 401) setAuthRequired(true);
        else if (res.ok && key) {
          const { items } = (await res.json()) as { items: CapturePatient[] };
          if (alive) { setList({ items, source: "live", savedAt: Date.now() }); setAuthRequired(false); }
          await saveCaptureList(key, items);
        }
      } catch { /* offline or server down: keep the cached list */ }
      if (alive) await sync();
    })();
    return () => { alive = false; };
  }, [phase, online, sync, onRevoked]);

  // backoff retries and the 24 h age alert
  useEffect(() => {
    if (phase !== "ready") return;
    const t = setInterval(() => { setNow(Date.now()); if (navigator.onLine) void sync(); }, SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [phase, sync]);

  useEffect(() => {
    if (!pages.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pages.length]);

  async function save() {
    const patient = list?.items.find((p) => p.encounterId === selected);
    const key = keyRef.current;
    if (!patient || !key || !pages.length) return;
    setSaving(true);
    try {
      await enqueueCapture(key, { patient, pages: pages.map((p) => p.blob), offline: !navigator.onLine });
      clearPages();
      setSelected(null);
      await refresh();
      toast({ title: "Saved on this device", description: navigator.onLine ? "Syncing now." : "It will sync by itself when the connection returns.", tone: "verified" });
      void sync();
    } catch {
      toast({ title: "Could not save this capture", description: "Storage on this device may be full.", tone: "conflict" });
    } finally {
      setSaving(false);
    }
  }

  const late = overdue(caps, now);
  const unlocked = phase === "ready";
  const waiting = caps.length;
  const queue = <QueuePanel key={unlocked ? "unlocked" : "locked"} now={now} caps={caps} unlocked={unlocked} getKey={getKey} onRetry={async (c) => { await updateCapture(retryNow(c)); await refresh(); void sync(); }} onDiscard={setDiscarding} />;

  return (
    <div className="grid gap-8">
      <SectionHeader
        as="h1"
        kicker="Desk · capture"
        title="Capture pages"
        description="Photograph a patient's papers at the desk. Pages are encrypted on this device and sync when the server can be reached."
        actions={
          <>
            <NetworkPill online={online} waiting={waiting} />
            {unlocked && (
              <Button variant="secondary" icon={<Lock aria-hidden />} onClick={() => { dropKey(); setPhase("locked"); }}>
                Lock
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 empty:hidden">
        {revoked && <Notice tone="conflict" title="This device was switched off by an administrator">Its saved captures and key were deleted. Set a new PIN to use it again.</Notice>}
        {late.length > 0 && (
          <Notice tone="conflict" title={`${late.length} capture${late.length === 1 ? " has" : "s have"} been waiting over 24 hours`}>
            Connect to the internet{unlocked ? "" : " and unlock"} to sync {late.length === 1 ? "it" : "them"}. Captures that stay only on this device can be lost.
          </Notice>
        )}
        {authRequired && (
          <Notice tone="unverified" title="Sign in again to sync" action={<a className="font-mono text-xs tracking-[0.12em] uppercase underline underline-offset-4" href="/login">Sign in</a>}>
            Your session ended. Captures stay encrypted on this device until you sign in.
          </Notice>
        )}
        {unlocked && !standalone && <Notice tone="unverified" title="Install this app to protect unsynced captures">Add OncoSetu to the home screen so the browser does not clear its storage when space is low.</Notice>}
        {unlocked && persisted === false && <Notice tone="unverified" title="This browser has not promised to keep this storage">Sync captures as soon as you are online.</Notice>}
      </div>

      {phase === "boot" && <Skeleton className="h-64" />}
      {phase === "unsupported" && <EmptyState title="Offline storage is not available" description="This browser blocks IndexedDB (a private window, for example). Open the capture app in a normal window." />}

      {(phase === "setup" || phase === "locked") && (
        <div className="grid gap-8">
          {phase === "setup" ? (
            <PinGate
              mode="setup"
              defaultLabel={typeof navigator === "undefined" ? "Desk device" : defaultLabel()}
              onSetup={async (pin, label) => { setDeviceLabel(label); setRevoked(false); await enter(await setPin(pin)); }}
            />
          ) : (
            <PinGate
              mode="locked"
              waiting={waiting}
              onUnlock={async (pin) => enter(await unlockWithPin(pin))}
              onReset={async () => { await wipeAll(); setCaps([]); setPhase("setup"); }}
            />
          )}
          {waiting > 0 && <div className="mx-auto w-full max-w-md">{queue}</div>}
        </div>
      )}

      {unlocked && (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-10">
            <section aria-labelledby="who" className="grid gap-4">
              <header className="grid gap-1">
                <p className="ds-kicker">Step 1</p>
                <h2 id="who" className="text-2xl">Who are these pages for?</h2>
              </header>
              {list ? (
                <PatientPicker items={list.items} value={selected} onChange={setSelected} source={list.source} savedAt={list.savedAt} />
              ) : online ? (
                <Skeleton className="h-40" />
              ) : (
                <EmptyState title="No saved patient list" description="This device has not downloaded today's list yet. Connect once, then capture works offline." />
              )}
            </section>

            <section aria-labelledby="pages" className="grid gap-4">
              <header className="grid gap-1">
                <p className="ds-kicker">Step 2</p>
                <h2 id="pages" className="text-2xl">Photograph the pages</h2>
              </header>
              <PageCapture pages={pages} setPages={setPages} />
            </section>

            <section aria-labelledby="save" className="grid gap-3 border-t border-rule pt-6">
              <h2 id="save" className="sr-only">Save</h2>
              <div className="flex flex-wrap items-center gap-4">
                <Button size="lg" onClick={save} loading={saving} disabled={!selected || pages.length === 0}>
                  Save {pages.length || ""} page{pages.length === 1 ? "" : "s"} to queue
                </Button>
                {(!selected || pages.length === 0) && <p className="text-sm text-muted">Choose a patient and add at least one page.</p>}
              </div>
            </section>
          </div>
          <aside aria-label="Sync queue" className="lg:sticky lg:top-24">{queue}</aside>
        </div>
      )}

      <Dialog
        open={!!discarding}
        onClose={() => setDiscarding(null)}
        title="Discard this capture?"
        description="Its pages are deleted from this device and will not be uploaded."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscarding(null)}>Keep</Button>
            <Button variant="danger" onClick={async () => { if (discarding) { await wipeCapture(discarding.id); await refresh(); } setDiscarding(null); }}>Discard</Button>
          </>
        }
      />
    </div>
  );
}
