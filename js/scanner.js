// QR scanner for one event of one org. Reads a member's personal QR code,
// checks that they are an active member of THIS org, and records attendance.
import {
  doc, getDoc, getDocs, collection, query, where, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, $, requireLogin, toast, escapeHtml, formatDate, formatTime, formatDateTime, getParam, eventWhen, eventStatus,
  cleanStudentNo, isValidStudentNo, isOfficerRole, membershipStatus, parseQr,
} from "./common.js";

const orgId = getParam("org");
const eventId = getParam("event");
let org = null, eventData = null;
let scanner = null;
let busy = false;
let lastCode = "", lastTime = 0;
const recent = [];

requireLogin(async (user) => {
  if (!orgId || !eventId) { window.location.href = "home.html"; return; }
  const mine = await getDoc(doc(db, "orgs", orgId, "members", user.uid));
  if (!mine.exists() || !isOfficerRole(mine.data().role)) {
    toast("Only officers can scan attendance.", "error");
    setTimeout(() => { window.location.href = `org.html?org=${orgId}`; }, 1200);
    return;
  }
  const [orgSnap, evSnap] = await Promise.all([
    getDoc(doc(db, "orgs", orgId)),
    getDoc(doc(db, "orgs", orgId, "events", eventId)),
  ]);
  if (!evSnap.exists()) { toast("Event not found.", "error"); return; }
  org = orgSnap.data();
  eventData = evSnap.data();
  $("#org-name").textContent = org.name;
  $("#back-link").href = `org.html?org=${orgId}&tab=events`;
  $("#event-title").textContent = eventData.name;
  $("#event-meta").textContent = eventWhen(eventData) + (eventData.venue ? " · " + eventData.venue : "");
  $("#view-attendance-link").href = `attendance.html?org=${orgId}&event=${eventId}`;
  document.title = `Scan - ${eventData.name}`;
  applyWindow();
  setInterval(applyWindow, 15000);   // close automatically when the end time passes

  onSnapshot(query(collection(db, "orgs", orgId, "attendance"), where("eventId", "==", eventId)), (s) => {
    $("#live-count").textContent = s.size;
  });
});

// ---------- Scan window (start time - 30 min  ...  end time) ----------
function applyWindow() {
  if (!eventData) return;
  const s = eventStatus(eventData);
  const note = $("#window-notice");
  const closed = !s.canScan;
  $("#start-btn").disabled = closed;
  $("#manual-btn").disabled = closed;
  $("#manualNo").disabled = closed;
  if (s.state === "ended") {
    note.className = "notice notice-warn";
    note.innerHTML = `<strong>This event has ended.</strong> Scanning closed at ${escapeHtml(formatTime(s.endsAt))}. You can still view and download the attendance list.`;
    if (scanner) stopCamera();
    showResult("idle", "Scanning closed", "This event has ended.");
  } else if (s.state === "upcoming") {
    note.className = "notice";
    note.innerHTML = `Scanning opens at <strong>${escapeHtml(formatDateTime(s.opensAt))}</strong> (30 minutes before the event starts). This page will unlock automatically.`;
    showResult("idle", "Not open yet", `Scanning opens at ${formatDateTime(s.opensAt)}.`);
  } else if (s.endsAt) {
    note.className = "notice";
    note.innerHTML = `Scanning is open until <strong>${escapeHtml(formatTime(s.endsAt))}</strong>.`;
    if ($("#scan-result").textContent.includes("Not open yet")) showResult("idle", "Ready to scan", "Point the camera at a member's QR code.");
  } else {
    note.className = "notice hidden";
  }
}

// ---------- Camera ----------
$("#start-btn").addEventListener("click", startCamera);
$("#stop-btn").addEventListener("click", stopCamera);

async function startCamera() {
  if (eventData && !eventStatus(eventData).canScan) { applyWindow(); return; }
  try {
    $("#reader").innerHTML = "";
    // eslint-disable-next-line no-undef
    scanner = new Html5Qrcode("reader");
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => handleQr(text),
      () => {}
    );
    $("#start-btn").classList.add("hidden");
    $("#stop-btn").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    $("#reader").innerHTML = '<div class="reader-placeholder">Camera could not start.<br>Allow camera access, or use manual entry below.</div>';
    toast("Camera not available. Allow camera permission and try again.", "error");
  }
}

