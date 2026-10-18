// pnpm keys: generate the verifier Ed25519 key pair (SPEC §10.1) and the web session secret.
//   apps/web/.env.local     VERIFIER_PRIVATE_KEY_B64  (signs verdicts)
//   services/payments/.env  VERIFIER_PUBLIC_KEY_B64   (checks verdicts)
//   apps/web/.env.local     SESSION_SECRET            (signs the session cookie)
// Appends only when a variable is not already set, and never prints key material.
// Optional argument: the repo root (used by tests); defaults to this script's parent directory.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const WEB = { file: join(root, "apps/web/.env.local"), name: "VERIFIER_PRIVATE_KEY_B64" };
const PAY = { file: join(root, "services/payments/.env"), name: "VERIFIER_PUBLIC_KEY_B64" };
const SESSION = { file: WEB.file, name: "SESSION_SECRET" };

const pair = () => generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const b64 = (s) => Buffer.from(s).toString("base64");

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const lineRe = (name) => new RegExp(`^[ \\t]*${name}[ \\t]*=(.*)$`, "m");
const isSet = (text, name) => {
  const m = text.match(lineRe(name));
  return m !== null && m[1].trim() !== "";
};

function write(target, value) {
  const text = read(target.file);
  const line = `${target.name}=${value}`;
  let next;
  if (lineRe(target.name).test(text)) {
    next = text.replace(lineRe(target.name), line); // an empty placeholder line, e.g. from .env.example
  } else {
    next = text + (text === "" || text.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  mkdirSync(dirname(target.file), { recursive: true });
  writeFileSync(target.file, next, { mode: 0o600 });
  chmodSync(target.file, 0o600);
}

const webSet = isSet(read(WEB.file), WEB.name);
const paySet = isSet(read(PAY.file), PAY.name);
const rel = (f) => f.slice(root.length + 1);

if (webSet && paySet) {
  console.log(`Verifier keys already set in ${rel(WEB.file)} and ${rel(PAY.file)}; nothing to do.`);
} else if (webSet !== paySet) {
  // Writing a fresh half would leave a private and public key that do not match.
  const [has, missing] = webSet ? [WEB, PAY] : [PAY, WEB];
  console.error(
    `${has.name} is set in ${rel(has.file)} but ${missing.name} is missing from ${rel(missing.file)}.\n` +
    `Remove ${has.name} from ${rel(has.file)} and run pnpm keys again to create a matching pair.`,
  );
  process.exit(1);
} else {
  const v = pair();
  write(WEB, b64(v.privateKey));
  write(PAY, b64(v.publicKey));
  console.log(`Wrote ${WEB.name} to ${rel(WEB.file)}`);
  console.log(`Wrote ${PAY.name} to ${rel(PAY.file)}`);
}

if (isSet(read(SESSION.file), SESSION.name)) {
  console.log(`${SESSION.name} already set in ${rel(SESSION.file)}; nothing to do.`);
} else {
  write(SESSION, randomBytes(32).toString("base64url"));
  console.log(`Wrote ${SESSION.name} to ${rel(SESSION.file)}`);
}
