import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const background = path.join(root, "tmp", "size-guide", "editorial-background.png");
const output = path.join(root, "public", "assets", "ky-strok-size-guide.jpg");

const longSleeve = [
  ["XXS", "46", "66", "10,5", "62"],
  ["XS", "48", "68", "11", "63"],
  ["S", "50", "70", "11", "64"],
  ["M", "52", "72", "11,5", "64"],
  ["L", "54", "74", "12", "65"],
  ["XL", "56", "76", "12,5", "65"],
  ["XXL", "58", "78", "12,5", "66"],
  ["3XL", "62", "80", "13,5", "66"],
];

const tshirt = [
  ["XXS", "43", "62", "17"],
  ["XS", "45", "62", "18,5"],
  ["S", "47,5", "65", "20,5"],
  ["M", "50", "69", "21"],
  ["L", "55", "72", "21"],
  ["XL", "56", "73", "22"],
  ["XXL", "56", "75", "22"],
];

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function rows(values, columns, startY, rowHeight) {
  return values.map((row, rowIndex) => row.map((cell, columnIndex) => {
    const x = columns[columnIndex];
    const y = startY + rowIndex * rowHeight;
    return `<text x="${x}" y="${y}" class="cell">${esc(cell)}</text>`;
  }).join("")).join("");
}

const overlay = Buffer.from(`
<svg width="1600" height="2000" viewBox="0 0 1600 2000" xmlns="http://www.w3.org/2000/svg">
  <style>
    text { font-family: Inter, Arial, "DejaVu Sans", sans-serif; fill: #151515; }
    .eyebrow { font-size: 24px; font-weight: 700; letter-spacing: 7px; }
    .title { font-size: 73px; font-weight: 900; letter-spacing: -2px; }
    .unit { font-size: 23px; font-weight: 600; fill: #5b5b58; }
    .head { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
    .cell { font-size: 31px; font-weight: 650; }
    .note { font-size: 22px; font-weight: 600; fill: #4b4b48; }
  </style>

  <rect x="286" y="74" width="1090" height="895" rx="7" fill="#f3f0e9" fill-opacity=".93"/>
  <rect x="196" y="1026" width="1090" height="885" rx="7" fill="#f3f0e9" fill-opacity=".93"/>

  <text x="352" y="151" class="eyebrow">ТАБЛИЦА РАЗМЕРОВ</text>
  <text x="352" y="230" class="title">ЛОНГСЛИВ</text>
  <text x="352" y="273" class="unit">Все измерения указаны в сантиметрах</text>
  <line x1="352" y1="310" x2="1315" y2="310" stroke="#171717" stroke-width="3"/>

  <text x="405" y="367" class="head">РАЗМЕР</text>
  <text x="635" y="367" class="head">ШИРИНА</text>
  <text x="845" y="367" class="head">ДЛИНА</text>
  <text x="1033" y="352" class="head" text-anchor="middle">ШИРИНА</text>
  <text x="1033" y="380" class="head" text-anchor="middle">РУКАВА</text>
  <text x="1245" y="352" class="head" text-anchor="middle">ДЛИНА</text>
  <text x="1245" y="380" class="head" text-anchor="middle">РУКАВА</text>
  <line x1="352" y1="405" x2="1315" y2="405" stroke="#8b8983" stroke-width="2"/>

  ${rows(longSleeve, [450, 690, 875, 1033, 1245], 463, 58)}
  <line x1="352" y1="902" x2="1315" y2="902" stroke="#171717" stroke-width="3"/>
  <text x="352" y="942" class="note">Замеры выполнены по изделию, разложенному на ровной поверхности.</text>

  <text x="256" y="1103" class="eyebrow">ТАБЛИЦА РАЗМЕРОВ</text>
  <text x="256" y="1182" class="title">ФУТБОЛКА</text>
  <text x="256" y="1225" class="unit">Все измерения указаны в сантиметрах</text>
  <line x1="256" y1="1262" x2="1225" y2="1262" stroke="#171717" stroke-width="3"/>

  <text x="335" y="1325" class="head">РАЗМЕР</text>
  <text x="625" y="1325" class="head">ШИРИНА</text>
  <text x="870" y="1325" class="head">ДЛИНА</text>
  <text x="1090" y="1325" class="head">РУКАВ</text>
  <line x1="256" y1="1360" x2="1225" y2="1360" stroke="#8b8983" stroke-width="2"/>

  ${rows(tshirt, [380, 680, 920, 1125], 1425, 63)}
  <line x1="256" y1="1832" x2="1225" y2="1832" stroke="#171717" stroke-width="3"/>
  <text x="256" y="1875" class="note">Допустимое отклонение при производстве: ±1–2 см.</text>
</svg>`);

await sharp(background)
  .resize(1600, 2000, { fit: "cover" })
  .composite([{ input: overlay, top: 0, left: 0 }])
  .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
  .toFile(output);

console.log(output);
