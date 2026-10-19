CAMPUS ORG ATTENDANCE VIA QR (multi-organization version, 1-year membership)
=========================================================

PAGES
  index.html       Landing page (Create account / Member login / Officer login / Admin login)
  signup.html      Create an account (one account for all orgs)
  login.html       Login for members, officers and admin
  home.html        My orgs, join orgs, re-register, request a new org, my QR code
  org.html         Org page: My Membership, Events, Members & Officers, Org Settings
  scanner.html     Officers scan QR codes for an event
  attendance.html  Officers view / download attendance for an event
  admin.html       Admin approves org requests, sets the org limit, deletes orgs
  account.html     My account: edit details, reset password, download my data, delete account
  privacy.html     Privacy Policy (linked in the header, footer and sign-up form)
  about.html       About the website, features, roles, team
  js/firebase-config.js   <-- PASTE YOUR FIREBASE CONFIG HERE
  js/site-config.js       <-- Site name, university, team members, contact email, data region
  firestore.rules  Security rules - paste into Firebase (REQUIRED)

ROLES
  Admin           Approves/rejects org requests, sets max number of orgs, deletes orgs
  President       Everything officers can do + promote/demote/remove anyone,
                  org name/description, and pass the presidency to another member
  Vice President  Promote/demote/remove Members, Secretaries, Treasurers; org name/description
  Secretary,
  Treasurer       Create events, scan attendance, view members and attendance
  Member          Register, re-register when expired, see events and own attendance

FIREBASE SETUP (one time)
  1. console.firebase.google.com -> Create project (turn off Analytics)
  2. Click the Web icon </> -> register app -> copy the config values into
     js/firebase-config.js.
     Then open js/site-config.js and fill in TEAM_MEMBERS, COURSE_INFO and
     CONTACT_EMAIL (shown on the About and Privacy pages). DATA_REGION must
     match the Firestore location you pick in step 3.
  3. Firestore Database -> Create database -> asia-southeast1 -> Production mode
  4. Firestore -> Rules tab -> delete everything -> paste ALL of firestore.rules -> Publish
  5. Authentication -> Get started -> Email/Password -> Enable

MAKE YOURSELF THE ADMIN (one time)
  6. Run the website and create a normal account on signup.html (this will be the admin).
  7. Firebase console -> Authentication -> Users -> copy the "User UID" of that account.
  8. Firestore Database -> Start collection -> Collection ID: admins
     -> Document ID: paste the User UID -> add any field, e.g.  role (string) = admin -> Save
  9. Log in with "Admin login". The admin page creates the org limit setting
     automatically (default 5 orgs; change it on the admin page).

SAMPLE FLOW (for testing and screenshots)
  - Student A signs up -> Home -> "Start a new organization" -> request
  - Admin approves -> Student A becomes President
  - Students B, C, D sign up -> "Register as member"
  - President promotes B to Vice President, C to Secretary
  - Secretary creates an event -> Scan QR -> scan members' QR codes
  - Members open the org to see "Events I attended"
  - Membership lasts 1 year from registration. After 1 year it shows Expired and the
    member clicks Re-register (officers do not expire while holding a position)
  - President -> Members & Officers -> "Pass the presidency"

RUN LOCALLY
  VS Code -> right-click index.html -> "Open with Live Server".
  Laptop webcam scanning works on 127.0.0.1. Phone cameras need the https:// link
  from GitHub Pages.

UPDATING FROM THE PREVIOUS VERSION
  1. Keep YOUR js/firebase-config.js (copy it over the new placeholder one).
  2. Edit js/site-config.js (team, contact email, data region).
  3. Firestore -> Rules -> paste the NEW firestore.rules -> Publish.
     (Needed for editing details, deleting accounts and the privacy consent.)
  4. Upload all files to GitHub again.

EVENT TIMES (added)
  Each event has a date, start time and end time. Officers can scan from
  30 minutes before the start until the end time; after that the scanner
  locks and the Firestore rules refuse new attendance records.
  (Change the 30 minutes in js/common.js SCAN_EARLY_MINUTES AND in
  firestore.rules scanWindowOpen - keep both the same.)
