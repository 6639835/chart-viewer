// GDL90 message parser — Ownship Report (msg 10) only.
// Spec: Garmin GDL 90 Data Interface Specification Rev A (§3.5.1).

export interface OwnshipPosition {
  lat: number; // degrees, north positive
  lon: number; // degrees, east positive
  altitudeFt: number | null; // pressure altitude ft, null = invalid
  trackDeg: number | null; // true track 0-360°, null = not valid
  groundSpeedKt: number | null; // knots, null = not available
}

// CRC-CCITT table (polynomial 0x1021).
const CRC16_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++)
      c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++)
    crc =
      (CRC16_TABLE[(crc >> 8) & 0xff]! ^ ((crc << 8) & 0xffff) ^ data[i]!) &
      0xffff;
  return crc;
}

// HDLC byte unstuffing: 0x7D xx -> xx XOR 0x20.
function unstuff(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x7d) {
      i++;
      if (i < raw.length) out.push(raw[i]! ^ 0x20);
    } else out.push(raw[i]!);
  }
  return new Uint8Array(out);
}

// Signed 24-bit from 3 big-endian bytes.
function s24(a: number, b: number, c: number): number {
  const u = (a << 16) | (b << 8) | c;
  return u >= 0x800000 ? u - 0x1000000 : u;
}

// Validate frame between two 0x7E bytes, return payload (msgID included) or null.
function parseFrame(between: Uint8Array): Uint8Array | null {
  if (between.length < 3) return null;
  const clear = unstuff(between);
  if (clear.length < 3) return null;
  const payload = clear.slice(0, clear.length - 2);
  const fcsLo = clear[clear.length - 2]!;
  const fcsHi = clear[clear.length - 1]!;
  if (crc16(payload) !== ((fcsHi << 8) | fcsLo)) return null;
  return payload;
}

// Decode Traffic/Ownship report body per spec §3.5.1 Figure 2.
// `body` = payload bytes after msgID (27 bytes expected).
// Field layout (0-indexed within body):
//  [0]       st  — alert status (nibble) | address type (nibble)
//  [1..3]    aa aa aa — participant address
//  [4..6]    ll ll ll — latitude  (24-bit signed semicircles)
//  [7..9]    nn nn nn — longitude (24-bit signed semicircles)
//  [10..11]  dd dm — altitude 12 bits ([10] full + [11] upper nibble) | misc lower nibble of [11]
//  [12]      ia — NIC (upper) | NACp (lower)
//  [13..14]  hh hv — horiz vel 12 bits ([13] full + [14] upper nibble)
//  [14..15]  hv vv — vert vel 12 bits ([14] lower nibble + [15])
//  [16]      tt — track/heading
//  [17]      ee — emitter category
//  [18..25]  cc*8 — callsign
//  [26]      px — emergency | spare
function decodeOwnshipBody(body: Uint8Array): OwnshipPosition | null {
  if (body.length < 27) return null;

  const lat = s24(body[4]!, body[5]!, body[6]!) * (180 / 0x800000);
  const lon = s24(body[7]!, body[8]!, body[9]!) * (180 / 0x800000);

  const altRaw = (body[10]! << 4) | (body[11]! >> 4);
  const altitudeFt = altRaw === 0xfff ? null : altRaw * 25 - 1000;

  const misc = body[11]! & 0x0f;
  const trackValid = (misc & 0x03) !== 0;

  const gsRaw = (body[13]! << 4) | (body[14]! >> 4);
  const groundSpeedKt = gsRaw === 0xfff ? null : gsRaw;

  const trackDeg = trackValid ? (body[16]! / 256) * 360 : null;

  // NIC=0 + lat=lon=0 means no GPS fix.
  const nic = (body[12]! >> 4) & 0x0f;
  if (nic === 0 && lat === 0 && lon === 0) return null;

  return { lat, lon, altitudeFt, trackDeg, groundSpeedKt };
}

const MSG_OWNSHIP = 10;

// Parse a raw UDP datagram containing one or more GDL90 HDLC frames.
// Returns the first valid Ownship Report position, or null.
export function parseGdl90Datagram(buf: Uint8Array): OwnshipPosition | null {
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0x7e) {
      i++;
      continue;
    }
    const frameStart = i + 1;
    i++;
    while (i < buf.length && buf[i] !== 0x7e) i++;
    if (i >= buf.length) break;
    const payload = parseFrame(buf.slice(frameStart, i));
    i++;
    if (!payload || payload.length < 1) continue;
    if ((payload[0]! & 0x7f) === MSG_OWNSHIP && payload.length >= 28) {
      const pos = decodeOwnshipBody(payload.slice(1));
      if (pos) return pos;
    }
  }
  return null;
}
