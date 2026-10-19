// Shared code used by every page: Firebase setup, login guard, roles,
// membership expiry, QR cards and small helpers.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { SITE_NAME, UNIVERSITY_NAME, CONTACT_EMAIL, DATA_REGION, POLICY_UPDATED } from "./site-config.js";

export { SITE_NAME, UNIVERSITY_NAME };

window.__appLoaded = true;

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export let auth = null;
export let db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// ---------- Roles ----------
export const ROLE_LABELS = {
  president: "President",
  vice_president: "Vice President",
  secretary: "Secretary",
  treasurer: "Treasurer",
  member: "Member",
};
export const OFFICER_ROLES = ["president", "vice_president", "secretary", "treasurer"];
export const isOfficerRole = (role) => OFFICER_ROLES.includes(role);
export const canManageMembers = (role) => role === "president" || role === "vice_president";

// Which roles can `actorRole` give to someone who currently has `targetRole`?
// (Must match the Firestore rules.)
export function assignableRoles(actorRole, targetRole) {
  if (actorRole === "president" && targetRole !== "president") {
    return ["vice_president", "secretary", "treasurer", "member"];
  }
  if (actorRole === "vice_president" && ["member", "secretary", "treasurer"].includes(targetRole)) {
    return ["secretary", "treasurer", "member"];
  }
  return [];
}
export function canRemove(actorRole, targetRole) {
  if (actorRole === "president") return targetRole !== "president";
  if (actorRole === "vice_president") return ["member", "secretary", "treasurer"].includes(targetRole);
  return false;
}

// ---------- Membership duration and expiry ----------
// Every membership lasts 1 year from the day the member registers or re-registers.
export const MEMBERSHIP_MINUTES = 60 * 24 * 365;
export const DEFAULT_DURATION = MEMBERSHIP_MINUTES;
export function durationLabel() {
  return "1 year";
}

// Officers keep their membership while holding a position; only plain
// members expire. Returns { expired, expiresAt (Date|null), officer }.
export function membershipStatus(m) {
  if (!m) return { expired: true, expiresAt: null, officer: false };
  if (isOfficerRole(m.role)) return { expired: false, expiresAt: null, officer: true };
  const joined = toMillis(m.joinedAt) ?? Date.now();
  const expiresAt = new Date(joined + (m.durationMinutes || 0) * 60000);
  return { expired: Date.now() >= expiresAt.getTime(), expiresAt, officer: false };
}

// ---------- Event times ----------
// Officers may start scanning this many minutes before the event starts.
// After the end time, scanning is closed (also enforced by firestore.rules).
export const SCAN_EARLY_MINUTES = 30;

export function formatClock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}
// "Mon, October 20, 2026 · 8:00 AM – 9:00 PM"
export function eventWhen(ev) {
  if (!ev) return "";
  const d = formatDate(ev.date);
  return ev.startTime && ev.endTime ? `${d} · ${formatClock(ev.startTime)} – ${formatClock(ev.endTime)}` : d;
}
// { state: "upcoming" | "open-early" | "ongoing" | "ended" | "untimed", canScan, opensAt, endsAt }
export function eventStatus(ev, now = Date.now()) {
  const start = toMillis(ev && ev.startAt), end = toMillis(ev && ev.endAt);
  if (start == null || end == null) return { state: "untimed", canScan: true, opensAt: null, endsAt: null };
  const opens = start - SCAN_EARLY_MINUTES * 60000;
  if (now > end) return { state: "ended", canScan: false, opensAt: new Date(opens), endsAt: new Date(end) };
  if (now < opens) return { state: "upcoming", canScan: false, opensAt: new Date(opens), endsAt: new Date(end) };
  return { state: now < start ? "open-early" : "ongoing", canScan: true, opensAt: new Date(opens), endsAt: new Date(end) };
}
export function eventStatusPill(ev) {
  const s = eventStatus(ev);
  return {
    upcoming: '<span class="status status-upcoming">Upcoming</span>',
    "open-early": '<span class="status status-active">Starting soon &middot; scanning open</span>',
    ongoing: '<span class="status status-active">Ongoing</span>',
    ended: '<span class="status status-ended">Ended</span>',
    untimed: "",
  }[s.state];
}

// ---------- DOM helpers ----------
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function fillSiteName() {
  $$("[data-site-name]").forEach((el) => { el.textContent = SITE_NAME; });
  $$("[data-university-name]").forEach((el) => { el.textContent = UNIVERSITY_NAME; });
  $$("[data-data-region]").forEach((el) => { el.textContent = DATA_REGION; });
  $$("[data-policy-updated]").forEach((el) => { el.textContent = POLICY_UPDATED; });
  const hasEmail = CONTACT_EMAIL && !CONTACT_EMAIL.startsWith("PASTE");
  $$("[data-contact-email]").forEach((el) => {
    if (hasEmail) { el.textContent = CONTACT_EMAIL; el.href = `mailto:${CONTACT_EMAIL}`; }
    else { el.textContent = "the project team"; el.removeAttribute("href"); }
  });
  const y = $("#footer-year");
  if (y) y.textContent = new Date().getFullYear();
}

