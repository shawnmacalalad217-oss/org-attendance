// Organization page. Everyone sees their membership and events; officers
// also manage events and see members; President/VP manage roles and settings.
import {
  doc, getDoc, getDocs, updateDoc, deleteDoc, addDoc, collection, query, where,
  writeBatch, getCountFromServer, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, $, $$, requireLogin, toast, escapeHtml, getParam, roleBadge, membershipStatus,
  formatDate, formatDateTime, eventWhen, eventStatus, eventStatusPill, formatTime, isOfficerRole, canManageMembers, assignableRoles,
  canRemove, ROLE_LABELS, renderQrCard, downloadCSV,
} from "./common.js";

const orgId = getParam("org");
let me = null, profile = null;
let org = null;          // org document data
let myMember = null;     // my membership in this org
let myRole = "member";
let members = [];        // officers only
let myAttendance = [];   // my attendance records
let downloadCard = null;

requireLogin(async (user, prof) => {
  me = user; profile = prof;
  if (!orgId) { window.location.href = "home.html"; return; }
  try {
    const [orgSnap, memSnap] = await Promise.all([
      getDoc(doc(db, "orgs", orgId)),
      getDoc(doc(db, "orgs", orgId, "members", me.uid)),
    ]);
    if (!orgSnap.exists()) { toast("Organization not found.", "error"); setTimeout(() => { window.location.href = "home.html"; }, 1200); return; }
    if (!memSnap.exists()) { toast("You are not a member of this organization yet.", "error"); setTimeout(() => { window.location.href = "home.html"; }, 1500); return; }
    org = orgSnap.data();
    myMember = memSnap.data();
    myRole = myMember.role;
  } catch (err) {
    console.error(err);
    toast("Could not load the organization.", "error");
    return;
  }

  document.title = org.name;
  $("#org-name").textContent = org.name;
  $("#org-desc").textContent = org.description || "";
  $("#my-role-badge").innerHTML = `<span class="muted small">Your role:</span> ${roleBadge(myRole)}`;

  // Show officer / manager tabs and tools
  $$(".officer-only").forEach((el) => el.classList.toggle("hidden", !isOfficerRole(myRole)));
  $$(".manager-only").forEach((el) => el.classList.toggle("hidden", !canManageMembers(myRole)));

  renderMembership();
  await loadMyAttendance();
  await loadEvents();
  if (isOfficerRole(myRole)) await loadMembers();
  if (canManageMembers(myRole)) fillSettings();
  const tab = getParam("tab");
  if (tab && $(`.tab[data-tab="${tab}"]:not(.hidden)`)) showTab(tab);
});

