"use client";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Search, Clock, CheckCircle2, XCircle, Archive, FileSignature,
  ChevronRight, Zap, Droplets, ArrowUpDown,
} from "lucide-react";

const ROWS = [
  { id: "JN142758", jobNo: "JN 142758", address: "142 Garden Street, Maroubra", client: "Trent Banfield", phone: "0437 694 614", email: "trentbanfield@hotmail.com", type: "COD Electrical", grade: "B", status: "open", tech: "S. Gerges", logged: "2 Jun 2026", due: "3 Jun 2026", value: null },
  { id: "JN143012", jobNo: "JN 143012", address: "8/40 Bronte Road, Bondi Junction", client: "Strata Plan 5521", phone: "02 9387 1100", email: "admin@strataplan5521.com.au", type: "COD Electrical", grade: "A", status: "quote", tech: "M. Cardona", logged: "1 Jun 2026", due: "6 Jun 2026", value: 4820.0 },
  { id: "JN142990", jobNo: "JN 142990", address: "17 Wentworth Ave, Pagewood", client: "Helen Novak", phone: "0405 221 889", email: "h.novak@gmail.com", type: "COD Plumbing", grade: "B", status: "open", tech: "D. Whitlock", logged: "31 May 2026", due: "4 Jun 2026", value: 615.0 },
  { id: "JN142884", jobNo: "JN 142884", address: "3 Coogee Bay Road, Coogee", client: "Peter Lawson", phone: "0412 770 553", email: "plawson@outlook.com", type: "COD Electrical", grade: "C", status: "cancelled", tech: "S. Gerges", logged: "28 May 2026", due: "30 May 2026", value: null },
  { id: "JN126486", jobNo: "JN 126486", address: "6 The Terrace, Abbotsford", client: "Tina Demetriou", phone: "0422 139 273", email: "tina.demetriou@gmail.com", type: "COD Electrical", grade: "A", status: "completed", tech: "S. Gerges", logged: "14 Oct 2022", due: "15 Oct 2022", value: 1197.79 },
  { id: "JN142771", jobNo: "JN 142771", address: "22 Marine Parade, Maroubra", client: "Anya Petrov", phone: "0438 901 226", email: "anya.petrov@gmail.com", type: "COD Plumbing", grade: "B", status: "completed", tech: "D. Whitlock", logged: "29 May 2026", due: "30 May 2026", value: 880.0 },
  { id: "JN142655", jobNo: "JN 142655", address: "Unit 5, 90 Anzac Pde, Kensington", client: "Marco Bianchi", phone: "0400 558 712", email: "marco.b@bigpond.com", type: "COD Electrical", grade: "C", status: "archived", tech: "M. Cardona", logged: "20 May 2026", due: "—", value: null },
  { id: "JN142940", jobNo: "JN 142940", address: "11 Bream Street, Coogee", client: "Sarah Mitchell", phone: "0419 663 204", email: "sarah.mitchell@me.com", type: "COD Electrical", grade: "A", status: "open", tech: "S. Gerges", logged: "30 May 2026", due: "5 Jun 2026", value: 2340.0 },
  { id: "JN143055", jobNo: "JN 143055", address: "7 Frenchmans Road, Randwick", client: "Body Corp 8841", phone: "02 9326 4477", email: "strata@bc8841.com.au", type: "COD Plumbing", grade: "A", status: "quote", tech: "D. Whitlock", logged: "2 Jun 2026", due: "9 Jun 2026", value: 6150.0 },
  { id: "JN142820", jobNo: "JN 142820", address: "14 Perouse Road, Randwick", client: "James O'Brien", phone: "0414 882 067", email: "jobrien@gmail.com", type: "COD Electrical", grade: "B", status: "completed", tech: "S. Gerges", logged: "26 May 2026", due: "27 May 2026", value: 430.0 },
];

const STATUS = {
  open: { label: "Open", tone: "blue", Icon: Clock },
  quote: { label: "Quote", tone: "amber", Icon: FileSignature },
  cancelled: { label: "Cancelled", tone: "red", Icon: XCircle },
  archived: { label: "Archived", tone: "slate", Icon: Archive },
  completed: { label: "Completed", tone: "green", Icon: CheckCircle2 },
};
const TONES = {
  green: { fg: "#1C7A4A", bg: "rgba(21,115,71,.13)" },
  blue: { fg: "#1D5BBF", bg: "rgba(29,91,191,.12)" },
  amber: { fg: "#A86510", bg: "rgba(181,113,13,.14)" },
  red: { fg: "#B23636", bg: "rgba(178,54,54,.13)" },
  slate: { fg: "#5A554C", bg: "rgba(90,85,76,.13)" },
};
const GRADE = { A: { fg: "#1C7A4A", bg: "rgba(21,115,71,.14)" }, B: { fg: "#A86510", bg: "rgba(181,113,13,.15)" }, C: { fg: "#5A554C", bg: "rgba(90,85,76,.14)" } };

