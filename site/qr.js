(function () {
  // QR code: byte mode, error correction level M, versions 1-10 (up to ~210 bytes of UTF-8).
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];
  }
  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
    return r;
  }

  // Reed-Solomon over GF(256) with polynomial 0x11D.
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = mul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = mul(root, 2);
    }
    return r;
  }
  function remainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function codewords(bytes) {
    var ver, countBits;
    for (ver = 1; ver <= 10; ver++) {
      countBits = ver < 10 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error('QR: text is too long');

    var bits = [];
    var put = function (v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(bytes.length, countBits);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
      data.push(b);
    }

    var nb = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    var numShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = divisor(eccLen), blocks = [];
    for (i = 0, k = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
      k += dat.length;
      var ecc = remainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < nb; j++) {
        if (i !== shortLen - eccLen || j >= numShort) all.push(blocks[j][i]);
      }
    }
    return { ver: ver, data: all };
  }

  function penalty(m, size) {
    var p = 0, dark = 0, x, y, t;
    for (y = 0; y < size; y++) {
      for (t = 0; t < 2; t++) {
        var run = 1, line = '';
        for (x = 0; x < size; x++) {
          var v = t ? m[x][y] : m[y][x];
          line += v ? '1' : '0';
          if (x && v === (t ? m[x - 1][y] : m[y][x - 1])) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
          if (!t && v) dark++;
        }
        if (run >= 5) p += run - 2;
        line = '0000' + line + '0000';
        ['10111010000', '00001011101'].forEach(function (pat) {
          for (var i = line.indexOf(pat); i >= 0; i = line.indexOf(pat, i + 1)) p += 40;
        });
      }
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    }
    var total = size * size;
    return p + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }

  function encode(text) {
    var cw = codewords(Array.prototype.slice.call(new TextEncoder().encode(text)));
    var ver = cw.ver, size = ver * 4 + 17;
    var m = [], fn = [], i, j;
    for (i = 0; i < size; i++) {
      m.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    var set = function (x, y, dark) { m[y][x] = dark; fn[y][x] = true; };

    for (i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = c[0] + dx, y = c[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
      }
    });
    var pos = alignPositions(ver, size), last = pos.length - 1;
    pos.forEach(function (a, ia) {
      pos.forEach(function (b, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === last) || (ia === last && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });

    function format(mask) {
      var d = mask; // level M has format bits 00
      var r = d;
      for (var k = 0; k < 10; k++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var bits = ((d << 10) | r) ^ 0x5412;
      var bit = function (k) { return ((bits >>> k) & 1) !== 0; };
      for (k = 0; k <= 5; k++) set(8, k, bit(k));
      set(8, 7, bit(6));
      set(8, 8, bit(7));
      set(7, 8, bit(8));
      for (k = 9; k < 15; k++) set(14 - k, 8, bit(k));
      for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k));
      for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(k));
      set(8, size - 8, true);
    }
    format(0);
    if (ver >= 7) {
      var r = ver;
      for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = (ver << 12) | r;
      for (i = 0; i < 18; i++) {
        var on = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, on);
        set(b, a, on);
      }
    }

    var n = 0, data = cw.data;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (!fn[y][x] && n < data.length * 8) {
            m[y][x] = ((data[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0;
            n++;
          }
        }
      }
    }

    function applyMask(k) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x];
      }
    }
    var best = 0, bestPenalty = Infinity;
    for (i = 0; i < 8; i++) {
      applyMask(i);
      format(i);
      var p = penalty(m, size);
      if (p < bestPenalty) { best = i; bestPenalty = p; }
      applyMask(i);
    }
    applyMask(best);
    format(best);
    return { size: size, modules: m };
  }

  function svg(text) {
    var q = encode(text), d = '';
    for (var y = 0; y < q.size; y++) {
      for (var x = 0; x < q.size; x++) if (q.modules[y][x]) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
    }
    var s = q.size + 8;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges" role="img" aria-label="QR-код">' +
      '<rect width="' + s + '" height="' + s + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  var dialog;
  // targets: [{ label, url }] — several targets get a switch above the code.
  function show(title, targets) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'qr-dialog';
      dialog.innerHTML = '<div class="qr-box"><p class="qr-title"></p><div class="qr-tabs" role="group"></div>' +
        '<div class="qr-code"></div><a class="qr-url" target="_blank" rel="noopener"></a>' +
        '<p class="qr-hint">Наведите камеру телефона на код, чтобы открыть ссылку.</p>' +
        '<button class="qr-close" type="button">Закрыть</button></div>';
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
      dialog.querySelector('.qr-close').addEventListener('click', function () { dialog.close(); });
      document.body.appendChild(dialog);
    }
    var tabs = dialog.querySelector('.qr-tabs');
    var link = dialog.querySelector('.qr-url');
    function pick(t) {
      dialog.querySelector('.qr-code').innerHTML = svg(t.url);
      link.href = t.url;
      link.textContent = decodeURI(t.url);
      tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === t.label)); });
    }
    dialog.querySelector('.qr-title').textContent = title;
    tabs.textContent = '';
    tabs.hidden = targets.length < 2;
    targets.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.addEventListener('click', function () { pick(t); });
      tabs.appendChild(b);
    });
    pick(targets[0]);
    dialog.showModal();
  }

  window.QR = { encode: encode, svg: svg, show: show };
})();