// ---------- Tabs ----------
$$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${name}`));
}

// ---------- My membership ----------
function renderMembership() {
  const s = membershipStatus(myMember);
  let statusHtml;
  if (s.officer) statusHtml = '<span class="status status-officer">Active (officer)</span>';
  else if (s.expired) statusHtml = '<span class="status status-expired">Expired</span>';
  else statusHtml = '<span class="status status-active">Active</span>';

  $("#membership-box").innerHTML = `
    <dl class="kv">
      <dt>Role</dt><dd>${roleBadge(myRole)}</dd>
      <dt>Status</dt><dd>${statusHtml}</dd>
      <dt>${s.officer ? "Joined / renewed" : "Registered"}</dt><dd>${escapeHtml(formatDateTime(myMember.joinedAt))}</dd>
      <dt>Expires</dt><dd>${s.officer ? "No expiry while holding an officer position" : escapeHtml(formatDateTime(s.expiresAt))}</dd>
    </dl>
    ${s.expired ? `<div class="notice notice-warn" style="margin-top:14px">Your membership has expired. Officers cannot record your attendance until you re-register.</div>` : ""}
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:16px">
      ${s.expired ? '<button class="btn" id="renew-btn">Re-register</button>' : ""}
      ${myRole === "president"
        ? '<span class="small muted">As President, pass the presidency before leaving (Members &amp; Officers tab).</span>'
        : '<button class="btn btn-danger" id="leave-btn">Leave organization</button>'}
    </div>`;

  const renew = $("#renew-btn");
  if (renew) renew.onclick = async () => {
    renew.disabled = true;
    try {
      await updateDoc(doc(db, "orgs", orgId, "members", me.uid), {
        joinedAt: serverTimestamp(), durationMinutes: org.membershipMinutes,
      });
      myMember = (await getDoc(doc(db, "orgs", orgId, "members", me.uid))).data();
      toast("Membership renewed!", "success");
      renderMembership();
    } catch (err) {
      console.error(err); toast("Could not re-register.", "error"); renew.disabled = false;
    }
  };
  const leave = $("#leave-btn");
  if (leave) leave.onclick = async () => {
    if (!confirm(`Leave ${org.name}? You can register again later.`)) return;
    try {
      await deleteDoc(doc(db, "orgs", orgId, "members", me.uid));
      toast("You left the organization.", "success");
      setTimeout(() => { window.location.href = "home.html"; }, 800);
    } catch (err) { console.error(err); toast("Could not leave the organization.", "error"); }
  };

  if (profile) downloadCard = renderQrCard($("#qr-container"), { uid: me.uid, ...profile });
}
$("#download-btn").addEventListener("click", () => downloadCard && downloadCard());

async function loadMyAttendance() {
  try {
    const snap = await getDocs(query(collection(db, "orgs", orgId, "attendance"), where("uid", "==", me.uid)));
    myAttendance = snap.docs.map((d) => d.data())
      .sort((a, b) => (b.eventDate || "").localeCompare(a.eventDate || ""));
    $("#my-attendance").innerHTML = myAttendance.length ? myAttendance.map((r) => `
      <tr><td>${escapeHtml(r.eventName)}</td><td>${escapeHtml(formatDate(r.eventDate))}</td><td>${escapeHtml(formatTime(r.timeIn))}</td></tr>`).join("")
      : '<tr><td colspan="3" class="empty">You have not attended any event yet.</td></tr>';
  } catch (err) {
    console.error(err);
    $("#my-attendance").innerHTML = '<tr><td colspan="3" class="empty">Could not load your attendance.</td></tr>';
  }
}

// ---------- Events ----------
async function loadEvents() {
  const list = $("#event-list");
  try {
    const snap = await getDocs(collection(db, "orgs", orgId, "events"));
    const events = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((b.date || "") + (b.startTime || "")).localeCompare((a.date || "") + (a.startTime || "")));
    const attendedIds = new Set(myAttendance.map((r) => r.eventId));
    const officer = isOfficerRole(myRole);

    if (!events.length) {
      list.innerHTML = `<div class="empty">No events yet.${officer ? " Create the first one above." : ""}</div>`;
      return;
    }
    list.innerHTML = events.map((ev) => {
      const st = eventStatus(ev);
      return `
      <div class="event-item">
        <div>
          <h3>${escapeHtml(ev.name)} ${eventStatusPill(ev)}</h3>
          <div class="event-meta">${escapeHtml(eventWhen(ev))}${ev.venue ? " &middot; " + escapeHtml(ev.venue) : ""}</div>
          ${attendedIds.has(ev.id) ? '<div class="attended small">&#10003; You attended</div>' : '<div class="not-attended small">Not attended</div>'}
          ${officer ? `<span class="count-pill" id="count-${ev.id}">... attendees</span>` : ""}
        </div>
        ${officer ? `
        <div class="event-actions">
          ${st.state === "ended"
            ? '<span class="btn btn-sm btn-outline" aria-disabled="true" style="opacity:.55;cursor:default">Scanning closed</span>'
            : `<a class="btn btn-sm" href="scanner.html?org=${orgId}&event=${ev.id}">Scan QR</a>`}
          <a class="btn btn-sm btn-outline" href="attendance.html?org=${orgId}&event=${ev.id}">Attendance</a>
          <button class="btn btn-sm btn-danger" data-del-event="${ev.id}" data-name="${escapeHtml(ev.name)}">Delete</button>
        </div>` : ""}
      </div>`;
    }).join("");

    if (officer) {
      events.forEach(async (ev) => {
        const q = query(collection(db, "orgs", orgId, "attendance"), where("eventId", "==", ev.id));
        const count = (await getCountFromServer(q)).data().count;
        const pill = document.getElementById(`count-${ev.id}`);
        if (pill) pill.textContent = `${count} attendee${count === 1 ? "" : "s"}`;
      });
      $$("[data-del-event]").forEach((b) => b.addEventListener("click", () => deleteEvent(b.dataset.delEvent, b.dataset.name)));
    }
  } catch (err) {
    console.error(err);
    list.innerHTML = '<div class="empty">Could not load events.</div>';
  }
}

$("#eventDate").value = new Date().toLocaleDateString("en-CA");
$("#event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#eventName").value.trim();
  const date = $("#eventDate").value;
  const startTime = $("#eventStart").value;
  const endTime = $("#eventEnd").value;
  const venue = $("#eventVenue").value.trim();
  if (!name) return toast("Enter the event name.", "error");
  if (!date) return toast("Choose the event date.", "error");
  if (!startTime || !endTime) return toast("Set the start and end time.", "error");
  const startAt = new Date(`${date}T${startTime}`);
  const endAt = new Date(`${date}T${endTime}`);
  if (endAt <= startAt) return toast("End time must be later than the start time.", "error");
  if (endAt <= new Date()) return toast("That end time has already passed.", "error");
  const btn = $("#create-event-btn");
  btn.disabled = true;
  try {
    await addDoc(collection(db, "orgs", orgId, "events"), {
      name, date, startTime, endTime, startAt, endAt, venue, createdBy: me.uid, createdAt: serverTimestamp(),
    });
    $("#eventName").value = ""; $("#eventVenue").value = "";
    toast("Event created.", "success");
    await loadEvents();
  } catch (err) {
    console.error(err); toast("Could not create event.", "error");
  } finally { btn.disabled = false; }
});

async function deleteEvent(eventId, name) {
  if (!confirm(`Delete "${name}" and all its attendance records?`)) return;
  try {
    const att = await getDocs(query(collection(db, "orgs", orgId, "attendance"), where("eventId", "==", eventId)));
    const batch = writeBatch(db);
    att.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "orgs", orgId, "events", eventId));
    await batch.commit();
    toast("Event deleted.", "success");
    await loadMyAttendance();
    await loadEvents();
  } catch (err) { console.error(err); toast("Could not delete event.", "error"); }
}

// ---------- Members & officers (officers only) ----------
const ROLE_ORDER = { president: 0, vice_president: 1, secretary: 2, treasurer: 3, member: 4 };

async function loadMembers() {
  try {
    const snap = await getDocs(collection(db, "orgs", orgId, "members"));
    members = snap.docs.map((d) => d.data())
      .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.fullName.localeCompare(b.fullName));
    renderMembers();
    renderTransfer();
  } catch (err) {
    console.error(err);
    $("#member-body").innerHTML = '<tr><td colspan="6" class="empty">Could not load members.</td></tr>';
  }
}

$("#member-search").addEventListener("input", renderMembers);

function renderMembers() {
  $("#member-count").textContent = members.length;
  $("#manage-note").textContent = canManageMembers(myRole)
    ? (myRole === "president"
      ? "As President you can promote, demote and remove anyone except yourself."
      : "As Vice President you can promote, demote and remove members, secretaries and treasurers.")
    : "Only the President and Vice President can promote, demote or remove members.";

  const term = $("#member-search").value.trim().toLowerCase();
  const shown = members.filter((m) => !term || `${m.fullName} ${m.studentNo} ${m.courseYear}`.toLowerCase().includes(term));
  if (!shown.length) {
    $("#member-body").innerHTML = '<tr><td colspan="6" class="empty">No members found.</td></tr>';
    return;
  }

  $("#member-body").innerHTML = shown.map((m) => {
    const s = membershipStatus(m);
    const status = s.officer ? '<span class="status status-officer">Officer</span>'
      : s.expired ? '<span class="status status-expired">Expired</span>'
      : `<span class="status status-active" title="Until ${escapeHtml(formatDateTime(s.expiresAt))}">Active</span>`;
    const isMe = m.uid === me.uid;
    const roles = isMe ? [] : assignableRoles(myRole, m.role);
    const removable = !isMe && canRemove(myRole, m.role);
    let actions = isMe ? '<span class="muted small">You</span>' : '<span class="muted small">-</span>';
    if (roles.length || removable) {
      actions = `<div class="inline-actions">
        ${roles.length ? `<select data-role-select="${escapeHtml(m.uid)}">
            ${roles.map((r) => `<option value="${r}" ${r === m.role ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}
          </select>
          <button class="btn btn-sm btn-outline" data-save-role="${escapeHtml(m.uid)}">Save role</button>` : ""}
        ${removable ? `<button class="btn btn-sm btn-danger" data-remove="${escapeHtml(m.uid)}">Remove</button>` : ""}
      </div>`;
    }
    return `<tr>
      <td>${escapeHtml(m.fullName)}</td><td>${escapeHtml(m.studentNo)}</td><td>${escapeHtml(m.courseYear)}</td>
      <td>${roleBadge(m.role)}</td><td>${status}</td><td>${actions}</td></tr>`;
  }).join("");

  $$("[data-save-role]").forEach((b) => b.addEventListener("click", () => changeRole(b.dataset.saveRole)));
  $$("[data-remove]").forEach((b) => b.addEventListener("click", () => removeMember(b.dataset.remove)));
}

