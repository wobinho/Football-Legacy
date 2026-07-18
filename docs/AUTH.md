# Game-key authentication — Football Legacy

Access control that needs **no server** and costs **$0** to run: players unlock
the game with a **cryptographically signed key**. You sign keys with a private
key that never leaves your machine; the app verifies them **in the browser**
against an embedded public key. A forged key is computationally infeasible
without your private key, and verification needs no network.

- Implementation: `lib/auth.ts` (verify) · `components/KeyGate.tsx` (the gate) ·
  `scripts/genkey.mjs` (make/sign keys).
- Crypto: **ECDSA P-256 / SHA-256** — chosen over Ed25519 for browser reach
  (P-256 `crypto.subtle` works in every browser, including older mobile).

## Default state: OFF (open)

Out of the box, **auth is disabled** — the gate renders straight through and the
game is open. It only switches on once you embed a real public key. So you can
launch an open beta today and turn gating on later with a one-line change +
redeploy.

## Turning it on

1. **Generate a keypair (once):**
   ```
   node scripts/genkey.mjs --new-keypair
   ```
   It prints:
   - a **PUBLIC** key → paste it into `PUBLIC_KEY_JWK` in `lib/auth.ts`;
   - a **PRIVATE** key → save it somewhere secret (e.g. `gamekey.private.json`),
     **never commit it or ship it**. It's how you sign keys.

2. **Redeploy.** With a real public key embedded, `isAuthConfigured()` becomes
   true and the gate now requires a valid key.

3. **Sign a key per player:**
   ```
   node scripts/genkey.mjs --sign --priv gamekey.private.json --id alice
   node scripts/genkey.mjs --sign --priv gamekey.private.json --id promo --days 30
   ```
   - Omit `--days` for a **perpetual** key; add it for a **time-limited** one.
   - Hand the printed key string to the player. They paste it once; it's
     remembered in `localStorage` so they're not asked again on that device.

## Key format

`<payloadB64url>.<signatureB64url>` where the payload is JSON:
```json
{ "id": "alice", "exp": 1760000000000, "note": "optional" }
```
The signature is over the exact payload bytes. `exp` (unix ms) is optional and
enforced at verify time.

## What this does and doesn't do

**Does:** stop casual sharing/piracy without a backend; support expiring keys;
work offline; cost nothing to run.

**Doesn't:** allow **revocation** of an already-issued key, or one-key-per-device
limits — those need a server to track state. If you need them, keep the same key
format but add a `/api/redeem` route backed by a KV store (Vercel KV / Upstash);
that's the only piece that turns "$0 forever" into a small monthly cost. See
`DEPLOYMENT.md` §6.

## Security notes

- The **private key is the only secret**. Guard it. If it leaks, generate a new
  keypair, swap the public key, redeploy (old keys stop verifying).
- Verified round-trip is tested: valid keys verify, tampered keys reject, expiry
  is enforced.
- This gates **access to the app**, not the save data (saves are local JSON and
  inherently user-editable — that's intended, since the save is also the modding
  format).
