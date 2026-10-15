// Generates PNG icons (16x16, 48x48, 128x128) using Node.js built-in modules (zlib, fs)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(size) {
  const width = size;
  const height = size;
  
  // Create RGBA pixel buffer
  // We will draw a stylish dark badge with a neon cyan/emerald "M" / speech bubble
  const buffer = Buffer.alloc(width * height * 4);
  
  const center = size / 2;
  const radius = size * 0.46;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        // Gradient background from indigo to dark slate
        const t = y / height;
        const r = Math.round(15 + 25 * t);
        const g = Math.round(23 + 20 * t);
        const b = Math.round(42 + 40 * t);
        
        // Inner glyph: stylized speech bubble or "M"
        // Let's draw an inner rounded shape / icon
        const isBubble = (Math.abs(dx) < size * 0.28 && Math.abs(dy) < size * 0.22 && !(dy > size * 0.15 && dx < -size * 0.1));
        const isTail = (x >= size * 0.25 && x <= size * 0.38 && y >= size * 0.65 && y <= size * 0.8);
        
        if (isBubble || isTail) {
          // Vibrant cyan-teal color: #06b6d4 -> #10b981
          const gt = (x + y) / (width * 2);
          buffer[idx] = Math.round(6 + 10 * gt);       // R
          buffer[idx + 1] = Math.round(182 + 3 * gt);  // G
          buffer[idx + 2] = Math.round(212 - 83 * gt); // B
          buffer[idx + 3] = 255;                       // A
        } else {
          buffer[idx] = r;
          buffer[idx + 1] = g;
          buffer[idx + 2] = b;
          buffer[idx + 3] = 255;
        }
      } else if (dist <= radius + 1) {
        // Anti-aliased border
        const alpha = Math.max(0, Math.min(255, Math.round((radius + 1 - dist) * 255)));
        buffer[idx] = 15;
        buffer[idx + 1] = 23;
        buffer[idx + 2] = 42;
        buffer[idx + 3] = alpha;
      } else {
        // Transparent
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  // Build raw scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0; // Filter None
    buffer.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(scanlines);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idat = makeChunk('IDAT', compressed);

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function crc32(buf) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = createPng(size);
  const outPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
});
