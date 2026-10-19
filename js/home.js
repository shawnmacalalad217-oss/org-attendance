// Home: my orgs, join other orgs, request a new org, personal QR code.
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, $, requireLogin, toast, escapeHtml, roleBadge, membershipStatus, formatDateTime,
  renderQrCard, isOfficerRole,
} from "./common.js";

let me = null;        // Firebase user
let profile = null;   // users/{uid}
let orgs = [];        // [{ id, ...org, membership }]
let downloadCard = null;

requireLogin(async (user, prof, isAdmin) => {
  me = user;
  profile = prof;
  if (!profile) {
    if (isAdmin) { window.location.href = "admin.html"; return; }
    $("#welcome-name").textContent = "Profile missing";
    $("#my-orgs").innerHTML = '<div class="empty">Your login works, but your student profile was not saved (usually because the database rules were not re-published). Ask the admin to publish the latest firestore.rules, then create a new account.</div>';
    return;
  }
  $("#welcome-name").textContent = profile.fullName;
  $("#welcome-meta").textContent = `${profile.studentNo} · ${profile.courseYear}`;
  await loadOrgs();
  await loadRequestArea();
});

// ---------- Organizations ----------
async function loadOrgs() {
  try {
    const snap = await getDocs(collection(db, "orgs"));
    orgs = await Promise.all(snap.docs.map(async (d) => {
      const m = await getDoc(doc(db, "orgs", d.id, "members", me.uid));
      return { id: d.id, ...d.data(), membership: m.exists() ? m.data() : null };
    }));
    orgs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderOrgs();
  } catch (err) {
    console.error(err);
    $("#my-orgs").innerHTML = '<div class="empty">Could not load organizations.</div>';
  }
}

function statusPill(m) {
  const s = membershipStatus(m);
  if (s.officer) return '<span class="status status-officer">Officer</span>';
  if (s.expired) return '<span class="status status-expired">Expired</span>';
  return `<span class="status status-active">Active until ${escapeHtml(formatDateTime(s.expiresAt))}</span>`;
}

function renderOrgs() {
  const mine = orgs.filter((o) => o.membership);
  const others = orgs.filter((o) => !o.membership);

  $("#my-orgs").innerHTML = mine.length ? mine.map((o) => {
    const s = membershipStatus(o.membership);
    return `
      <div class="org-card">
        <h3>${escapeHtml(o.name)}</h3>
        <div class="badges">${roleBadge(o.membership.role)} ${statusPill(o.membership)}</div>
        ${s.expired ? '<p>Your membership expired. Re-register to join again.</p>' : ""}
        <div class="actions">
          <a class="btn btn-sm" href="org.html?org=${o.id}">${isOfficerRole(o.membership.role) ? "Open (officer)" : "Open"}</a>
          ${s.expired ? `<button class="btn btn-sm btn-outline" data-renew="${o.id}">Re-register</button>` : ""}
        </div>
      </div>`;
  }).join("") : '<div class="empty">You have not joined any organization yet.</div>';

  $("#other-orgs").innerHTML = others.length ? others.map((o) => `
      <div class="org-card">
        <h3>${escapeHtml(o.name)}</h3>
        <p>${escapeHtml(o.description || "No description.")}</p>
        <p class="small">Membership: 1 year, renewable</p>
        <div class="actions"><button class="btn btn-sm" data-join="${o.id}">Register as member</button></div>
      </div>`).join("")
    : `<div class="empty">${orgs.length ? "You are a member of every organization." : "No organizations yet."}</div>`;

  document.querySelectorAll("[data-join]").forEach((b) => b.addEventListener("click", () => joinOrg(b.dataset.join, b)));
  document.querySelectorAll("[data-renew]").forEach((b) => b.addEventListener("click", () => renewOrg(b.dataset.renew, b)));
}

async function joinOrg(orgId, btn) {
  const org = orgs.find((o) => o.id === orgId);
  if (!confirm(`Register as a member of ${org.name}?`)) return;
  btn.disabled = true;
  try {
    await setDoc(doc(db, "orgs", orgId, "members", me.uid), {
      uid: me.uid,
      fullName: profile.fullName,
      studentNo: profile.studentNo,
      courseYear: profile.courseYear,
      role: "member",
      joinedAt: serverTimestamp(),
      durationMinutes: org.membershipMinutes,
    });
    toast(`You are now a member of ${org.name}!`, "success");
    await loadOrgs();
  } catch (err) {
    console.error(err);
    toast("Could not register. Please try again.", "error");
    btn.disabled = false;
  }
}

async function renewOrg(orgId, btn) {
  const org = orgs.find((o) => o.id === orgId);
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "orgs", orgId, "members", me.uid), {
      joinedAt: serverTimestamp(),
      durationMinutes: org.membershipMinutes,
    });
    toast(`Membership in ${org.name} renewed!`, "success");
    await loadOrgs();
  } catch (err) {
    console.error(err);
    toast("Could not re-register. Please try again.", "error");
    btn.disabled = false;
  }
}

