// Create an account (email + password, or Google) and save the student profile.
import {
  createUserWithEmailAndPassword, deleteUser, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth, db, $, checkConfig, toast, cleanStudentNo, isValidStudentNo, getParam,
  signInWithGoogle, googleErrorMessage,
} from "./common.js";

const ready = checkConfig();
const nextParam = getParam("next");
const nextPage = nextParam && /^[a-z]+\.html/.test(nextParam) ? nextParam : "home.html";
let completeUser = null;   // signed in (Google) but student details not saved yet
let creating = false;      // email sign-up in progress

// "Finish your account": hide email/password, keep the student details + consent.
function enterCompleteMode(user) {
  completeUser = user;
  $("#signup-title").textContent = "Finish setting up your account";
  $("#signup-sub").textContent = "You're signed in with Google. Add your student details to continue.";
  $("#google-area").classList.add("hidden");
  $("#password-field").classList.add("hidden");
  $("#email").value = user.email || "";
  $("#email").disabled = true;
  if (!$("#fullName").value && user.displayName) $("#fullName").value = user.displayName;
  $("#signup-btn").textContent = "Save and continue";
  $("#login-hint").classList.add("hidden");
  $("#switch-hint").classList.remove("hidden");
}

if (ready) {
  onAuthStateChanged(auth, async (user) => {
    if (!user || completeUser || creating) return;
    const profile = await getDoc(doc(db, "users", user.uid));
    if (!profile.exists()) enterCompleteMode(user);
    else if (getParam("complete")) window.location.href = nextPage;
  });
}

$("#switch-account").addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = "login.html";
});

// ---------- Continue with Google ----------
$("#google-btn").addEventListener("click", async () => {
  if (!ready) return toast("Firebase is not set up yet.", "error");
  const btn = $("#google-btn");
  btn.disabled = true;
  try {
    const user = await signInWithGoogle();
    const profile = await getDoc(doc(db, "users", user.uid));
    if (profile.exists()) { toast("You already have an account. Logging you in...", "success"); window.location.href = nextPage; return; }
    enterCompleteMode(user);
  } catch (err) {
    console.error(err);
    const msg = googleErrorMessage(err);
    if (msg) toast(msg, "error");
  } finally {
    btn.disabled = false;
  }
});

// ---------- Save ----------
async function saveProfile(user, data) {
  await setDoc(doc(db, "users", user.uid), {
    ...data, email: user.email, createdAt: serverTimestamp(), privacyAcceptedAt: serverTimestamp(),
  });
}

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ready) return toast("Firebase is not set up yet.", "error");
  const fullName = $("#fullName").value.trim().replace(/\s+/g, " ");
  const studentNo = cleanStudentNo($("#studentNo").value);
  const courseYear = $("#courseYear").value.trim().replace(/\s+/g, " ");
  const email = $("#email").value.trim();
  const password = $("#password").value;

  if (fullName.length < 2) return toast("Please enter your full name.", "error");
  if (!isValidStudentNo(studentNo)) return toast("Student number: 4-20 letters, numbers or dashes only.", "error");
  if (!courseYear) return toast("Please enter your course and year.", "error");
  if (!completeUser) {
    if (!email) return toast("Please enter your email.", "error");
    if (password.length < 6) return toast("Password must be at least 6 characters.", "error");
  }
  if (!$("#consent").checked) return toast("Please read and agree to the Privacy Policy.", "error");

  const btn = $("#signup-btn");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving...";

  // Google user finishing their profile
  if (completeUser) {
    try {
      await saveProfile(completeUser, { fullName, studentNo, courseYear });
      toast("Account ready!", "success");
      window.location.href = nextPage;
    } catch (err) {
      console.error(err);
      toast(err.code === "permission-denied"
        ? "The database refused to save your profile. The admin must publish the latest firestore.rules in Firebase."
        : `Could not save your profile (${err.code || err.message}).`, "error");
      btn.disabled = false; btn.textContent = label;
    }
    return;
  }

  // New email + password account
  creating = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await saveProfile(cred.user, { fullName, studentNo, courseYear });
    } catch (dbErr) {
      // Login was created but the profile could not be saved: undo the login so the
      // email can be used again, and say why.
      console.error(dbErr);
      creating = false;
      await deleteUser(cred.user).catch(() => {});
      toast(dbErr.code === "permission-denied"
        ? "The database refused to save your profile. The admin must publish the latest firestore.rules in Firebase."
        : `Could not save your profile (${dbErr.code || dbErr.message}).`, "error");
      btn.disabled = false; btn.textContent = label;
      return;
    }
    toast("Account created!", "success");
    window.location.href = nextPage;
  } catch (err) {
    console.error(err);
    const msg = {
      "auth/email-already-in-use": "This email already has an account. Please log in (or use Continue with Google if you signed up with Google).",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/operation-not-allowed": "Email/Password sign-in is turned off in Firebase Authentication.",
      "auth/network-request-failed": "No internet connection, or Firebase could not be reached.",
    }[err.code] || `Could not create account (${err.code || err.message}).`;
    toast(msg, "error");
    creating = false;
    btn.disabled = false; btn.textContent = label;
  }
});