async function changeRole(uid) {
  const m = members.find((x) => x.uid === uid);
  const newRole = document.querySelector(`[data-role-select="${CSS.escape(uid)}"]`).value;
  if (newRole === m.role) return toast("Choose a different role first.", "info");
  const verb = ROLE_ORDER[newRole] < ROLE_ORDER[m.role] ? "Promote" : "Demote";
  if (!confirm(`${verb} ${m.fullName} from ${ROLE_LABELS[m.role]} to ${ROLE_LABELS[newRole]}?`)) return;
  try {
    await updateDoc(doc(db, "orgs", orgId, "members", uid), { role: newRole });
    toast(`${m.fullName} is now ${ROLE_LABELS[newRole]}.`, "success");
    await loadMembers();
  } catch (err) { console.error(err); toast("You are not allowed to make this change.", "error"); }
}

async function removeMember(uid) {
  const m = members.find((x) => x.uid === uid);
  if (!confirm(`Remove ${m.fullName} from ${org.name}? Their past attendance records stay.`)) return;
  try {
    await deleteDoc(doc(db, "orgs", orgId, "members", uid));
    toast(`${m.fullName} was removed.`, "success");
    await loadMembers();
  } catch (err) { console.error(err); toast("You are not allowed to remove this member.", "error"); }
}