async function stopCamera() {
  if (scanner) {
    try { await scanner.stop(); } catch (e) { /* already stopped */ }
    scanner.clear();
    scanner = null;
  }
  $("#reader").innerHTML = '<div class="reader-placeholder">Camera is off.<br>Click "Start camera" to begin scanning.</div>';
  $("#stop-btn").classList.add("hidden");
  $("#start-btn").classList.remove("hidden");
}

// ---------- Inputs ----------
function handleQr(text) {
  const now = Date.now();
  if (busy || !eventData) return;
  if (text === lastCode && now - lastTime < 4000) return; // same QR still in view
  lastCode = text; lastTime = now;
  const uid = parseQr(text);
  if (!uid) {
    showResult("error", "Invalid QR code", "This is not a member QR code from this website.");
    addRecent("Unknown QR", "Invalid", "error");
    beep(false);
    return;
  }
  record(uid);
}

$("#manual-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const studentNo = cleanStudentNo($("#manualNo").value);
  $("#manualNo").value = "";
  if (busy || !eventData) return;
  if (!isValidStudentNo(studentNo)) return toast("Enter a valid student number.", "error");
  busy = true;
  try {
    const snap = await getDocs(query(collection(db, "orgs", orgId, "members"), where("studentNo", "==", studentNo)));
    busy = false;
    if (snap.empty) {
      showResult("error", "Not a member", `${studentNo} is not a member of ${org.name}.`);
      addRecent(studentNo, "Not a member", "error");
      beep(false);
      return;
    }
    record(snap.docs[0].data().uid);
  } catch (err) {
    busy = false;
    console.error(err);
    showResult("error", "Could not search", "Check your internet connection.");
  }
});

// ---------- Recording ----------
async function record(uid) {
  if (!eventStatus(eventData).canScan) { applyWindow(); return; }
  busy = true;
  showResult("idle", "Checking...", "");
  try {
    const memberSnap = await getDoc(doc(db, "orgs", orgId, "members", uid));
    if (!memberSnap.exists()) {
      showResult("error", "Not a member", `This person is not a member of ${org.name}.`);
      addRecent("Not a member", "Not a member", "error");
      beep(false);
      return;
    }
    const member = memberSnap.data();
    if (membershipStatus(member).expired) {
      showResult("error", "Membership expired", `${member.fullName} must re-register before attending.`);
      addRecent(member.fullName, "Expired", "error");
      beep(false);
      return;
    }
    const attRef = doc(db, "orgs", orgId, "attendance", `${eventId}_${uid}`);
    const result = await runTransaction(db, async (tx) => {
      const existing = await tx.get(attRef);
      if (existing.exists()) return { duplicate: true, data: existing.data() };
      tx.set(attRef, {
        eventId,
        eventName: eventData.name,
        eventDate: eventData.date,
        uid,
        fullName: member.fullName,
        studentNo: member.studentNo,
        courseYear: member.courseYear,
        timeIn: serverTimestamp(),
      });
      return { duplicate: false };
    });
    if (result.duplicate) {
      showResult("warning", "Already recorded", `${member.fullName} timed in at ${formatTime(result.data.timeIn)}.`);
      addRecent(member.fullName, "Already in", "warning");
      beep(false);
    } else {
      showResult("success", `Welcome, ${member.fullName}!`, `${member.courseYear} · Time in ${formatTime(new Date())}`);
      addRecent(member.fullName, "Recorded", "success");
      beep(true);
    }
  } catch (err) {
    console.error(err);
    if (err.code === "permission-denied") {
      showResult("error", "Scanning closed", "The database only accepts scans during the event time.");
      applyWindow();
    } else {
      showResult("error", "Could not save", "Check your internet connection and try again.");
    }
  } finally {
    busy = false;
  }
}

function showResult(type, title, detail) {
  const box = $("#scan-result");
  box.className = `scan-result result-${type}`;
  box.innerHTML = `<div class="big">${escapeHtml(title)}</div><div>${escapeHtml(detail)}</div>`;
}

function addRecent(name, label, type) {
  recent.unshift({ name, label, type, time: formatTime(new Date()) });
  recent.splice(8);
  $("#recent-list").innerHTML = recent.map((r) => `
    <li><span>${escapeHtml(r.name)} <span class="muted small">${r.time}</span></span>
        <span class="tag tag-${r.type}">${escapeHtml(r.label)}</span></li>`).join("");
}

function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + (ok ? 0.15 : 0.35));
    if (navigator.vibrate) navigator.vibrate(ok ? 80 : [80, 60, 80]);
  } catch (e) { /* no sound */ }
}
