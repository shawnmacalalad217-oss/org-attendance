// Attendance list for one event (officers), live updates, search, CSV.
import {
  doc, getDoc, deleteDoc, collection, query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, $, requireLogin, toast, escapeHtml, formatDate, formatTime, getParam, downloadCSV, isOfficerRole,
} from "./common.js";

const orgId = getParam("org");
const eventId = getParam("event");
let org = null, eventData = null;
let rows = [];

requireLogin(async (user) => {
  if (!orgId || !eventId) { window.location.href = "home.html"; return; }
  const mine = await getDoc(doc(db, "orgs", orgId, "members", user.uid));
  if (!mine.exists() || !isOfficerRole(mine.data().role)) {
    toast("Only officers can view attendance lists.", "error");
    setTimeout(() => { window.location.href = `org.html?org=${orgId}`; }, 1200);
    return;
  }
  const [orgSnap, evSnap] = await Promise.all([
    getDoc(doc(db, "orgs", orgId)), getDoc(doc(db, "orgs", orgId, "events", eventId)),
  ]);
  if (!evSnap.exists()) { toast("Event not found.", "error"); return; }
  org = orgSnap.data(); eventData = evSnap.data();
  $("#org-name").textContent = org.name;
  $("#back-link").href = `org.html?org=${orgId}&tab=events`;
  $("#event-title").textContent = eventData.name;
  $("#event-meta").textContent = formatDate(eventData.date) + (eventData.venue ? " · " + eventData.venue : "");
  $("#scan-link").href = `scanner.html?org=${orgId}&event=${eventId}`;
  document.title = `Attendance - ${eventData.name}`;

  onSnapshot(query(collection(db, "orgs", orgId, "attendance"), where("eventId", "==", eventId)), (s) => {
    rows = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.timeIn?.toMillis?.() ?? Date.now()) - (b.timeIn?.toMillis?.() ?? Date.now()));
    render();
  }, (err) => {
    console.error(err);
    $("#att-body").innerHTML = '<tr><td colspan="6" class="empty">Could not load attendance.</td></tr>';
  });
});

$("#search").addEventListener("input", render);

function render() {
  const term = $("#search").value.trim().toLowerCase();
  const shown = rows.filter((r) => !term || `${r.fullName} ${r.studentNo} ${r.courseYear}`.toLowerCase().includes(term));
  $("#att-count").textContent = rows.length;
  if (!shown.length) {
    $("#att-body").innerHTML = `<tr><td colspan="6" class="empty">${rows.length ? "No match." : "No attendees yet."}</td></tr>`;
    return;
  }
  $("#att-body").innerHTML = shown.map((r, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(r.fullName)}</td><td>${escapeHtml(r.studentNo)}</td>
      <td>${escapeHtml(r.courseYear)}</td><td>${escapeHtml(formatTime(r.timeIn))}</td>
      <td><button class="btn btn-sm btn-danger" data-remove="${escapeHtml(r.id)}" data-name="${escapeHtml(r.fullName)}">Remove</button></td></tr>`).join("");
  document.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Remove ${b.dataset.name} from this event's attendance?`)) return;
    try { await deleteDoc(doc(db, "orgs", orgId, "attendance", b.dataset.remove)); toast("Removed.", "success"); }
    catch (err) { console.error(err); toast("Could not remove.", "error"); }
  }));
}

$("#csv-btn").addEventListener("click", () => {
  if (!rows.length) return toast("No attendees to download yet.", "error");
  downloadCSV([
    [org?.name || "", eventData?.name || "", formatDate(eventData?.date), eventData?.venue || ""],
    [],
    ["#", "Name", "Student No.", "Course & Year", "Time In"],
    ...rows.map((r, i) => [i + 1, r.fullName, r.studentNo, r.courseYear, formatTime(r.timeIn)]),
    [],
    ["Total attendees", rows.length],
  ], `Attendance-${(eventData?.name || "event").replace(/[^a-z0-9]+/gi, "-")}-${eventData?.date || ""}.csv`);
});
