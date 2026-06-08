"use client";
import React, { useState } from "react";
import {
  MapPin, Phone, User, Calendar, Clock, Building2, Tag, FileText,
  Wrench, Package, StickyNote, CheckCircle2, Circle, MinusCircle,
  ChevronDown, Hash, Mail, BadgeCheck, Zap, FlagTriangleRight,
  ArrowLeft, Copy, Receipt, CalendarClock, UserCog, Megaphone,
  PhoneIncoming, PhoneOutgoing, Globe, Play, ChevronRight, MessagesSquare,
  XCircle, Archive, FileSignature, Droplets,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Sample data — shaped the way a task record would come back from    */
/*  your API. Two records: one completed/invoiced, one open.           */
/* ------------------------------------------------------------------ */
const TASKS = {
  completed: {
    id: "JN126486",
    ref: "Deme-17 · JN 126486",
    title: "6 The Terrace, Abbotsford",
    location: "6 The Terrace, Abbotsford NSW 2046",
    taskType: "COD Electrical",
    workType: "Electrical Repairs / Maintenance",
    statusKey: "completed",
    grade: "A",
    priority: "Appointment Confirmed",
    progress: 100,
    client: { name: "Tina Demetriou", subType: "VIP Customer", rate: "Service Agreement" },
    contact: { name: "Tina Demetriou", phone: "0422 139 273" },
    people: { owner: "Plumber & Electrician To The Rescue", enteredBy: "Alex Mitchell", salesperson: "Simon Gerges", assigned: "Owner" },
    campaign: "SPRING22",
    dates: { requested: "14 Oct 2022, 1:01 PM", due: "15 Oct 2022", completed: "17 Oct 2022, 3:54 PM · Scott Dunn", updated: "25 Nov 2022, 3:10 PM" },
    description:
      "NO MIN CHARGE OR SF — LIFETIME SA CUSTOMER. Please call on the way.\n\n14/10 AM Tina called and said she needs to get some globes replaced and some lights have fallen out of their sockets. She said the ceiling's not super high. Appt confirmed for Mon 17/10 between 11 AM – 1 PM.",
    invoice: { number: "142758", amount: "$1,056.00", note: "incl GST · Paid EFT 17 Oct 2022" },
    labour: [
      { resource: "S. Gerges", detail: "Sold job, will return later in the afternoon to install 8 downlights with extension plate.", qty: "0.32 hrs", meta: "Elect-Commercial", cost: 46.4, sell: 76.16 },
      { resource: "S. Gerges", detail: "Supplied and installed 8 LED downlights with extension plates. Collected EFT $960 plus GST.", qty: "2.00 hrs", meta: "Elect-SA", cost: 290.0, sell: 580.0 },
    ],
    materials: [
      { resource: "S. Gerges", detail: "½ hour travel time — Tradesman", qty: "1", meta: "", cost: 140.0, sell: 198.0 },
      { resource: "PO 28440", detail: "D/Light Rnd Fixed Int Drv 92mm SMD LED 10W 3/4.2/5.7K Wht", qty: "8", meta: "SALS9041TCWH", cost: 120.0, sell: 199.2 },
      { resource: "PO 28440", detail: "D/Light Adaptor Ring / Plate Steel Wht F/S9146 LED D/Light", qty: "8", meta: "SALS9903WH", cost: 74.96, sell: 124.43 },
      { resource: "A. Tingley", detail: "Consumables", qty: "1", meta: "0004", cost: 20.0, sell: 20.0 },
    ],
    notes: [
      { author: "Andrew Tingley", when: "19 Oct 2022, 9:22 AM", tag: "Internal", body: "Inv 142758 $1056 incl GST — Paid EFT", flag: "pay" },
      { author: "Andrew Tingley", when: "19 Oct 2022, 9:24 AM", tag: "Internal", body: "Fran to update EFT transfer" },
      { author: "Frances Baker", when: "19 Oct 2022, 9:28 AM", tag: "Admin", body: "Received EFT payment 17/10/2022 — OSKO deposit. Christina Deme $1,056.00 · ref 142758." },
    ],
    interactions: [
      { id: "c1", kind: "call", dir: "in", date: "14 Oct 2022", time: "1:01 PM", operator: "PTTR Web", dur: "10:49", recording: true,
        transcript: "Agent: Good afternoon, Electrician To The Rescue, this is Sarah.\nCustomer: Hi Sarah, it's Tina from Abbotsford. I've got a few globes that have blown and a couple of downlights have actually fallen out of their sockets in the hallway.\nAgent: No problem at all Tina — is the ceiling a high one or standard height?\nCustomer: Standard, not super high. I just need someone to sort it out properly.\nAgent: Easy. You're one of our lifetime service-agreement customers so there's no call-out fee. I can get a sparky to you Monday the 17th between 11 and 1 — does that suit?\nCustomer: Perfect, thank you. Can they call on the way?\nAgent: Absolutely, I'll note that on the job." },
      { id: "c2", kind: "email", dir: "in", date: "14 Oct 2022", time: "1:06 PM", operator: "Reception",
        from: "tina.demetriou@gmail.com", to: "jobs@electriciantotherescue.com.au", subject: "Lights — 6 The Terrace, Abbotsford",
        body: "Hi team,\n\nFollowing my call — I need some globes replaced and a few downlights re-seated in the hallway. A couple have dropped out of the ceiling. Happy with Monday 17/10, 11am–1pm.\n\nPlease call on the way.\n\nThanks,\nTina" },
      { id: "c3", kind: "email", dir: "out", date: "14 Oct 2022", time: "2:31 PM", operator: "Alex Mitchell",
        from: "jobs@electriciantotherescue.com.au", to: "tina.demetriou@gmail.com", subject: "Appointment confirmed — Mon 17/10, 11am–1pm",
        body: "Hi Tina,\n\nConfirming your appointment for Monday 17 October between 11am and 1pm. As a lifetime Service Agreement customer there is no minimum charge or service fee. Our technician will call on the way.\n\nKind regards,\nAlex\nElectrician To The Rescue" },
    ],
    checklist: [
      { item: "Arrived on site", state: "y", by: "Simon Gerges · 17/10 11:07 AM" },
      { item: "Compliance forms completed", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Labour & materials booked out", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Added travel time & apprentice's", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Left site — clean & tidy", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Sticker & tag photos uploaded", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Collected deposit / payment", state: "y", by: "Simon Gerges · 17/10 3:30 PM" },
      { item: "Emailed client \u201CConsumer Building Guide\u201D (work > $5,000)", state: "na", by: "Simon Gerges" },
      { item: "Completed contract for works > $20,000", state: "na", by: "Simon Gerges" },
    ],
  },
  open: {
    id: "JN142758",
    ref: "banfie-6 · JN 142758",
    title: "142 Garden Street, Maroubra",
    location: "142 Garden Street, Maroubra NSW 2035",
    taskType: "COD Electrical",
    workType: "Electrical Repairs / Maintenance",
    statusKey: "open",
    grade: "B",
    priority: "Appointment Confirmed",
    progress: 0,
    client: { name: "Trent Banfield", subType: "Residential Client", rate: "Regular Rates" },
    contact: { name: "Trent Banfield", phone: "0437 694 614" },
    people: { owner: "Plumber & Electrician To The Rescue", enteredBy: "Mario Cardona", salesperson: "—", assigned: "Owner" },
    campaign: "ETTR — Website",
    dates: { requested: "2 Jun 2026, 10:12 AM", due: "3 Jun 2026", completed: null, updated: "2 Jun 2026, 10:21 AM" },
    description:
      "CARRY OUT COURTESY INSPECTION — HAS A VOUCHER.\n\n2/6 mc — \u201CMy problem is\u2026 replace the smoke detector. Repair or replace light fittings not working. Hardwire Ring doorbell.\u201D Confirmed Wed 3/6 12 PM – 2 PM, he's in a meeting before.",
    invoice: null,
    schedule: { tech: "Simon Gerges", when: "Wed 3 Jun 2026, 12 – 2 PM" },
    labour: [],
    materials: [],
    notes: [
      { author: "Mario Cardona", when: "2 Jun 2026, 10:21 AM", tag: "Internal", body: "MYT (Meet Your Team) email sent to Trent Banfield." },
      { author: "System", when: "2 Jun 2026, 10:20 AM", tag: "Internal", body: "New ETTR website form received — re: New ETTR Website Form." },
    ],
    interactions: [
      { id: "o1", kind: "form", dir: "in", date: "2 Jun 2026", time: "10:12 AM", operator: "ETTR Website",
        from: "Website enquiry form", to: "jobs@electriciantotherescue.com.au", subject: "New ETTR Website Form",
        body: "Name: Trent Banfield\nPhone: 0437 694 614\nSuburb: Maroubra NSW 2035\nService: Electrical\nVoucher: YES — courtesy inspection\n\nMessage: My problem is — replace the smoke detector, repair or replace light fittings not working, and hardwire a Ring doorbell." },
      { id: "o2", kind: "email", dir: "out", date: "2 Jun 2026", time: "10:21 AM", operator: "Mario Cardona",
        from: "jobs@electriciantotherescue.com.au", to: "trentbanfield@hotmail.com", subject: "Meet Your Team — your upcoming appointment (142758)",
        body: "Hi Trent,\n\nThanks for getting in touch. This is a quick note to introduce the team who'll be looking after you and to confirm we've received your request for a courtesy inspection.\n\nWe'll be in touch shortly to lock in a time. \n\nKind regards,\nMario\nElectrician To The Rescue" },
      { id: "o3", kind: "call", dir: "in", date: "2 Jun 2026", time: "10:34 AM", operator: "PTTR Web", dur: "3:24", recording: true,
        transcript: "Agent: Electrician To The Rescue, Mario speaking.\nCustomer: Hi, it's Trent — I just put in a form online. I'm after a smoke alarm replaced, a couple of light fittings looked at, and a Ring doorbell hardwired.\nAgent: Got it Trent, I can see your enquiry here. I can do Wednesday the 3rd, twelve to two?\nCustomer: That works, but I'm in a meeting just before, so give me a call when you're close.\nAgent: Will do — confirmed for Wednesday 12 to 2." },
    ],
    checklist: [
      { item: "Arrived on site", state: "open" },
      { item: "Compliance forms completed", state: "open" },
      { item: "Labour & materials booked out", state: "open" },
      { item: "Added travel time & apprentice's", state: "open" },
      { item: "Left site — clean & tidy", state: "open" },
      { item: "Sticker & tag photos uploaded", state: "open" },
      { item: "Collected deposit / payment", state: "open" },
      { item: "CCEW emailed before completing electrical task", state: "open" },
    ],
  },
};

/* ------------------------------------------------------------------ */
const money = (n) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (arr, k) => arr.reduce((a, b) => a + b[k], 0);

const STATUS_TONES = {
  green: { bg: "rgba(21,115,71,.14)", fg: "#1C7A4A", dot: "#27a062" },
  blue: { bg: "rgba(29,91,191,.13)", fg: "#1D5BBF", dot: "#3b7bdf" },
  amber: { bg: "rgba(181,113,13,.15)", fg: "#A86510", dot: "#d4912f" },
  red: { bg: "rgba(178,54,54,.14)", fg: "#B23636", dot: "#d24a4a" },
  slate: { bg: "rgba(90,85,76,.14)", fg: "#5A554C", dot: "#8C877D" },
};

/* full status model — maps a status key to label, sub-status, tone and banner icon */
const STATUSES = {
  open: { label: "Open · In Progress", sub: "Scheduled", tone: "blue", Icon: Clock, banner: false },
  quote: { label: "Quote", sub: "Awaiting customer approval", tone: "amber", Icon: FileSignature, banner: true },
  cancelled: { label: "Cancelled", sub: "Booking cancelled", tone: "red", Icon: XCircle, banner: true },
  archived: { label: "Archived", sub: "Quote archived — no further action", tone: "slate", Icon: Archive, banner: true },
  completed: { label: "Completed · Invoiced", sub: "Paid", tone: "green", Icon: CheckCircle2, banner: true },
};

const GRADE_TONE = { A: { fg: "#1C7A4A", bg: "rgba(21,115,71,.14)" }, B: { fg: "#A86510", bg: "rgba(181,113,13,.15)" }, C: { fg: "#5A554C", bg: "rgba(90,85,76,.14)" } };

const css = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
* { box-sizing: border-box; }
.td-root {
  --paper:#F4F2EC; --surface:#FFFFFF; --ink:#181612; --ink2:#5A554C;
  --ink3:#938D81; --line:#E7E3D9; --line2:#F0EDE5; --navy:#16243E; --amber:#C9781C;
  font-family:'Hanken Grotesk',sans-serif; color:var(--ink);
  background:var(--paper); min-height:100vh; -webkit-font-smoothing:antialiased;
}
.td-display { font-family:'Bricolage Grotesque',sans-serif; letter-spacing:-.01em; }
.td-mono { font-family:'JetBrains Mono',monospace; font-variant-numeric:tabular-nums; }
.td-wrap { max-width:980px; margin:0 auto; padding:0 20px 64px; }
.td-card { background:var(--surface); border:1px solid var(--line); border-radius:16px; }
.td-fade { opacity:0; transform:translateY(8px); animation:tdIn .5s cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes tdIn { to { opacity:1; transform:none; } }
.td-label { font-size:11px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; color:var(--ink3); }
.td-link { color:var(--navy); text-decoration:none; border-bottom:1px solid transparent; }
.td-link:hover { border-bottom-color:currentColor; }
.td-seg { background:rgba(0,0,0,.04); border-radius:10px; padding:3px; display:inline-flex; gap:2px; }
.td-seg button { font-family:inherit; font-size:13px; font-weight:600; border:0; background:transparent;
  color:var(--ink2); padding:7px 14px; border-radius:8px; cursor:pointer; transition:.18s; }
.td-seg button.on { background:var(--surface); color:var(--ink); box-shadow:0 1px 2px rgba(0,0,0,.08); }
.td-row:hover { background:var(--line2); }
.td-icnbtn { border:1px solid var(--line); background:var(--surface); border-radius:9px; width:30px; height:30px;
  display:grid; place-items:center; cursor:pointer; color:var(--ink2); transition:.15s; }
.td-icnbtn:hover { border-color:var(--ink3); color:var(--ink); }
`;

function Badge({ tone, label }) {
  const t = STATUS_TONES[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: t.bg, color: t.fg,
      fontWeight: 600, fontSize: 13, padding: "6px 13px", borderRadius: 999 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: t.dot }} />
      {label}
    </span>
  );
}

function Info({ icon: Icon, label, children }) {
  return (
    <div style={{ display: "flex", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--line2)" }}>
      <Icon size={16} style={{ color: "var(--ink3)", marginTop: 2, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div className="td-label" style={{ marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>{children}</div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, right, children, pad = true }) {
  return (
    <section className="td-card td-fade" style={{ marginBottom: 16, overflow: "hidden" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 9, padding: "15px 18px",
        borderBottom: "1px solid var(--line2)" }}>
        <Icon size={17} style={{ color: "var(--amber)" }} />
        <h3 className="td-display" style={{ margin: 0, fontSize: 15.5, fontWeight: 700, flex: 1 }}>{title}</h3>
        {right}
      </header>
      <div style={{ padding: pad ? 18 : 0 }}>{children}</div>
    </section>
  );
}

function LineItems({ items, emptyLabel }) {
  if (!items.length)
    return <div style={{ padding: "26px 18px", textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>{emptyLabel}</div>;
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} className="td-row" style={{ display: "flex", gap: 14, padding: "13px 18px",
          borderBottom: "1px solid var(--line2)", transition: ".12s" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{it.detail}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 5, fontSize: 11.5, color: "var(--ink3)" }}>
              <span>{it.resource}</span>
              {it.meta && <><span>·</span><span className="td-mono">{it.meta}</span></>}
              <span>·</span><span>{it.qty}</span>
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="td-mono" style={{ fontSize: 14, fontWeight: 500 }}>{money(it.sell)}</div>
            <div className="td-mono" style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>cost {money(it.cost)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const CHK_ICON = {
  y: { Icon: CheckCircle2, color: "#27a062" },
  na: { Icon: MinusCircle, color: "var(--ink3)" },
  open: { Icon: Circle, color: "#cbc6ba" },
};

/* type icon + label + accent for an interaction, matching the lead timeline */
function intMeta(it) {
  if (it.kind === "call")
    return it.dir === "in"
      ? { Icon: PhoneIncoming, label: "Inbound call", color: "#1C7A4A", bg: "rgba(21,115,71,.12)" }
      : { Icon: PhoneOutgoing, label: "Outbound call", color: "#1D5BBF", bg: "rgba(29,91,191,.12)" };
  if (it.kind === "form")
    return { Icon: Globe, label: "Web form", color: "#A86510", bg: "rgba(181,113,13,.13)" };
  return it.dir === "in"
    ? { Icon: Mail, label: "Inbound email", color: "#5A554C", bg: "var(--line2)" }
    : { Icon: Mail, label: "Outbound email", color: "#1D5BBF", bg: "rgba(29,91,191,.12)" };
}

function DetailLabel({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", minWidth: 64 }}>{label}</span>
      <span className="td-mono" style={{ fontSize: 13, color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

function InteractionDetail({ it, onBack, jobId }) {
  const m = intMeta(it);
  const isCall = it.kind === "call";
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  // Fetch full content on mount if this is a real (API-sourced) interaction
  React.useEffect(() => {
    if (!it._real || !jobId) { setDetail(null); return; }
    setLoading(true);
    const params = isCall
      ? `type=call`
      : `type=email&leadId=${it._leadId}`;
    fetch(`/api/jobs/${jobId}/interactions/${it.id}?${params}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [it.id, jobId, isCall, it._real, it._leadId]);

  // Use fetched detail if available, fall back to baked-in sample data
  const transcript = detail?.full_transcript ?? it.transcript;
  const recordingUrl = detail?.recording_url ?? null;
  const operator = detail?.operator ?? it.operator;
  const dur = detail?.duration_seconds != null && !isNaN(detail.duration_seconds)
    ? `${Math.floor(detail.duration_seconds / 60)}:${String(detail.duration_seconds % 60).padStart(2, '0')}`
    : it.dur || "—";
  const emailBody = detail?.email_body ?? it.body;
  const emailFrom = detail?.from_address ?? it.from;
  const emailTo = detail?.to_address ?? it.to;
  const emailSubject = detail?.subject ?? it.subject;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", borderBottom: "1px solid var(--line2)" }}>
        <button className="td-icnbtn" onClick={onBack}><ArrowLeft size={15} /></button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: m.color,
          background: m.bg, padding: "4px 10px", borderRadius: 7 }}>
          <m.Icon size={13} /> {m.label}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink3)", marginLeft: "auto" }}>{it.date} · {it.time}</span>
      </div>

      <div style={{ padding: 18 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--ink3)", padding: 24 }}>Loading…</div>
        ) : isCall ? (
          <>
            <div style={{ display: "flex", gap: 30, marginBottom: 14 }}>
              <DetailLabel label="Operator" value={operator || "—"} />
              <DetailLabel label="Duration" value={dur || "—"} />
            </div>
            {recordingUrl ? (
              <div style={{ marginBottom: 16 }}>
                <audio controls src={recordingUrl} style={{ width: "100%" }} preload="none" />
              </div>
            ) : (
              <div style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)",
                background: "var(--line2)", marginBottom: 16, fontSize: 13, color: "var(--ink3)", textAlign: "center" }}>
                Recording not available
              </div>
            )}
            <div className="td-label" style={{ marginBottom: 7 }}>Transcript</div>
            <div style={{ maxHeight: 300, overflow: "auto", fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-line",
              padding: 14, borderRadius: 10, background: "var(--line2)", border: "1px solid var(--line)" }}>
              {transcript || "Transcript not available yet."}
            </div>
          </>
        ) : (
          <>
            <DetailLabel label="From" value={emailFrom || "—"} />
            <DetailLabel label="To" value={emailTo || "—"} />
            <DetailLabel label="Subject" value={emailSubject || "—"} />
            <div style={{ height: 1, background: "var(--line)", margin: "12px 0 14px" }} />
            <div style={{ maxHeight: 320, overflow: "auto", fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-line" }}>
              {emailBody || "No content available."}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* Map API task data to the component's internal shape */
function mapApiTask(api) {
  if (!api) return null;
  // All dates/times formatted in Australia/Sydney timezone
  const SYD = "Australia/Sydney";
  const fmtDate = (d) => {
    if (!d) return null;
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: SYD });
    } catch { return d; }
  };
  // For AroFlo local datetimes like "2026/06/02 11:12:38" — already in AEST, parse as-is
  const fmtAroDateTime = (d) => {
    if (!d) return null;
    // AroFlo format: "YYYY/MM/DD HH:MM:SS" — already Sydney local time
    const m = String(d).match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
    if (m) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const day = parseInt(m[3], 10);
      const mon = months[parseInt(m[2], 10) - 1];
      const yr = m[1];
      let hr = parseInt(m[4], 10);
      const min = m[5];
      const ampm = hr >= 12 ? "PM" : "AM";
      if (hr > 12) hr -= 12;
      if (hr === 0) hr = 12;
      return `${day} ${mon} ${yr}, ${hr}:${min} ${ampm}`;
    }
    // Fallback: UTC timestamp → format in Sydney
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      return dt.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: SYD });
    } catch { return d; }
  };
  const fmtDuration = (s) => {
    if (s == null || isNaN(s)) return null;
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  const fmtIxDate = (d) => {
    if (!d) return null;
    // interaction datetimes are already Sydney local ("YYYY-MM-DDTHH:MM:SS")
    try {
      const dt = new Date(d + (d.includes("Z") || d.includes("+") ? "" : "Z"));
      // If it looks like a local datetime (no timezone info), parse components directly
      const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${parseInt(m[3],10)} ${months[parseInt(m[2],10)-1]} ${m[1]}`;
      }
      return dt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: SYD });
    } catch { return d; }
  };
  const fmtIxTime = (d) => {
    if (!d) return "—";
    const m = String(d).match(/T(\d{1,2}):(\d{2})/);
    if (m) {
      let hr = parseInt(m[1], 10);
      const min = m[2];
      const ampm = hr >= 12 ? "PM" : "AM";
      if (hr > 12) hr -= 12;
      if (hr === 0) hr = 12;
      return `${hr}:${min} ${ampm}`;
    }
    return "—";
  };
  const labour = (api.labour || []).map((l) => ({
    resource: l.user_username || "—",
    detail: l.note || l.worktype || "—",
    qty: l.hours ? `${l.hours} hrs` : "—",
    meta: l.worktype || "",
    cost: parseFloat(l.cost) || 0,
    sell: parseFloat(l.sell) || 0,
  }));
  const interactions = (api.interactions || []).map((ix) => ({
    id: ix.interaction_id,
    _real: true,
    _leadId: ix.lead_id,
    kind: ix.type === "call" ? "call" : "email",
    dir: (ix.direction || "").toLowerCase().includes("inbound") || (ix.direction || "").toLowerCase().includes("incoming") ? "in" : "out",
    date: fmtIxDate(ix.datetime),
    time: fmtIxTime(ix.datetime),
    operator: ix.operator || "—",
    dur: fmtDuration(ix.duration),
    summary: ix.summary || "",
  }));
  const statusLabel = api.status_label || api.status || "Open";
  return {
    id: `JN${api.job_id}`,
    ref: `${api.ref_no || ""} · JN ${api.job_no}`.replace(/^\s*·\s*/, ""),
    title: api.address || "—",
    location: api.address || "—",
    taskType: api.task_type || "—",
    workType: api.work_type || api.task_type || "—",
    statusKey: api.status || "open",
    statusLabel,
    grade: api.grade || null,
    priority: "—",
    progress: api.status === "completed" ? 100 : 0,
    client: { name: api.client_name || "—", subType: "", rate: api.charge_rate || "—" },
    contact: { name: api.client_name || "—", phone: api.client_phone || "—", email: api.client_email || null },
    people: { owner: "Plumber & Electrician To The Rescue", enteredBy: "—", salesperson: api.salesperson || "—", assigned: api.assigned || "—" },
    campaign: api.campaign || "—",
    dates: {
      requested: fmtAroDateTime(api.logged_datetime) || fmtDate(api.logged_date),
      due: fmtDate(api.due_date),
      completed: api.completed_date ? (fmtAroDateTime(api.completed_datetime) || fmtDate(api.completed_date)) : null,
      updated: fmtAroDateTime(api.last_updated) || fmtDate(api.last_updated),
    },
    description: api.description || "—",
    invoice: null,
    schedule: (api.scheduled_tech && api.scheduled_date) ? { tech: api.scheduled_tech, when: fmtDate(api.scheduled_date) } : null,
    labour,
    materials: [],
    notes: (api.notes || []).map((n) => ({
      author: n.username || "—",
      when: [n.dateposted, n.timeposted].filter(Boolean).join(" "),
      tag: n.filter || "Internal",
      body: n.note_clean || "",
    })),
    interactions,
    checklist: [],
    _jobId: api.job_id,
  };
}

function JobValueOverride({ jobId }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    if (!jobId) return;
    fetch(`/api/jobs/${jobId}/value-override`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.job_value_override != null) {
          setValue(String(d.job_value_override));
          setSaved(d.job_value_override);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [jobId]);

  async function save() {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/value-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_value_override: num }),
      });
      if (r.ok) setSaved(num);
    } finally { setSaving(false); }
  }

  if (!loaded) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>
        Job Value Override
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
        <span style={{ fontSize: 14, color: "var(--ink3)" }}>$</span>
        <input
          type="number"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="e.g. 1116"
          style={{ width: 100, fontSize: 14, fontFamily: "'JetBrains Mono',monospace", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px" }}
        />
        <button
          onClick={save}
          disabled={saving || !value || parseFloat(value) === saved}
          style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: "none", background: saving ? "#ccc" : "#1D5BBF", color: "#fff", cursor: "pointer", opacity: (!value || parseFloat(value) === saved) ? 0.4 : 1 }}
        >
          {saving ? "..." : "Save"}
        </button>
        {saved != null && <span style={{ fontSize: 12, color: "#1C7A4A", fontWeight: 500 }}>✓ ${saved.toLocaleString("en-AU", { minimumFractionDigits: 2 })}</span>}
      </div>
    </div>
  );
}

export default function TaskDetail({ task: taskProp, onBack }) {
  const isDemo = !taskProp;
  const mapped = taskProp ? mapApiTask(taskProp) : null;
  const [key, setKey] = useState("open");
  const [chkOpen, setChkOpen] = useState(false);
  const [selectedInt, setSelectedInt] = useState(null);
  const [statusOverride, setStatusOverride] = useState(null);
  const t = mapped || TASKS[key];
  const active = STATUSES[statusOverride || t.statusKey];
  const displayStatus = t.statusLabel || active.label;

  const labCost = sum(t.labour, "cost"), labSell = sum(t.labour, "sell");
  const matCost = sum(t.materials, "cost"), matSell = sum(t.materials, "sell");
  const totalCost = labCost + matCost, totalSell = labSell + matSell;
  const done = t.checklist.filter((c) => c.state === "y").length;

  return (
    <div className="td-root">
      <style>{css}</style>

      {/* dark header band */}
      <div style={{ background: "var(--navy)", color: "#fff", paddingTop: 16 }}>
        <div className="td-wrap" style={{ paddingBottom: 22 }}>
          {onBack && (
            <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8,
              color: "rgba(255,255,255,.8)", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              padding: "6px 12px", cursor: "pointer", marginBottom: 14, transition: ".15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.18)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,.1)"; e.currentTarget.style.color = "rgba(255,255,255,.8)"; }}>
              <ArrowLeft size={14} /> Back to Jobs
            </button>
          )}
          {isDemo && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <button className="td-seg" style={{ background: "rgba(255,255,255,.1)" }}>
              {[["open", "Open task"], ["completed", "Completed task"]].map(([k, lbl]) => (
                <button key={k} className={key === k ? "on" : ""} onClick={() => { setKey(k); setSelectedInt(null); setStatusOverride(null); }}
                  style={key === k ? {} : { color: "rgba(255,255,255,.65)" }}>{lbl}</button>
              ))}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.45)" }}>Preview status</span>
              <select value={statusOverride || t.statusKey} onChange={(e) => setStatusOverride(e.target.value)}
                style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: "#fff", background: "rgba(255,255,255,.12)",
                  border: "1px solid rgba(255,255,255,.18)", borderRadius: 8, padding: "5px 9px", cursor: "pointer" }}>
                {Object.entries(STATUSES).map(([k, s]) => <option key={k} value={k} style={{ color: "#111" }}>{s.label}</option>)}
              </select>
            </div>
          </div>
          )}

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                {(() => {
                  const tt = (t.taskType || "").toLowerCase();
                  const isElec = tt.includes("electr");
                  const Icon = isElec ? Zap : Droplets;
                  const color = isElec ? "var(--amber)" : "#5BA8E6";
                  const bg = isElec ? "rgba(201,120,28,.18)" : "rgba(91,168,230,.2)";
                  return (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color, background: bg,
                      padding: "4px 10px", borderRadius: 7, whiteSpace: "nowrap" }}>
                      <Icon size={11} style={{ flexShrink: 0 }} />{t.taskType}
                    </span>
                  );
                })()}
                {t.grade && (
                  <span title="Job grade" style={{ fontSize: 12, fontWeight: 700, color: GRADE_TONE[t.grade].fg,
                    background: GRADE_TONE[t.grade].bg, padding: "4px 9px", borderRadius: 7 }}>
                    Grade {t.grade}
                  </span>
                )}
                <span className="td-mono" style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)" }}>JN {t._jobId || t.id}</span>
              </div>
              <h1 className="td-display" style={{ margin: 0, fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{t.title}</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13.5, color: "rgba(255,255,255,.7)" }}>
                <MapPin size={14} /> {t.location}
              </div>
            </div>
            <Badge tone={active.tone} label={displayStatus} />
          </div>
        </div>
      </div>

      {/* status banner — flags terminal / attention states */}
      {active.banner && (
        <div style={{ background: STATUS_TONES[active.tone].bg, borderBottom: `1px solid ${STATUS_TONES[active.tone].dot}33` }}>
          <div className="td-wrap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 20px" }}>
            <active.Icon size={17} style={{ color: STATUS_TONES[active.tone].fg }} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: STATUS_TONES[active.tone].fg }}>{displayStatus}</span>
            {active.sub && <span style={{ fontSize: 13, color: STATUS_TONES[active.tone].fg, opacity: .8 }}>· {active.sub}</span>}
          </div>
        </div>
      )}

      <div className="td-wrap" style={{ marginTop: -14 }}>
        {/* stat strip */}
        <div className="td-card td-fade" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)",
          marginBottom: 16, overflow: "hidden" }}>
          {[
            { Icon: FlagTriangleRight, l: "Priority", v: t.priority },
            { Icon: CalendarClock, l: "Due", v: t.dates.due },
            { Icon: Clock, l: "Progress", v: t.progress + "%" },
            { Icon: Receipt, l: "Job value (ex GST)", v: totalSell ? money(totalSell) : "—" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "15px 16px", borderRight: i < 3 ? "1px solid var(--line2)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <s.Icon size={14} style={{ color: "var(--amber)" }} />
                <span className="td-label">{s.l}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
          {/* ---- left column ---- */}
          <aside>
            <Section icon={Building2} title="Client & contact">
              <Info icon={User} label="Client">
                <a className="td-link" href="#">{t.client.name}</a>
                <div style={{ fontSize: 12.5, color: "var(--ink3)", fontWeight: 400, marginTop: 2 }}>{t.client.subType}</div>
              </Info>
              <Info icon={Tag} label="Charge rate">{t.client.rate}</Info>
              <Info icon={Phone} label="Contact">
                {t.contact.name}
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
                  <a className="td-link td-mono" href={`tel:${t.contact.phone}`} style={{ fontSize: 13 }}>{t.contact.phone}</a>
                  <button className="td-icnbtn" style={{ width: 24, height: 24 }}><Copy size={12} /></button>
                </div>
                {t.contact.email && t.contact.email !== "—" && (
                  <div style={{ marginTop: 3 }}>
                    <a className="td-link" href={`mailto:${t.contact.email}`} style={{ fontSize: 13 }}>{t.contact.email}</a>
                  </div>
                )}
              </Info>
              <Info icon={MapPin} label="Location">{t.location}</Info>
            </Section>

            {t.schedule && (
              <Section icon={CalendarClock} title="Next appointment">
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.schedule.tech}</div>
                <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 3 }}>{t.schedule.when}</div>
              </Section>
            )}

            <Section icon={Calendar} title="Timeline">
              <Info icon={Clock} label="Requested">{t.dates.requested}</Info>
              <Info icon={CalendarClock} label="Due">{t.dates.due}</Info>
              {t.dates.completed && <Info icon={CheckCircle2} label="Completed">{t.dates.completed}</Info>}
              <Info icon={Clock} label="Last updated">{t.dates.updated}</Info>
            </Section>

            <Section icon={UserCog} title="Assignment">
              <Info icon={Building2} label="Owner">{t.people.owner}</Info>
              <Info icon={User} label="Entered by">{t.people.enteredBy}</Info>
              <Info icon={User} label="Salesperson">{t.people.salesperson}</Info>
              <Info icon={Megaphone} label="Campaign">{t.campaign}</Info>
            </Section>

            {/* collapsible completion checklist — hide when empty */}
            {t.checklist.length > 0 && <section className="td-card td-fade" style={{ overflow: "hidden", marginBottom: 16 }}>
              <button onClick={() => setChkOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center",
                gap: 9, padding: "15px 18px", background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit" }}>
                <CheckCircle2 size={17} style={{ color: "var(--amber)" }} />
                <h3 className="td-display" style={{ margin: 0, fontSize: 15.5, fontWeight: 700, flex: 1 }}>Checklist</h3>
                <span className="td-mono" style={{ fontSize: 12, color: "var(--ink3)" }}>{done}/{t.checklist.length}</span>
                <ChevronDown size={18} style={{ color: "var(--ink3)",
                  transform: chkOpen ? "rotate(180deg)" : "none", transition: ".2s" }} />
              </button>
              {chkOpen && (
                <div style={{ borderTop: "1px solid var(--line2)" }}>
                  {t.checklist.map((c, i) => {
                    const m = CHK_ICON[c.state];
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, padding: "10px 18px",
                        borderBottom: i < t.checklist.length - 1 ? "1px solid var(--line2)" : "none" }}>
                        <m.Icon size={16} style={{ color: m.color, flexShrink: 0, marginTop: 1 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, lineHeight: 1.35, color: c.state === "open" ? "var(--ink2)" : "var(--ink)" }}>
                            {c.item}{c.state === "na" && <span className="td-label" style={{ marginLeft: 6 }}>N/A</span>}
                          </div>
                          {c.by && <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 2 }}>{c.by}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>}
          </aside>

          {/* ---- right column ---- */}
          <div>
            <Section icon={FileText} title="Job details">
              <div style={{ display: "flex", gap: 28, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--line2)" }}>
                <div>
                  <div className="td-label" style={{ marginBottom: 5 }}>Job type</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.workType}</div>
                </div>
                <div>
                  <div className="td-label" style={{ marginBottom: 5 }}>Job grade</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: t.grade ? GRADE_TONE[t.grade].fg : "var(--ink3)" }}>{t.grade ? `Grade ${t.grade}` : "—"}</div>
                </div>
                <div>
                  <div className="td-label" style={{ marginBottom: 5 }}>Status</div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: STATUS_TONES[active.tone].fg }}>{displayStatus}</div>
                </div>
              </div>
              <div className="td-label" style={{ marginBottom: 6 }}>Job description</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-line", color: "var(--ink)" }}>{t.description}</p>
            </Section>

            <Section icon={StickyNote} title="Task notes" pad={false}>
              <div>
                {t.notes.map((n, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--line2)" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center",
                      background: n.flag === "pay" ? "rgba(21,115,71,.12)" : "var(--line2)",
                      color: n.flag === "pay" ? "#1C7A4A" : "var(--ink3)" }}>
                      {n.flag === "pay" ? <Receipt size={15} /> : <User size={15} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{n.author}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 7px", borderRadius: 5,
                          background: "var(--line2)", color: "var(--ink3)" }}>{n.tag}</span>
                        <span style={{ fontSize: 11.5, color: "var(--ink3)", marginLeft: "auto" }}>{n.when}</span>
                      </div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={Wrench} title="Labour" pad={false}
              right={t.labour.length ? <span className="td-mono" style={{ fontSize: 13, fontWeight: 600 }}>{money(labSell)}</span> : null}>
              <LineItems items={t.labour} emptyLabel="No labour booked yet." />
            </Section>

            <Section icon={Package} title="Materials" pad={false}
              right={t.materials.length ? <span className="td-mono" style={{ fontSize: 13, fontWeight: 600 }}>{money(matSell)}</span> : null}>
              <LineItems items={t.materials} emptyLabel="No materials booked yet." />
              {totalSell > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 30, padding: "14px 18px",
                  background: "var(--line2)", borderTop: "1px solid var(--line)" }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="td-label">Total cost</div>
                    <div className="td-mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{money(totalCost)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="td-label">Total sell (ex GST)</div>
                    <div className="td-mono td-display" style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>{money(totalSell)}</div>
                  </div>
                </div>
              )}
            </Section>

            <Section icon={MessagesSquare} title="Job interactions" pad={false}
              right={!selectedInt ? <span className="td-mono" style={{ fontSize: 12, color: "var(--ink3)" }}>{t.interactions.length}</span> : null}>
              {selectedInt ? (
                <InteractionDetail it={selectedInt} onBack={() => setSelectedInt(null)} jobId={t._jobId} />
              ) : (
                <div>
                  {/* column header — matches the lead timeline: type · date · time · operator · duration */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 18px",
                    borderBottom: "1px solid var(--line)" }}>
                    <span className="td-label" style={{ flex: 1 }}>Type</span>
                    <span className="td-label" style={{ width: 96 }}>Date</span>
                    <span className="td-label" style={{ width: 64 }}>Time</span>
                    <span className="td-label" style={{ width: 92 }}>Operator</span>
                    <span className="td-label" style={{ width: 52, textAlign: "right" }}>Dur.</span>
                    <span style={{ width: 14 }} />
                  </div>
                  {t.interactions.map((it) => {
                    const m = intMeta(it);
                    return (
                      <button key={it.id} className="td-row" onClick={() => setSelectedInt(it)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
                          borderTop: 0, borderLeft: 0, borderRight: 0, borderBottom: "1px solid var(--line2)",
                          background: "transparent", cursor: "pointer", fontFamily: "inherit",
                          textAlign: "left", transition: ".12s" }}>
                        <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "grid",
                            placeItems: "center", background: m.bg, color: m.color }}>
                            <m.Icon size={14} />
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{m.label}</span>
                        </span>
                        <span style={{ width: 96, fontSize: 12.5, color: "var(--ink2)" }}>{it.date}</span>
                        <span className="td-mono" style={{ width: 64, fontSize: 12.5, color: "var(--ink2)" }}>{it.time}</span>
                        <span style={{ width: 92, fontSize: 12.5, color: "var(--ink2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.operator}</span>
                        <span className="td-mono" style={{ width: 52, fontSize: 12.5, color: "var(--ink2)", textAlign: "right" }}>{it.dur || "—"}</span>
                        <ChevronRight size={15} style={{ color: "var(--ink3)", flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>

            {t.invoice && (
              <Section icon={BadgeCheck} title="Invoice & payment">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div className="td-label" style={{ marginBottom: 3 }}>Invoice {t.invoice.number}</div>
                    <div style={{ fontSize: 13, color: "var(--ink2)" }}>{t.invoice.note}</div>
                  </div>
                  <div className="td-mono td-display" style={{ fontSize: 24, fontWeight: 700, color: "#1C7A4A" }}>{t.invoice.amount}</div>
                </div>
              </Section>
            )}

            {!isDemo && t._jobId && (
              <Section icon={Receipt} title="Job value">
                <JobValueOverride jobId={t._jobId} />
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