// ---------- Request a new organization ----------
async function loadRequestArea() {
  const area = $("#request-area");
  try {
    const [limitSnap, reqSnap] = await Promise.all([
      getDoc(doc(db, "config", "limits")),
      getDoc(doc(db, "orgRequests", me.uid)),
    ]);
    const limits = limitSnap.exists() ? limitSnap.data() : null;
    const req = reqSnap.exists() ? reqSnap.data() : null;

    if (limits) {
      const used = Math.min(limits.orgCount, limits.maxOrgs);
      $("#slot-info").innerHTML = `
        <div><strong>${used} of ${limits.maxOrgs}</strong> organization slots used.</div>
        <div class="slot-meter"><span style="width:${(used / limits.maxOrgs) * 100}%"></span></div>`;
    }

    if (req && req.status === "pending") {
      area.innerHTML = `<div class="notice">Your request to create <strong>${escapeHtml(req.orgName)}</strong> is waiting for admin approval.</div>
        <button class="btn btn-sm btn-outline" id="cancel-req" style="margin-top:10px">Cancel request</button>`;
      $("#cancel-req").onclick = async () => {
        if (!confirm("Cancel your request?")) return;
        await deleteDoc(doc(db, "orgRequests", me.uid));
        toast("Request cancelled.", "success");
        loadRequestArea();
      };
      return;
    }
    if (req && req.status === "approved") {
      area.innerHTML = `<div class="notice">Your request was approved. You are the President of <strong>${escapeHtml(req.orgName)}</strong>.
        ${req.orgId ? `<a href="org.html?org=${req.orgId}">Open org</a>` : ""}</div>
        <p class="small muted" style="margin-top:8px">Each account can create one organization.</p>`;
      return;
    }
    if (req && req.status === "rejected") {
      area.innerHTML = `<div class="notice notice-warn">Your request for <strong>${escapeHtml(req.orgName)}</strong> was not approved.</div>
        <button class="btn btn-sm btn-outline" id="retry-req" style="margin-top:10px">Make a new request</button>`;
      $("#retry-req").onclick = async () => { await deleteDoc(doc(db, "orgRequests", me.uid)); loadRequestArea(); };
      return;
    }
    if (!limits) {
      area.innerHTML = '<div class="empty">Organization requests open once the admin sets up the website.</div>';
      return;
    }
    if (limits.orgCount >= limits.maxOrgs) {
      area.innerHTML = '<div class="notice notice-warn">All organization slots are taken. New organizations cannot be created right now.</div>';
      return;
    }
    area.innerHTML = `
      <p class="muted small">Send a request to the admin. Once approved, you become the org's President.</p>
      <form id="request-form" novalidate>
        <div class="field"><label for="req-name">Organization name</label><input id="req-name" maxlength="60" placeholder="e.g. Computer Engineering Society"></div>
        <div class="field"><label for="req-desc">Short description</label><textarea id="req-desc" rows="2" maxlength="300" placeholder="What is your organization about?"></textarea></div>
        <button class="btn" type="submit" id="req-btn">Send request</button>
      </form>`;
    $("#request-form").addEventListener("submit", sendRequest);
  } catch (err) {
    console.error(err);
    area.innerHTML = '<div class="empty">Could not load request status.</div>';
  }
}

async function sendRequest(e) {
  e.preventDefault();
  const orgName = $("#req-name").value.trim().replace(/\s+/g, " ");
  const description = $("#req-desc").value.trim();
  if (orgName.length < 3) return toast("Organization name must be at least 3 characters.", "error");
  const btn = $("#req-btn");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "orgRequests", me.uid), {
      requesterUid: me.uid,
      requesterName: profile.fullName,
      requesterStudentNo: profile.studentNo,
      requesterCourseYear: profile.courseYear,
      requesterEmail: me.email,
      orgName,
      description,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    toast("Request sent to the admin!", "success");
    loadRequestArea();
  } catch (err) {
    console.error(err);
    toast("Could not send request. The organization limit may have been reached.", "error");
    btn.disabled = false;
  }
}

// ---------- My QR code ----------
$("#show-qr-btn").addEventListener("click", () => {
  if (!profile) return;
  downloadCard = renderQrCard($("#qr-container"), { uid: me.uid, ...profile });
  $("#qr-modal").classList.remove("hidden");
});
$("#download-btn").addEventListener("click", () => downloadCard && downloadCard());
$("#close-modal").addEventListener("click", () => $("#qr-modal").classList.add("hidden"));
$("#qr-modal").addEventListener("click", (e) => { if (e.target.id === "qr-modal") $("#qr-modal").classList.add("hidden"); });