const money = (n) => "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Column keys, default widths, header labels, and frozen count */
const COLS = [
  { key: "view",      w: 56,  label: "",              frozen: true },
  { key: "logged",    w: 86,  label: "Requested",     frozen: true },
  { key: "jn",        w: 72,  label: "Job Number",    frozen: true },
  { key: "status",    w: 108, label: "Status",        frozen: true },
  { key: "type",      w: 96,  label: "Type",          frozen: true, edge: true },
  { key: "client",    w: 170, label: "Client" },
  { key: "addr",      w: 220, label: "Address" },
  { key: "phone",     w: 120, label: "Phone" },
  { key: "email",     w: 200, label: "Email" },
  { key: "tech",      w: 130, label: "Technician" },
  { key: "due",       w: 86,  label: "Due" },
  { key: "completed", w: 86,  label: "Completed" },
];
const FROZEN_COUNT = 5;
const MIN_COL_W = 48;
const STORAGE_KEY = "taskTable.colWidths.v3";

function defaultWidths() {
  const o = {};
  for (const c of COLS) o[c.key] = c.w;
  return o;
}

function loadWidths() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate: must have every key and all numbers
    for (const c of COLS) {
      if (typeof parsed[c.key] !== "number") return null;
    }
    return parsed;
  } catch { return null; }
}

function saveWidths(widths) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch {}
}

