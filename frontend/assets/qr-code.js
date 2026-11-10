'use strict';

(() => {
  const version = 15;
  const size = version * 4 + 17;
  const dataCodewords = 523;
  const eccCodewords = 22;
  const blockDataLengths = [87, 87, 87, 87, 87, 88];

  function multiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function errorCorrection(data) {
    let generator = [1];
    let root = 1;
    for (let i = 0; i < eccCodewords; i += 1) {
      const next = new Array(generator.length + 1).fill(0);
      generator.forEach((coefficient, j) => {
        next[j] ^= coefficient;
        next[j + 1] ^= multiply(coefficient, root);
      });
      generator = next;
      root = multiply(root, 2);
    }

    const remainder = new Array(eccCodewords).fill(0);
    data.forEach((word) => {
      const factor = word ^ remainder.shift();
      remainder.push(0);
      generator.slice(1).forEach((coefficient, j) => {
        remainder[j] ^= multiply(coefficient, factor);
      });
    });
    return remainder;
  }

  function codewords(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > dataCodewords - 3) throw new Error('QR payload exceeds capacity');
    const bits = [];
    const append = (value, length) => {
      for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
    };
    append(4, 4);
    append(bytes.length, 16);
    bytes.forEach((byte) => append(byte, 8));
    append(0, Math.min(4, dataCodewords * 8 - bits.length));
    while (bits.length % 8) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      words.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    }
    for (let pad = 0; words.length < dataCodewords; pad += 1) {
      words.push(pad % 2 ? 0x11 : 0xec);
    }

    const blocks = [];
    let offset = 0;
    for (const length of blockDataLengths) {
      const data = words.slice(offset, offset + length);
      offset += length;
      blocks.push({ data, remainder: errorCorrection(data) });
    }

    const interleaved = [];
    for (let i = 0; i < Math.max(...blockDataLengths); i += 1) {
      blocks.forEach(({ data }) => {
        if (data[i] !== undefined) interleaved.push(data[i]);
      });
    }
    for (let i = 0; i < eccCodewords; i += 1) {
      blocks.forEach(({ remainder }) => interleaved.push(remainder[i]));
    }
    return interleaved;
  }

  function matrixFor(text) {
    const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
    const set = (x, y, value) => {
      if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = value;
    };

    function finder(cx, cy) {
      for (let dy = -1; dy <= 7; dy += 1) {
        for (let dx = -1; dx <= 7; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
          set(x, y, inside && (
            dx === 0 || dx === 6 || dy === 0 || dy === 6
            || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)
          ));
        }
      }
    }

    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);
    for (let i = 8; i < size - 8; i += 1) {
      set(i, 6, i % 2 === 0);
      set(6, i, i % 2 === 0);
    }
    for (const centerY of [6, 26, 48, 70]) {
      for (const centerX of [6, 26, 48, 70]) {
        if ((centerX === 6 && centerY === 6)
            || (centerX === 6 && centerY === size - 7)
            || (centerX === size - 7 && centerY === 6)) continue;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            set(
              centerX + dx,
              centerY + dy,
              Math.max(Math.abs(dx), Math.abs(dy)) !== 1
            );
          }
        }
      }
    }
    for (let i = 0; i <= 5; i += 1) set(8, i, false);
    set(8, 7, false);
    set(8, 8, false);
    set(7, 8, false);
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, false);
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, false);
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, false);
    set(8, size - 8, true);

    let versionBits = version << 12;
    for (let i = 17; i >= 12; i -= 1) {
      if (((versionBits >>> i) & 1) !== 0) versionBits ^= 0x1f25 << (i - 12);
    }
    const encodedVersion = (version << 12) | versionBits;
    for (let i = 0; i < 18; i += 1) {
      const value = ((encodedVersion >>> i) & 1) !== 0;
      const x = size - 11 + (i % 3);
      const y = Math.floor(i / 3);
      matrix[y][x] = value;
      matrix[x][y] = value;
    }

    const bits = codewords(text).flatMap((byte) =>
      Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1)
    );
    let bit = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vert = 0; vert < size; vert += 1) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          if (matrix[y][x] !== null) continue;
          const value = bit < bits.length ? bits[bit] === 1 : false;
          matrix[y][x] = value !== ((x + y) % 2 === 0);
          bit += 1;
        }
      }
      upward = !upward;
    }

    let format = (1 << 3) | 0;
    let remainder = format << 10;
    for (let i = 14; i >= 10; i -= 1) {
      if (((remainder >>> i) & 1) !== 0) remainder ^= 0x537 << (i - 10);
    }
    const formatBits = ((format << 10) | remainder) ^ 0x5412;
    const formatBit = (i) => ((formatBits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) matrix[i][8] = formatBit(i);
    matrix[7][8] = formatBit(6);
    matrix[8][8] = formatBit(7);
    matrix[8][7] = formatBit(8);
    for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = formatBit(i);
    for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = formatBit(i);
    for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = formatBit(i);
    matrix[size - 8][8] = true;
    return matrix;
  }

  function toSvg(text) {
    const matrix = matrixFor(text);
    const quiet = 4;
    const dimension = size + quiet * 2;
    let paths = '';
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (matrix[y][x]) paths += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="QR vé đặt sân" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${paths}" fill="#111"/></svg>`;
  }

  window.SportBookingQRCode = { toSvg };
})();
