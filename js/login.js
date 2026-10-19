// One login for members, officers and the admin. Roles are checked per org.
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, $, checkConfig, toast, getParam } from "./common.js";

const ready = checkConfig();
const as = getParam("as");
const titles = {
  member: ["Member login", "Log in to join orgs, renew your membership and see your attended events."],
  officer: ["Officer login", "Log in to manage your org. Your officer tools appear inside each org you lead."],
  admin: ["Admin login", "For the site administrator who approves new organizations."],
};
if (titles[as]) {
  $("#login-title").textContent = titles[as][0];
  $("#login-sub").textContent = titles[as][1];
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ready) return toast("Firebase is not set up yet.", "error");
  const email = $("#email").value.trim();
  const password = $("#password").value;
  if (!email || !password) return toast("Enter your email and password.", "error");

  const btn = $("#login-btn");
  btn.disabled = true; btn.textContent = "Logging in...";
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (as === "admin") {
      const adminSnap = await getDoc(doc(db, "admins", cred.user.uid)).catch(() => null);
      if (adminSnap && adminSnap.exists()) { window.location.href = "admin.html"; return; }
      toast("This account is not an admin. Opening your organizations instead.", "error");
      setTimeout(() => { window.location.href = "home.html"; }, 1500);
      return;
    }
    const next = getParam("next");
    window.location.href = next && /^[a-z]+\.html/.test(next) ? next : "home.html";
  } catch (err) {
    console.error(err);
    const messages = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/user-not-found": "No account with this email.",
      "auth/invalid-email": "That email address is not valid.",
      "auth/user-disabled": "This account has been disabled in Firebase.",
      "auth/too-many-requests": "Too many failed tries. Wait a few minutes or reset your password.",
      "auth/network-request-failed": "No internet connection, or Firebase could not be reached.",
      "auth/operation-not-allowed": "Email/Password sign-in is turned off in Firebase Authentication.",
      "auth/invalid-api-key": "The Firebase config in js/firebase-config.js is wrong.",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "The Firebase config in js/firebase-config.js is wrong.",
    };
    toast(messages[err.code] || `Could not log in (${err.code || err.message}).`, "error");
    btn.disabled = false; btn.textContent = "Log in";
  }
});
