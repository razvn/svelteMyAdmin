# Log in and home

The user logs in with MySQL credentials on the cookie login page (choosing a server when several are
configured), lands on the home page or on the page they were sent from, and logs out from the user menu.

## Sub-features

- `login-ok`: valid credentials go to `/`. The home page shows heading `svelteMyAdmin` and
  `connection-info` with `root@127.0.0.1:33306`.
- `login-bad`: a wrong password stays on `/login`, and `login-error` contains
  `Cannot log in to the MySQL server`.
- `login-redirect`: a protected URL redirects to `/login?redirect=...` and returns there after login.
- `login-legacy`: `/index.php?route=/database/structure&db=sma_test` ends on `/db/sma_test/structure`.
- `logout`: user menu, then `Log out`, back to `/login`. `/` then redirects to `/login` again.
- `login-server`: `/login?server=2` logs in to MariaDB (`connection-info` shows `:33307`).

## How to get to it (user POV)

- Open any URL while logged out.
- Open the header user menu `User menu` and choose `Log out`.

## Driving it with sma-verify

Preconditions:

- Baseline from the README. Use a fresh browser context (each `journey` gets one).

Steps:

- **Login.** `login(page)` fills `Username` and `Password` and clicks `Log in`. The URL ends in `/`.
  `getByTestId('connection-info')` contains `root@127.0.0.1:33306`.
- **Wrong password.** `gotoReady(page, '/login')`, fill `Password` with `nope`, click `Log in`.
  `getByTestId('login-error')` contains `Cannot log in to the MySQL server`.
- **Redirect.** Logged out, `gotoReady(page, '/server/databases')`. The URL matches
  `/login?redirect=%2Fserver%2Fdatabases`. Log in, and the URL ends in `/server/databases`.
- **Logout.** Click button `User menu`, then menuitem `Log out`. The URL ends in `/login`.
- **Proof.** `proof('home')` after login and `proof('login-error')` after the bad attempt.

## Gotchas

- A `403 Cross-site POST form submissions are forbidden` page means the app was not started by
  `sma-verify up` (for example `node build` over http). See SKILL.md, Launch.
- Repeated wrong passwords count toward MySQL `max_connect_errors` for 127.0.0.1. Do not loop on them.
- `/login` while logged in redirects to `/`, so log out (or use a new journey) before testing the form.
