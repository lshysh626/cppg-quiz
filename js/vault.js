"use strict";

// 문제집 PDF를 비밀번호로 암호화/복호화한다 (Web Crypto, AES-256-GCM + PBKDF2-SHA256).
// 파일 형식: "CPPGENC1"(8) | 반복 횟수 uint32 BE(4) | salt(16) | iv(12) | 암호문(GCM 태그 포함)
(function () {
  const MAGIC = new TextEncoder().encode("CPPGENC1");
  const ITERATIONS = 1500000;
  const HEADER = MAGIC.length + 4 + 16 + 12;

  async function deriveKey(password, salt, iterations, usage) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
  }

  async function encrypt(bytes, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS, "encrypt");
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, bytes));
    const out = new Uint8Array(HEADER + cipher.length);
    out.set(MAGIC, 0);
    new DataView(out.buffer).setUint32(MAGIC.length, ITERATIONS);
    out.set(salt, MAGIC.length + 4);
    out.set(iv, MAGIC.length + 20);
    out.set(cipher, HEADER);
    return out;
  }

  async function decrypt(file, password) {
    const data = new Uint8Array(file);
    if (data.length <= HEADER || !MAGIC.every((b, i) => data[i] === b)) throw new Error("암호화 파일 형식이 아닙니다.");
    const iterations = new DataView(data.buffer, data.byteOffset).getUint32(MAGIC.length);
    const salt = data.slice(MAGIC.length + 4, MAGIC.length + 20);
    const iv = data.slice(MAGIC.length + 20, HEADER);
    const key = await deriveKey(password, salt, iterations, "decrypt");
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, data.slice(HEADER)));
    } catch {
      throw new Error("비밀번호가 맞지 않습니다.");
    }
  }

  window.Vault = { encrypt, decrypt, URL: "library/cppg.enc" };
})();
