/**
 * Utilitários de autenticação.
 * Usa apenas módulos nativos do Node.js (crypto) — sem dependências externas.
 *
 * - Hash de senha: scrypt (salt aleatório de 16 bytes, derivação de 64 bytes)
 * - JWT: HS256 manual (header.payload.sig em base64url)
 */
import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);

// ── helpers base64url ────────────────────────────────────────────────────────

function b64uEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64uDecode(str: string): string {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

// ── senha (scrypt) ───────────────────────────────────────────────────────────

/**
 * Gera o hash de uma senha.
 * Retorna string no formato `salt_hex:hash_hex`.
 */
export async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await scryptAsync(senha, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

/**
 * Verifica se a senha em texto plano corresponde ao hash armazenado.
 */
export async function verificarSenha(
  senha: string,
  senhaHash: string
): Promise<boolean> {
  const [salt, hashHex] = senhaHash.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scryptAsync(senha, salt, 64)) as Buffer;
  const stored = Buffer.from(hashHex, "hex");
  // comparação em tempo constante para evitar timing attacks
  return (
    derived.length === stored.length &&
    crypto.timingSafeEqual(derived, stored)
  );
}

// ── JWT HS256 ────────────────────────────────────────────────────────────────

export interface JwtPayload {
  motoristaId: string;
  iat: number;
  exp: number;
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado no .env");
  return s;
}

function hmacSha256(data: string, key: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(data)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** Gera um JWT HS256 com expiração de 14 dias. */
export function gerarJwt(motoristaId: string): string {
  const header = b64uEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 14 * 24 * 60 * 60; // 14 dias
  const payload = b64uEncode(
    JSON.stringify({ motoristaId, iat: now, exp })
  );
  const sig = hmacSha256(`${header}.${payload}`, jwtSecret());
  return `${header}.${payload}.${sig}`;
}

/** Verifica e decodifica um JWT HS256. Lança erro se inválido ou expirado. */
export function verificarJwt(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT mal-formado");

  const [header, payloadB64, sig] = parts;
  const expectedSig = hmacSha256(`${header}.${payloadB64}`, jwtSecret());

  if (
    !crypto.timingSafeEqual(
      Buffer.from(sig, "utf8"),
      Buffer.from(expectedSig, "utf8")
    )
  ) {
    throw new Error("Assinatura JWT inválida");
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64uDecode(payloadB64));
  } catch {
    throw new Error("JWT payload inválido");
  }

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("JWT expirado");
  }

  return payload;
}

/**
 * Extrai o motoristaId do header Authorization: Bearer <token>.
 * Retorna null se ausente ou inválido.
 */
export function extrairMotoristaIdDoJwt(
  authHeader: string | undefined
): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  try {
    const payload = verificarJwt(token);
    return payload.motoristaId;
  } catch {
    return null;
  }
}
