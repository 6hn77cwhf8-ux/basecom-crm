import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

/** Códigos de 6 dígitos a cada 30 s (SHA-1): o formato do Microsoft Authenticator. */
function totpFor(secretBase32: string, email: string) {
  return new TOTP({ issuer: "BASECOM CRM", label: email, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });
}

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** Aceita o código atual e o anterior/seguinte (relógio do telemóvel ligeiramente desacertado). */
export function verifyTotp(secretBase32: string, email: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totpFor(secretBase32, email).validate({ token: clean, window: 1 }) !== null;
}

export function currentTotp(secretBase32: string, email: string): string {
  return totpFor(secretBase32, email).generate();
}

export async function totpEnrollment(secretBase32: string, email: string) {
  const url = totpFor(secretBase32, email).toString();
  return { otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }), secret: secretBase32 };
}
