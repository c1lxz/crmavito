import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const background = path.join(root, "tmp", "size-guide", "editorial-background.png");
const output = path.join(root, "public", "assets", "ky-strok-size-guide-v2.jpg");

const longSleeve = [
  ["XXS", "46", "66", "10,5", "62", "150–155", "40–45"],
  ["XS", "48", "68", "11", "63", "155–160", "45–50"],
  ["S", "50", "70", "11", "64", "160–165", "50–55"],
  ["M", "52", "72", "11,5", "64", "165–170", "55–65"],
  ["L", "54", "74", "12", "65", "170–175", "65–75"],
  ["XL", "56", "76", "12,5", "65", "175–180", "75–85"],
  ["XXL", "58", "78", "12,5", "66", "180–185", "85–95"],
  ["3XL", "62", "80", "13,5", "66", "185–190", "95–105"],
];

const tshirt = [
  ["XXS", "43", "62", "17", "150–155", "40–45"],
  ["XS", "45", "62", "18,5", "155–160", "45–50"],
  ["S", "47,5", "65", "20,5", "160–165", "50–55"],
  ["M", "50", "69", "21", "165–170", "55–65"],
  ["L", "55", "72", "21", "170–175", "65–75"],
  ["XL", "56", "73", "22", "175–180", "75–85"],
  ["XXL", "56", "75", "22", "180–185", "85–95"],
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
    .head { font-size: 18px; font-weight: 800; letter-spacing: .2px; }
    .cell { font-size: 25px; font-weight: 650; }
    .note { font-size: 22px; font-weight: 600; fill: #4b4b48; }
  </style>

  <rect x="286" y="74" width="1090" height="895" rx="7" fill="#f3f0e9" fill-opacity=".93"/>
  <rect x="196" y="1026" width="1090" height="885" rx="7" fill="#f3f0e9" fill-opacity=".93"/>

  <text x="352" y="151" class="eyebrow">ТАБЛИЦА РАЗМЕРОВ</text>
  <text x="352" y="230" class="title">ЛОНГСЛИВ</text>
  <text x="352" y="273" class="unit">Все измерения указаны в сантиметрах</text>
  <line x1="352" y1="310" x2="1315" y2="310" stroke="#171717" stroke-width="3"/>

  <text x="395" y="367" class="head">РАЗМЕР</text>
  <text x="535" y="367" class="head">ШИРИНА</text>
  <text x="675" y="367" class="head">ДЛИНА</text>
  <text x="825" y="352" class="head" text-anchor="middle">ШИРИНА</text>
  <text x="825" y="377" class="head" text-anchor="middle">РУКАВА</text>
  <text x="965" y="352" class="head" text-anchor="middle">ДЛИНА</text>
  <text x="965" y="377" class="head" text-anchor="middle">РУКАВА</text>
  <text x="1110" y="367" class="head" text-anchor="middle">РОСТ, СМ</text>
  <text x="1260" y="367" class="head" text-anchor="middle">ВЕС, КГ</text>
  <line x1="352" y1="405" x2="1315" y2="405" stroke="#8b8983" stroke-width="2"/>

  ${rows(longSleeve, [405, 555, 695, 825, 965, 1110, 1260], 463, 58)}
  <line x1="352" y1="902" x2="1315" y2="902" stroke="#171717" stroke-width="3"/>
  <text x="352" y="932" class="note">Рост и вес — рекомендованные параметры.</text>
  <text x="352" y="960" class="note">Замеры выполнены по изделию, разложенному на ровной поверхности.</text>

  <text x="256" y="1103" class="eyebrow">ТАБЛИЦА РАЗМЕРОВ</text>
  <text x="256" y="1182" class="title">ФУТБОЛКА</text>
  <text x="256" y="1225" class="unit">Все измерения указаны в сантиметрах</text>
  <line x1="256" y1="1262" x2="1225" y2="1262" stroke="#171717" stroke-width="3"/>

  <text x="300" y="1325" class="head">РАЗМЕР</text>
  <text x="485" y="1325" class="head">ШИРИНА</text>
  <text x="655" y="1325" class="head">ДЛИНА</text>
  <text x="810" y="1325" class="head">РУКАВ</text>
  <text x="995" y="1325" class="head">РОСТ, СМ</text>
  <text x="1155" y="1325" class="head">ВЕС, КГ</text>
  <line x1="256" y1="1360" x2="1225" y2="1360" stroke="#8b8983" stroke-width="2"/>

  ${rows(tshirt, [325, 520, 690, 835, 1010, 1170], 1425, 63)}
  <line x1="256" y1="1832" x2="1225" y2="1832" stroke="#171717" stroke-width="3"/>
  <text x="256" y="1868" class="note">Рост и вес — рекомендованные параметры.</text>
  <text x="256" y="1900" class="note">Допустимое отклонение при производстве: ±1–2 см.</text>
</svg>`);

await sharp(background)
  .resize(1600, 2000, { fit: "cover" })
  .composite([{ input: overlay, top: 0, left: 0 }])
  .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
  .toFile(output);

console.log(output);