function computeLeftOffsets(widths) {
  const left = {};
  let cum = 0;
  for (let i = 0; i < FROZEN_COUNT; i++) {
    left[COLS[i].key] = cum;
    cum += widths[COLS[i].key];
  }
  return left;
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
* { box-sizing:border-box; }
.tt-root { --paper:#F4F2EC; --surface:#FFFFFF; --ink:#181612; --ink2:#5A554C; --ink3:#938D81;
  --line:#E7E3D9; --line2:#F0EDE5; --navy:#16243E; --amber:#C9781C; --hover:#F0EDE5;
  font-family:'Hanken Grotesk',sans-serif; color:var(--ink); background:var(--paper); min-height:100vh; -webkit-font-smoothing:antialiased; }
.tt-display { font-family:'Bricolage Grotesque',sans-serif; letter-spacing:-.01em; }
.tt-mono { font-family:'JetBrains Mono',monospace; font-variant-numeric:tabular-nums; }
.tt-wrap { width:100%; margin:0; }
.tt-card { background:var(--surface); border:1px solid var(--line); border-radius:16px; overflow:hidden; }
.tt-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.tt-scroll::-webkit-scrollbar { height:8px; }
.tt-scroll::-webkit-scrollbar-track { background:var(--line2); border-radius:4px; }
.tt-scroll::-webkit-scrollbar-thumb { background:var(--ink3); border-radius:4px; }
.tt-scroll::-webkit-scrollbar-thumb:hover { background:var(--ink2); }
.tt-th { font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--ink3); text-align:left; padding:11px 14px; white-space:nowrap; background:var(--line2); position:relative; }
.tt-td { padding:12px 14px; font-size:13px; border-top:1px solid var(--line2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tt-tr { cursor:pointer; }
.tt-tr:hover td { background:var(--hover); }
.tt-tr:hover .tt-view-pill { background:var(--line2); }
.tt-sticky { position:sticky; z-index:2; background:var(--surface); }
.tt-th.tt-sticky { z-index:6; background:var(--line2); }
.tt-edge { box-shadow:6px 0 7px -5px rgba(0,0,0,.14); border-right:1px solid var(--line); }
.tt-pill { display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:12px; padding:3px 9px; border-radius:999px; }
.tt-grade { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:7px; font-weight:700; font-size:12px; }
.tt-view-pill { display:inline-block; font-size:12px; font-weight:500; color:var(--ink2);
  background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:2px 12px;
  cursor:pointer; transition:.15s; white-space:nowrap; }
.tt-link { color:var(--navy); text-decoration:none; }
.tt-link:hover { text-decoration:underline; }
.tt-filter { font-family:inherit; font-size:13px; font-weight:600; border:0; background:transparent; color:var(--ink2); padding:7px 13px; border-radius:8px; cursor:pointer; transition:.15s; }
.tt-filter.on { background:var(--navy); color:#fff; }
.tt-search { font-family:inherit; font-size:13px; border:1px solid var(--line); border-radius:10px; padding:8px 12px 8px 34px; width:250px; background:var(--surface); color:var(--ink); outline:none; }
.tt-search:focus { border-color:var(--ink3); }
.tt-flash { background:var(--navy); color:#fff; border-radius:12px; padding:12px 16px; font-size:13.5px; margin-bottom:14px; display:flex; align-items:center; gap:8px; animation:ttIn .3s ease; }
@keyframes ttIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
.tt-resize-handle { position:absolute; top:0; right:0; width:5px; height:100%; cursor:col-resize; z-index:10; }
.tt-resize-handle:hover, .tt-resize-handle.active { background:rgba(0,0,0,.12); }
.tt-reset-btn { font-family:inherit; font-size:11px; color:var(--ink3); background:none; border:none; cursor:pointer; padding:4px 8px; border-radius:6px; }
.tt-reset-btn:hover { background:var(--line2); color:var(--ink2); }
`;

function TypeLabel({ type }) {
  const t = (type || "").toLowerCase();
  const isElec = t.includes("electr");
  const isPlumb = t.includes("plumb");
  const Icon = isElec ? Zap : isPlumb ? Droplets : Zap;
  const color = isElec ? "var(--amber)" : isPlumb ? "#1D5BBF" : "var(--ink3)";
  // Strip "Plumbing"/"Electrical", replace Acc' with Account
  let label = (type || "").replace(/\s*(plumbing|electrical)\s*/gi, "").replace(/Acc'/g, "Account").trim();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink2)" }}>
      <Icon size={12} style={{ color, flexShrink: 0 }} />{label}
    </span>
  );
}

function StatusPill({ s }) {
  const cfg = STATUS[s], tn = TONES[cfg.tone];
  return <span className="tt-pill" style={{ background: tn.bg, color: tn.fg }}><cfg.Icon size={12} />{cfg.label}</span>;
}

const PAGE_SIZES = [25, 100, 250, 500];

export default function TaskTable({ onOpenTask, rows: externalRows }) {
  const data = externalRows || ROWS;
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState(null);
  const [pageSize, setPageSize] = useState(100);
  const [widths, setWidths] = useState(() => loadWidths() || defaultWidths());
  const dragRef = useRef(null);

  // Persist widths on change
  useEffect(() => { saveWidths(widths); }, [widths]);

  const left = useMemo(() => computeLeftOffsets(widths), [widths]);

  const resetWidths = useCallback(() => {
    const defs = defaultWidths();
    setWidths(defs);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const onResizeStart = useCallback((e, colKey) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    // Read current width from the actual <col> element to avoid stale closure
    const th = e.currentTarget.parentElement;
    const startW = th ? th.offsetWidth : 100;
    const handle = e.currentTarget;
    handle.classList.add("active");

    const onMove = (ev) => {
      const newW = Math.max(MIN_COL_W, startW + (ev.clientX - startX));
      setWidths((prev) => ({ ...prev, [colKey]: newW }));
    };
    const onUp = () => {
      handle.classList.remove("active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    dragRef.current = { colKey };
  }, []);

  const counts = useMemo(() => {
    const c = { all: data.length };
    for (const r of data) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.filter((r) => (filter === "all" || r.status === filter) &&
      (!term || [r.address, r.client, r.jobNo, r.tech, r.phone, r.email].some((v) => (v || "").toLowerCase().includes(term))));
  }, [data, filter, q]);

  const open = (r) => {
    if (onOpenTask) return onOpenTask(r.id);
    setFlash(`Open → ${r.address} (${r.jobNo}). In the app this routes to the task detail view.`);
    setTimeout(() => setFlash(null), 3200);
  };

  const visible = rows.slice(0, pageSize);
  const filters = [["all", "All"], ["open", "Open"], ["quote", "Quote"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["archived", "Archived"]];
  const stop = (e) => e.stopPropagation();

  function stickyProps(colIdx) {
    const col = COLS[colIdx];
    if (!col.frozen) return {};
    return {
      style: { left: left[col.key] },
      className: `tt-sticky${col.edge ? " tt-edge" : ""}`,
    };
  }

  return (
    <div className="tt-root">
      <style>{css}</style>
      <div className="tt-wrap" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16, gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 className="tt-display" style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Tasks</h1>
              <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 3 }}>
                {visible.length === rows.length ? rows.length : `${visible.length} of ${rows.length}`} jobs
                {rows.length < data.length && ` (filtered from ${data.length})`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 11, top: 10, color: "var(--ink3)" }} />
                <input className="tt-search" placeholder="Search address, client, job no, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button className="tt-reset-btn" onClick={resetWidths}>Reset columns</button>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink2)",
                  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8,
                  padding: "7px 10px", cursor: "pointer" }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} rows</option>)}
              </select>
            </div>
          </div>

          {flash && <div className="tt-flash"><ChevronRight size={15} />{flash}</div>}

          <div style={{ display: "inline-flex", gap: 2, background: "rgba(0,0,0,.04)", borderRadius: 10, padding: 3, marginBottom: 14 }}>
            {filters.map(([k, lbl]) => (
              <button key={k} className={"tt-filter" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
                {lbl}<span style={{ opacity: .6, marginLeft: 6 }}>{counts[k] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="tt-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div className="tt-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: COLS.reduce((s, c) => s + widths[c.key], 0) }}>
              <colgroup>
                {COLS.map((c) => <col key={c.key} style={{ width: widths[c.key] }} />)}
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
                <tr>
                  {COLS.map((c, i) => {
                    const sp = stickyProps(i);
                    const isLogged = c.key === "logged";
                    const isValue = c.key === "value";
                    return (
                      <th key={c.key}
                        className={`tt-th${sp.className ? " " + sp.className : ""}`}
                        style={{ ...sp.style, ...(isValue ? { textAlign: "right" } : {}) }}
                      >
                        {isLogged
                          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{c.label} <ArrowUpDown size={11} /></span>
                          : c.label}
                        <div className="tt-resize-handle"
                          onMouseDown={(e) => onResizeStart(e, c.key)} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="tt-tr" onClick={() => open(r)}>
                    {/* 0: view */}
                    <td className={`tt-td ${stickyProps(0).className || ""}`} style={{ ...stickyProps(0).style, textAlign: "center" }}>
                      <span className="tt-view-pill" onClick={(e) => { stop(e); open(r); }}>View</span>
                    </td>
                    {/* 1: requested */}
                    <td className={`tt-td tt-mono ${stickyProps(1).className || ""}`} style={{ ...stickyProps(1).style, color: "var(--ink2)", fontSize: 12 }}>{r.logged}</td>
                    {/* 2: job number */}
                    <td className={`tt-td tt-mono ${stickyProps(2).className || ""}`} style={{ ...stickyProps(2).style, fontWeight: 500 }}>{r.jobNo}</td>
                    {/* 3: status */}
                    <td className={`tt-td ${stickyProps(3).className || ""}`} style={stickyProps(3).style}><StatusPill s={r.status} /></td>
                    {/* 4: type */}
                    <td className={`tt-td ${stickyProps(4).className || ""}`} style={stickyProps(4).style}><TypeLabel type={r.type} /></td>
                    {/* client */}
                    <td className="tt-td" style={{ fontWeight: 600 }} title={r.client}>{r.client}</td>
                    {/* address */}
                    <td className="tt-td" title={r.address}>{r.address}</td>
                    {/* phone */}
                    <td className="tt-td tt-mono" style={{ color: "var(--ink2)" }}>
                      <a className="tt-link" href={`tel:${(r.phone || "").replace(/\s/g, "")}`} onClick={stop}>{r.phone}</a>
                    </td>
                    {/* email */}
                    <td className="tt-td" style={{ color: "var(--ink2)" }} title={r.email}>
                      <a className="tt-link" href={`mailto:${r.email}`} onClick={stop}>{r.email}</a>
                    </td>
                    {/* technician */}
                    <td className="tt-td" style={{ color: "var(--ink2)" }}>{r.tech}</td>
                    {/* due */}
                    <td className="tt-td tt-mono" style={{ color: "var(--ink2)", fontSize: 12 }}>{r.due}</td>
                    {/* completed */}
                    <td className="tt-td tt-mono" style={{ color: "var(--ink2)", fontSize: 12 }}>{r.completed || "—"}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td className="tt-td" colSpan={COLS.length} style={{ textAlign: "center", color: "var(--ink3)", padding: "32px" }}>No tasks match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > pageSize && (
            <div style={{ flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--line2)",
              fontSize: 12.5, color: "var(--ink3)", textAlign: "center" }}>
              Showing {visible.length} of {rows.length} — increase page size to see more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
