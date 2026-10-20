// One login for members, officers and the admin. Roles are checked per org.
import {
  signInWithEmailAndPassword, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  auth, $, checkConfig, toast, getParam, signInWithGoogle, googleErrorMessage, goAfterLogin,
} from "./common.js";

const ready = checkConfig();
const as = getParam("as");
const next = getParam("next");
const titles = {
  member: ["Member login", "Log in to join orgs, renew your membership and see your attended events."],
  officer: ["Officer login", "Log in to manage your org. Your officer tools appear inside each org you lead."],
  admin: ["Admin login", "For the site administrator who approves new organizations."],
};
if (titles[as]) {
  $("#login-title").textContent = titles[as][0];
  $("#login-sub").textContent = titles[as][1];
}

// ---------- Email + password ----------
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
    await goAfterLogin(cred.user, { as, next });
  } catch (err) {
    console.error(err);
    const messages = {
      "auth/invalid-credential": "Wrong email or password. If you signed up with Google, use Continue with Google.",
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

// ---------- Continue with Google ----------
$("#google-btn").addEventListener("click", async () => {
  if (!ready) return toast("Firebase is not set up yet.", "error");
  const btn = $("#google-btn");
  btn.disabled = true;
  try {
    const user = await signInWithGoogle();
    await goAfterLogin(user, { as, next });
  } catch (err) {
    console.error(err);
    const msg = googleErrorMessage(err);
    if (msg) toast(msg, "error");
    btn.disabled = false;
  }
});

// ---------- Forgot password ----------
function showReset(show) {
  $("#reset-form").classList.toggle("hidden", !show);
  $("#login-form").classList.toggle("hidden", show);
  $("#google-btn").classList.toggle("hidden", show);
  document.querySelector(".auth-divider").classList.toggle("hidden", show);
  if (show) { $("#reset-email").value = $("#email").value.trim(); $("#reset-email").focus(); }
}
$("#forgot-link").addEventListener("click", (e) => { e.preventDefault(); showReset(true); });
$("#reset-cancel").addEventListener("click", () => showReset(false));
$("#reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ready) return toast("Firebase is not set up yet.", "error");
  const email = $("#reset-email").value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter a valid email address.", "error");
  const btn = $("#reset-btn");
  btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    // Same message whether or not the account exists (doesn't reveal who has an account).
    toast(`If an account exists for ${email}, a reset link has been sent. Check your inbox and spam folder.`, "success");
    $("#email").value = email;
    showReset(false);
  } catch (err) {
    console.error(err);
    if (err.code === "auth/invalid-email") toast("Enter a valid email address.", "error");
    else if (err.code === "auth/too-many-requests") toast("Too many requests. Try again in a few minutes.", "error");
    else toast(`If an account exists for ${email}, a reset link has been sent.`, "success");
  } finally {
    btn.disabled = false;
  }
});
