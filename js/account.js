// My account: edit details, reset password, download my data, delete account.
import {
  sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, deleteUser,
  GoogleAuthProvider, reauthenticateWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, query, where, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth, db, $, requireLogin, toast, cleanStudentNo, isValidStudentNo, toMillis,
} from "./common.js";

let me = null;
let profile = null;

const hasPassword = (user) => (user.providerData || []).some((p) => p.providerId === "password");

requireLogin(async (user, prof, isAdmin) => {
  me = user;
  profile = prof;
  $("#email").value = user.email || "";
  if (!hasPassword(user)) {
    // Signed up with Google: no password to type when deleting.
    $("#delete-password").closest(".field").classList.add("hidden");
    $("#delete-btn").textContent = "Confirm with Google and delete";
    $("#reset-btn").textContent = "Email me a link to create a password";
    $("#password-note").textContent = "You sign in with Google. You can also create a password so you can log in with your email.";
  }
  if (!profile) {
    $("#details-form").innerHTML = `<div class="empty">${isAdmin
      ? "This is the admin account. It has no student profile to edit."
      : "Your account has no student profile. Please create a new account on the sign-up page."}</div>`;
    $("#export-btn").disabled = true;
    return;
  }
  $("#fullName").value = profile.fullName || "";
  $("#studentNo").value = profile.studentNo || "";
  $("#courseYear").value = profile.courseYear || "";
});

// Every org the user belongs to: [{ orgId, orgName, member }]
async function myMemberships() {
  const orgs = await getDocs(collection(db, "orgs"));
  const list = await Promise.all(orgs.docs.map(async (o) => {
    const m = await getDoc(doc(db, "orgs", o.id, "members", me.uid));
    return m.exists() ? { orgId: o.id, orgName: o.data().name, member: m.data() } : null;
  }));
  return list.filter(Boolean);
}

// ---------- Edit details ----------
$("#details-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!profile) return;
  const fullName = $("#fullName").value.trim().replace(/\s+/g, " ");
  const studentNo = cleanStudentNo($("#studentNo").value);
  const courseYear = $("#courseYear").value.trim().replace(/\s+/g, " ");
  if (fullName.length < 2) return toast("Please enter your full name.", "error");
  if (!isValidStudentNo(studentNo)) return toast("Student number: 4–20 letters, numbers or dashes.", "error");
  if (!courseYear) return toast("Please enter your course & year.", "error");
  if (fullName === profile.fullName && studentNo === profile.studentNo && courseYear === profile.courseYear) {
    return toast("Nothing changed.", "info");
  }

  const btn = $("#save-btn");
  btn.disabled = true;
  try {
    const memberships = await myMemberships();
    const batch = writeBatch(db);
    batch.update(doc(db, "users", me.uid), { fullName, studentNo, courseYear });
    memberships.forEach(({ orgId }) => {
      batch.update(doc(db, "orgs", orgId, "members", me.uid), { fullName, studentNo, courseYear });
    });
    await batch.commit();
    profile = { ...profile, fullName, studentNo, courseYear };
    const who = $("#user-name");
    if (who) who.textContent = fullName;
    toast(memberships.length
      ? `Details saved and updated in ${memberships.length} organization(s).`
      : "Details saved.", "success");
  } catch (err) {
    console.error(err);
    toast("Could not save your details. Please try again.", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Password reset ----------
$("#reset-btn").addEventListener("click", async () => {
  const btn = $("#reset-btn");
  btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, me.email);
    toast(`Password reset link sent to ${me.email}. Check your inbox (and spam folder).`, "success");
  } catch (err) {
    console.error(err);
    toast("Could not send the reset email. Please try again later.", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Download my data ----------
$("#export-btn").addEventListener("click", async () => {
  const btn = $("#export-btn");
  btn.disabled = true;
  try {
    const memberships = await myMemberships();
    const iso = (ts) => { const ms = toMillis(ts); return ms == null ? null : new Date(ms).toISOString(); };
    const orgsOut = await Promise.all(memberships.map(async ({ orgId, orgName, member }) => {
      const att = await getDocs(query(collection(db, "orgs", orgId, "attendance"), where("uid", "==", me.uid)));
      return {
        organization: orgName,
        role: member.role,
        joinedAt: iso(member.joinedAt),
        durationMinutes: member.durationMinutes,
        attendance: att.docs.map((d) => {
          const r = d.data();
          return { event: r.eventName, eventDate: r.eventDate, timeIn: iso(r.timeIn) };
        }),
      };
    }));
    const reqSnap = await getDoc(doc(db, "orgRequests", me.uid));
    const req = reqSnap.exists() ? reqSnap.data() : null;
    const data = {
      exportedAt: new Date().toISOString(),
      account: { uid: me.uid, email: me.email },
      profile: {
        fullName: profile.fullName,
        studentNo: profile.studentNo,
        courseYear: profile.courseYear,
        createdAt: iso(profile.createdAt),
        privacyAcceptedAt: iso(profile.privacyAcceptedAt),
      },
      organizationRequest: req ? { orgName: req.orgName, description: req.description, status: req.status, createdAt: iso(req.createdAt) } : null,
      memberships: orgsOut,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `my-data-${profile.studentNo}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error(err);
    toast("Could not prepare your data. Please try again.", "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Delete account ----------
$("#delete-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("#delete-password").value;
  const usePassword = hasPassword(me);
  if (usePassword && !password) return toast("Enter your password to confirm.", "error");
  const btn = $("#delete-btn");
  btn.disabled = true;
  try {
    // 1. Confirm it is really the owner (Firebase also requires a recent login).
    try {
      if (usePassword) await reauthenticateWithCredential(me, EmailAuthProvider.credential(me.email, password));
      else await reauthenticateWithPopup(me, new GoogleAuthProvider());
    } catch (err) {
      console.error(err);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      toast(usePassword ? "Wrong password." : "Could not confirm with Google. Use the same Google account and try again.", "error");
      return;
    }

    // 2. A President must hand over the org first so it is never left without a leader.
    const memberships = await myMemberships();
    const led = memberships.filter((m) => m.member.role === "president");
    if (led.length) {
      toast(`You are the President of ${led.map((m) => m.orgName).join(", ")}. Transfer the presidency first.`, "error");
      return;
    }
    if (!confirm("Permanently delete your account and all your memberships? This cannot be undone.")) return;

    // 3. Delete Firestore data: memberships, profile, unapproved org request.
    const batch = writeBatch(db);
    memberships.forEach(({ orgId }) => batch.delete(doc(db, "orgs", orgId, "members", me.uid)));
    const reqSnap = await getDoc(doc(db, "orgRequests", me.uid));
    if (reqSnap.exists() && reqSnap.data().status !== "approved") batch.delete(doc(db, "orgRequests", me.uid));
    batch.delete(doc(db, "users", me.uid));
    await batch.commit();

    // 4. Delete the login itself.
    await deleteUser(me);
    alert("Your account has been deleted.");
    window.location.href = "index.html";
  } catch (err) {
    console.error(err);
    toast("Could not delete your account. Please try again.", "error");
  } finally {
    btn.disabled = false;
  }
});