// ---------- Pass the presidency (President only) ----------
function renderTransfer() {
  const card = $("#transfer-card");
  if (myRole !== "president") { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const others = members.filter((m) => m.uid !== me.uid);
  $("#transfer-select").innerHTML = others.length
    ? others.map((m) => `<option value="${escapeHtml(m.uid)}">${escapeHtml(m.fullName)} (${escapeHtml(ROLE_LABELS[m.role])})</option>`).join("")
    : '<option value="">No other members yet</option>';
  $("#transfer-btn").disabled = !others.length;
}

$("#transfer-btn").addEventListener("click", async () => {
  const uid = $("#transfer-select").value;
  const m = members.find((x) => x.uid === uid);
  if (!m) return;
  if (!confirm(`Pass the presidency of ${org.name} to ${m.fullName}?\n\nYou will become a regular member and lose your President powers. This cannot be undone by you.`)) return;
  try {
    // All three changes happen together, or none of them do.
    const batch = writeBatch(db);
    batch.update(doc(db, "orgs", orgId), { presidentUid: uid });
    batch.update(doc(db, "orgs", orgId, "members", uid), { role: "president" });
    batch.update(doc(db, "orgs", orgId, "members", me.uid), { role: "member" });
    await batch.commit();
    toast(`${m.fullName} is now the President.`, "success");
    setTimeout(() => window.location.reload(), 1200);
  } catch (err) { console.error(err); toast("Could not pass the presidency.", "error"); }
});

// ---------- Members CSV ----------
$("#members-csv-btn").addEventListener("click", () => {
  if (!members.length) return toast("No members yet.", "error");
  downloadCSV([
    ["Name", "Student No.", "Course & Year", "Role", "Membership", "Registered/Renewed"],
    ...members.map((m) => {
      const s = membershipStatus(m);
      return [m.fullName, m.studentNo, m.courseYear, ROLE_LABELS[m.role],
        s.officer ? "Officer" : s.expired ? "Expired" : `Active until ${formatDateTime(s.expiresAt)}`,
        formatDateTime(m.joinedAt)];
    }),
  ], `Members-${org.name.replace(/[^a-z0-9]+/gi, "-")}.csv`);
});

// ---------- Org settings (President / VP) ----------
function fillSettings() {
  $("#set-name").value = org.name;
  $("#set-desc").value = org.description || "";
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#set-name").value.trim().replace(/\s+/g, " ");
  const description = $("#set-desc").value.trim();
  if (name.length < 3) return toast("Name must be at least 3 characters.", "error");
  const btn = $("#save-settings-btn");
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "orgs", orgId), { name, description });
    org = { ...org, name, description };
    $("#org-name").textContent = name;
    $("#org-desc").textContent = description;
    toast("Settings saved.", "success");
  } catch (err) { console.error(err); toast("Could not save settings.", "error"); }
  finally { btn.disabled = false; }
});

// Re-check expiry every 30 s while the page is open
setInterval(() => {
  if (myMember && !isOfficerRole(myRole)) {
    const box = $("#membership-box");
    const wasExpired = box && box.innerHTML.includes("status-expired");
    if (membershipStatus(myMember).expired && !wasExpired) renderMembership();
  }
}, 30000);
