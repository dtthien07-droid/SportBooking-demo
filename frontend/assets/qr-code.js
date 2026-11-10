'use strict';

(() => {
  const size = 33;
  const dataCodewords = 80;
  const eccCodewords = 20;

  function multiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function codewords(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > 78) throw new Error('QR payload exceeds capacity');
    const bits = [];
    const append = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    append(4, 4); append(bytes.length, 8); bytes.forEach((byte) => append(byte, 8));
    append(0, Math.min(4, dataCodewords * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
    for (let pad = 0; words.length < dataCodewords; pad += 1) words.push(pad % 2 ? 0x11 : 0xec);
    let generator = [1];
    let root = 1;
    for (let i = 0; i < eccCodewords; i += 1) {
      const next = new Array(generator.length + 1).fill(0);
      generator.forEach((coefficient, j) => { next[j] ^= coefficient; next[j + 1] ^= multiply(coefficient, root); });
      generator = next;
      root = multiply(root, 2);
    }
    const remainder = new Array(eccCodewords).fill(0);
    words.forEach((word) => {
      const factor = word ^ remainder.shift();
      remainder.push(0);
      generator.slice(1).forEach((coefficient, j) => { remainder[j] ^= multiply(coefficient, factor); });
    });
    return [...words, ...remainder];
  }
  function matrixFor(text) {
    const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
    const set = (x, y, value) => { if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = value; };
    function finder(cx, cy) {
      for (let dy = -1; dy <= 7; dy += 1) for (let dx = -1; dx <= 7; dx += 1) {
        const x = cx + dx, y = cy + dy;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        set(x, y, inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)));
      }
    }
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    for (let i = 8; i < size - 8; i += 1) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      set(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Reserve both format information areas and the fixed dark module.
    for (let i = 0; i <= 5; i += 1) set(8, i, false);
    set(8, 7, false); set(8, 8, false); set(7, 8, false);
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, false);
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, false);
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, false);
    set(8, size - 8, true);
    const bits = codewords(text).flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
    let bit = 0, upward = true;
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
    // Error correction level L, mask 0.
    let format = (1 << 3) | 0;
    let rem = format << 10;
    for (let i = 14; i >= 10; i -= 1) if (((rem >>> i) & 1) !== 0) rem ^= 0x537 << (i - 10);
    const formatBits = ((format << 10) | rem) ^ 0x5412;
    const f = (i) => ((formatBits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) matrix[i][8] = f(i);
    matrix[7][8] = f(6); matrix[8][8] = f(7); matrix[8][7] = f(8);
    for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = f(i);
    for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = f(i);
    for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = f(i);
    matrix[size - 8][8] = true;
    return matrix;
  }
  function toSvg(text) {
    const matrix = matrixFor(text);
    const quiet = 4, dimension = size + quiet * 2;
    let paths = '';
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) paths += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="QR ${text}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${paths}" fill="#111"/></svg>`;
  }
  window.SportBookingQRCode = { toSvg };
})();