// Mobile menu button + show "My Orgs" instead of "Log in" on public pages
// when the visitor is already logged in.
let navReady = false;
function setupNav() {
  if (navReady) return;
  navReady = true;
  const page = location.pathname.split("/").pop() || "index.html";
  $$(".nav a").forEach((a) => { if (a.getAttribute("href") === page) a.classList.add("active"); });
  const toggle = $(".nav-toggle");
  const nav = $(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  if (configured && $$(".guest-only, .user-only").length) {
    onAuthStateChanged(auth, (user) => {
      $$(".guest-only").forEach((el) => el.classList.toggle("hidden", !!user));
      $$(".user-only").forEach((el) => el.classList.toggle("hidden", !user));
    });
  }
}

export function checkConfig() {
  fillSiteName();
  setupNav();
  if (configured) return true;
  const banner = document.createElement("div");
  banner.className = "config-banner";
  banner.innerHTML = "<strong>Setup needed:</strong> paste your Firebase config into " +
    "<code>js/firebase-config.js</code>, save, then refresh this page.";
  document.body.prepend(banner);
  return false;
}

export function toast(message, type = "info") {
  let box = $("#toast-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-box";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ---------- Login guard ----------
// Calls onReady(user, profile, isAdmin). Sends logged-out visitors to login.
export function requireLogin(onReady) {
  if (!checkConfig()) return;
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      window.location.href = `login.html?next=${next}`;
      return;
    }
    const [profileSnap, adminSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "admins", user.uid)).catch(() => null),
    ]);
    const profile = profileSnap.exists() ? profileSnap.data() : null;
    const admin = !!(adminSnap && adminSnap.exists());

    const who = $("#user-name");
    if (who) who.textContent = profile ? profile.fullName : user.email;
    const adminLink = $("#admin-link");
    if (adminLink) adminLink.classList.toggle("hidden", !admin);
    const out = $("#logout-btn");
    if (out) out.onclick = async () => { await signOut(auth); window.location.href = "index.html"; };

    onReady(user, profile, admin);
  });
}

// ---------- Formatting ----------
export function toMillis(ts) {
  if (!ts) return null;
  if (ts.toMillis) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return new Date(ts).getTime();
}
export function formatTime(ts) {
  const ms = toMillis(ts);
  if (ms == null) return "just now";
  return new Date(ms).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}
export function formatDateTime(ts) {
  const ms = toMillis(ts);
  if (ms == null) return "just now";
  return new Date(ms).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
export function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-PH", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}
export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
export function cleanStudentNo(value) {
  return String(value || "").trim().toUpperCase();
}
export function isValidStudentNo(value) {
  return /^[A-Z0-9-]{4,20}$/.test(value);
}
export function roleBadge(role) {
  return `<span class="role role-${escapeHtml(role)}">${escapeHtml(ROLE_LABELS[role] || role)}</span>`;
}

// ---------- CSV ----------
export function downloadCSV(rows, filename) {
  const csv = rows.map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Personal QR code ----------
// One QR per person, used for every org they join. It holds their account ID.
export const QR_PREFIX = "OEA:";
export const qrPayload = (uid) => QR_PREFIX + uid;
export function parseQr(text) {
  const t = String(text || "").trim();
  return t.startsWith(QR_PREFIX) ? t.slice(QR_PREFIX.length) : null;
}

export function renderQrCard(container, { uid, fullName = "", studentNo = "", courseYear = "" }) {
  container.innerHTML = "";
  const qrHolder = document.createElement("div");
  qrHolder.className = "qr-holder";
  container.appendChild(qrHolder);
  // eslint-disable-next-line no-undef
  new QRCode(qrHolder, { text: qrPayload(uid), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });

  const info = document.createElement("div");
  info.className = "qr-info";
  info.innerHTML = `
    ${fullName ? `<div class="qr-name">${escapeHtml(fullName)}</div>` : ""}
    ${studentNo ? `<div class="qr-id">${escapeHtml(studentNo)}</div>` : ""}
    ${courseYear ? `<div class="qr-course">${escapeHtml(courseYear)}</div>` : ""}`;
  container.appendChild(info);

  return function downloadCard() {
    const qrCanvas = qrHolder.querySelector("canvas");
    if (!qrCanvas) return;
    const W = 420, H = 560;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#137a43"; g.fillRect(0, 0, W, 64);
    g.fillStyle = "#ffffff"; g.font = "bold 20px Arial"; g.textAlign = "center";
    g.fillText(SITE_NAME, W / 2, 40);
    g.drawImage(qrCanvas, (W - 280) / 2, 96, 280, 280);
    g.fillStyle = "#111827"; g.font = "bold 22px Arial";
    if (fullName) g.fillText(fullName, W / 2, 420);
    g.font = "18px Arial"; g.fillStyle = "#374151";
    if (studentNo) g.fillText(studentNo, W / 2, 452);
    if (courseYear) g.fillText(courseYear, W / 2, 480);
    g.font = "14px Arial"; g.fillStyle = "#6b7280";
    g.fillText("Use this QR code for all your org events", W / 2, 530);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `My-QR-${studentNo || "code"}.png`;
    a.click();
  };
}
