// Admin dashboard: approve or reject org requests, set the org limit,
// delete organizations.
import {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, $, requireLogin, toast, escapeHtml, formatDateTime, DEFAULT_DURATION,
} from "./common.js";

let limits = null;

requireLogin(async (user, profile, isAdmin) => {
  if (!isAdmin) {
    toast("This page is for the site admin only.", "error");
    setTimeout(() => { window.location.href = "home.html"; }, 1200);
    return;
  }
  await refreshAll();
});

async function refreshAll() {
  await loadLimits();
  await Promise.all([loadRequests(), loadOrgs()]);
}

// ---------- Org limit ----------
async function loadLimits() {
  const ref = doc(db, "config", "limits");
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    // First time: create the settings document.
    const orgCount = (await getDocs(collection(db, "orgs"))).size;
    await setDoc(ref, { maxOrgs: 5, orgCount });
    snap = await getDoc(ref);
  }
  limits = snap.data();
  const pct = Math.min(100, (limits.orgCount / limits.maxOrgs) * 100);
  $("#limit-info").innerHTML = `
    <div><strong>${limits.orgCount} of ${limits.maxOrgs}</strong> organization slots used</div>
    <div class="slot-meter" style="max-width:420px"><span style="width:${pct}%"></span></div>`;
  $("#max-orgs").value = limits.maxOrgs;
}

$("#limit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const maxOrgs = parseInt($("#max-orgs").value, 10);
  if (!(maxOrgs >= 1 && maxOrgs <= 20)) return toast("Choose a limit from 1 to 20.", "error");
  try {
    await updateDoc(doc(db, "config", "limits"), { maxOrgs });
    toast("Limit saved.", "success");
    await loadLimits();
  } catch (err) { console.error(err); toast("Could not save the limit.", "error"); }
});

// ---------- Requests ----------
async function loadRequests() {
  try {
    const snap = await getDocs(collection(db, "orgRequests"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const pending = all.filter((r) => r.status === "pending");
    const history = all.filter((r) => r.status !== "pending")
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    const full = limits.orgCount >= limits.maxOrgs;

    $("#pending-list").innerHTML = pending.length ? pending.map((r) => `
      <div class="event-item">
        <div>
          <h3>${escapeHtml(r.orgName)}</h3>
          <div class="event-meta">${escapeHtml(r.description || "No description")}</div>
          <div class="small" style="margin-top:6px">Requested by <strong>${escapeHtml(r.requesterName)}</strong>
            (${escapeHtml(r.requesterStudentNo)}, ${escapeHtml(r.requesterCourseYear)}) &middot; ${escapeHtml(r.requesterEmail || "")}</div>
          <div class="small muted">${escapeHtml(formatDateTime(r.createdAt))}</div>
        </div>
        <div class="event-actions">
          <button class="btn btn-sm" data-approve="${escapeHtml(r.id)}" ${full ? "disabled title='Organization limit reached'" : ""}>Approve</button>
          <button class="btn btn-sm btn-danger" data-reject="${escapeHtml(r.id)}">Reject</button>
        </div>
      </div>`).join("") + (full ? '<div class="notice notice-warn">The organization limit is reached. Raise the limit or delete an org to approve more.</div>' : "")
      : '<div class="empty">No pending requests.</div>';

    $("#history-body").innerHTML = history.length ? history.map((r) => `
      <tr><td>${escapeHtml(r.orgName)}</td><td>${escapeHtml(r.requesterName)}</td>
        <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
        <td><span class="status ${r.status === "approved" ? "status-active" : "status-expired"}">${escapeHtml(r.status)}</span></td></tr>`).join("")
      : '<tr><td colspan="4" class="empty">No decided requests yet.</td></tr>';

    document.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approve(pending.find((r) => r.id === b.dataset.approve), b)));
    document.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => reject(pending.find((r) => r.id === b.dataset.reject))));
  } catch (err) {
    console.error(err);
    $("#pending-list").innerHTML = '<div class="empty">Could not load requests.</div>';
  }
}

