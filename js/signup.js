// Create a user account (Firebase Auth) and save the student profile.
import { createUserWithEmailAndPassword, deleteUser } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, $, checkConfig, toast, cleanStudentNo, isValidStudentNo } from "./common.js";

const ready = checkConfig();

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
  if (!email) return toast("Please enter your email.", "error");
  if (password.length < 6) return toast("Password must be at least 6 characters.", "error");
  if (!$("#consent").checked) return toast("Please read and agree to the Privacy Policy.", "error");

  const btn = $("#signup-btn");
  btn.disabled = true; btn.textContent = "Creating account...";
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await setDoc(doc(db, "users", cred.user.uid), {
        fullName, studentNo, courseYear, email, createdAt: serverTimestamp(), privacyAcceptedAt: serverTimestamp(),
      });
    } catch (dbErr) {
      // Login was created but the profile could not be saved: undo the login so the
      // email can be used again, and say why.
      console.error(dbErr);
      await deleteUser(cred.user).catch(() => {});
      toast(dbErr.code === "permission-denied"
        ? "The database refused to save your profile. The admin must publish the latest firestore.rules in Firebase."
        : `Could not save your profile (${dbErr.code || dbErr.message}).`, "error");
      btn.disabled = false; btn.textContent = "Create account";
      return;
    }
    toast("Account created!", "success");
    window.location.href = "home.html";
  } catch (err) {
    console.error(err);
    const msg = {
      "auth/email-already-in-use": "This email already has an account. Please log in.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/operation-not-allowed": "Email/Password sign-in is turned off in Firebase Authentication.",
      "auth/network-request-failed": "No internet connection, or Firebase could not be reached.",
    }[err.code] || `Could not create account (${err.code || err.message}).`;
    toast(msg, "error");
    btn.disabled = false; btn.textContent = "Create account";
  }
});
