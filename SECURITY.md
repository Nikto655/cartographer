# Security policy

Cartographer handles accounts, sessions and personal access tokens, so security reports are
taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: on this
repository, open the **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the version or commit you tested. You will
get an acknowledgement, and a fix will be coordinated with you before anything is disclosed.

## Supported versions

Only the latest release on the default branch receives security fixes.

## Deployment notes

Cartographer speaks plain http and is meant to sit behind a reverse proxy that terminates TLS.
The login page is public by design; the rest of the API requires a session, and `/mcp` a
personal access token. See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for `COOKIE_SECURE`, `TRUST_PROXY` and the other
settings a public deployment has to get right.