async function approve(req, btn) {
  if (!confirm(`Approve "${req.orgName}"? ${req.requesterName} will become its President.`)) return;
  btn.disabled = true;
  try {
    const fresh = (await getDoc(doc(db, "config", "limits"))).data();
    if (fresh.orgCount >= fresh.maxOrgs) { toast("Organization limit reached.", "error"); await refreshAll(); return; }
    const orgRef = doc(collection(db, "orgs"));   // new ID
    const batch = writeBatch(db);
    batch.set(orgRef, {
      name: req.orgName,
      description: req.description || "",
      presidentUid: req.requesterUid,
      membershipMinutes: DEFAULT_DURATION,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, "orgs", orgRef.id, "members", req.requesterUid), {
      uid: req.requesterUid,
      fullName: req.requesterName,
      studentNo: req.requesterStudentNo,
      courseYear: req.requesterCourseYear,
      role: "president",
      joinedAt: serverTimestamp(),
      durationMinutes: DEFAULT_DURATION,
    });
    batch.update(doc(db, "orgRequests", req.id), { status: "approved", orgId: orgRef.id, decidedAt: serverTimestamp() });
    batch.update(doc(db, "config", "limits"), { orgCount: fresh.orgCount + 1 });
    await batch.commit();
    toast(`${req.orgName} was created.`, "success");
    await refreshAll();
  } catch (err) {
    console.error(err);
    toast("Could not approve the request.", "error");
    btn.disabled = false;
  }
}

async function reject(req) {
  if (!confirm(`Reject the request for "${req.orgName}"?`)) return;
  try {
    await updateDoc(doc(db, "orgRequests", req.id), { status: "rejected", decidedAt: serverTimestamp() });
    toast("Request rejected.", "success");
    await loadRequests();
  } catch (err) { console.error(err); toast("Could not reject the request.", "error"); }
}

// ---------- Organizations ----------
async function loadOrgs() {
  try {
    const snap = await getDocs(collection(db, "orgs"));
    const orgs = await Promise.all(snap.docs.map(async (d) => {
      const o = { id: d.id, ...d.data() };
      const p = o.presidentUid ? await getDoc(doc(db, "orgs", d.id, "members", o.presidentUid)) : null;
      o.presidentName = p && p.exists() ? p.data().fullName : "-";
      return o;
    }));
    orgs.sort((a, b) => a.name.localeCompare(b.name));
    $("#org-body").innerHTML = orgs.length ? orgs.map((o) => `
      <tr><td>${escapeHtml(o.name)}</td><td>${escapeHtml(o.presidentName)}</td>
        <td>${escapeHtml(formatDateTime(o.createdAt))}</td>
        <td><button class="btn btn-sm btn-danger" data-del-org="${o.id}" data-name="${escapeHtml(o.name)}">Delete</button></td></tr>`).join("")
      : '<tr><td colspan="4" class="empty">No organizations yet.</td></tr>';
    document.querySelectorAll("[data-del-org]").forEach((b) => b.addEventListener("click", () => deleteOrg(b.dataset.delOrg, b.dataset.name)));
  } catch (err) {
    console.error(err);
    $("#org-body").innerHTML = '<tr><td colspan="4" class="empty">Could not load organizations.</td></tr>';
  }
}

async function deleteOrg(orgId, name) {
  if (!confirm(`Delete "${name}" with ALL its members, events and attendance? This cannot be undone.`)) return;
  try {
    const refs = [];
    for (const sub of ["members", "events", "attendance"]) {
      (await getDocs(collection(db, "orgs", orgId, sub))).docs.forEach((d) => refs.push(d.ref));
    }
    // Free the requester so they can request again
    (await getDocs(query(collection(db, "orgRequests"), where("orgId", "==", orgId)))).docs.forEach((d) => refs.push(d.ref));
    // Firestore batches hold up to 500 writes
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(db);
      refs.slice(i, i + 450).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    const fresh = (await getDoc(doc(db, "config", "limits"))).data();
    const batch = writeBatch(db);
    batch.delete(doc(db, "orgs", orgId));
    batch.update(doc(db, "config", "limits"), { orgCount: Math.max(0, fresh.orgCount - 1) });
    await batch.commit();
    toast(`${name} was deleted.`, "success");
    await refreshAll();
  } catch (err) {
    console.error(err);
    toast("Could not delete the organization.", "error");
  }
}
