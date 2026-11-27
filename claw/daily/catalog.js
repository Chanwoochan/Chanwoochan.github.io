// X, Y and Z are the box dimensions in mm after laying the largest panel flat.
// Mass in grams includes the figure and its retail packaging. Each row links
// to the retailer's original Item Size/Weight listing.
const rows = [
  ['orbit', '달토끼 측량사', 'Lunar Surveyor', 152, 200, 102, 260, '반프레스토 DXF 손오천', 'unopened-dragon-ball-super-super-hero-dxf-son-goten-bnp00345-pre'],
  ['diver', '심해 등불 문어', 'Abyss Diver', 125, 185, 95, 213, '반프레스토 Q posket 아가츠마 젠이츠 A', 'used-item-a-demon-slayer-kimetsu-no-yaiba-q-posket-zenitsu-agatsuma-a-bnp00457-pre'],
  ['moss', '걸어가는 온실', 'Moss House', 153, 204, 150, 260, '후류 누들 스토퍼 하츠네 미쿠', 'miku-hatsune-noodle-stopper-figure-fruamu-prz18157'],
  ['fox', '사막여우 우편배달부', 'Dune Express', 180, 260, 70, 320, '세가 Luminasta 아스카', 'used-item-unopened-rebuild-of-evangelion-luminasta-asuka-seg1107399-pre'],
  ['whale', '별을 읽는 고래', 'Astral Whale', 155, 250, 145, 666, '반프레스토 Grandista 보아 행콕', 'used-item-unopened-one-piece-grandista-boa-hancock-bnp00482-pre'],
  ['moth', '달나방 마술사', 'Luna Moth', 122, 181, 92, 150, '반프레스토 DXF 우타 칠드런', 'unopened-one-piece-film-red-dxf-uta-children-bnp00347-pre'],
  ['kettle', '찻주전자 로봇', 'Kettle Club', 151, 201, 112, 250, '후류 누들 스토퍼 이누야샤', 'inuyasha-noodle-stopper-figure-inuyasha-fruamu-prz11187'],
  ['puffin', '퍼핀 등대지기', 'Beacon Keeper', 128, 150, 80, 140, '후류 누들 스토퍼 슈퍼 소니코 A', 'super-sonico-noodle-stopper-figure-renewal-a-fru9001-a'],
  ['comet', '레서판다 롤러클럽', 'Comet Skate', 120, 180, 90, 250, '반프레스토 DXF 와노쿠니 그랜드라인 레이디 10', 'unopened-one-piece-dxf-the-grandline-lady-wanokuni-vol-10-bnp00330-pre'],
  ['gecko', '유리공예 도마뱀', 'Glass Gecko', 155, 265, 145, 669, '반프레스토 Grandista 아가츠마 젠이츠', 'used-item-a-demon-slayer-kimetsu-no-yaiba-grandista-agatsuma-zenitsu-bnp00491-pre'],
];

export const prizes = rows.map(([id, name, title, width, length, height, grams, reference, slug]) => ({
  id, key: 'daily-' + id, name, title, width, length, height, grams, reference,
  source: 'https://www.hlj.com/' + slug,
  art: Object.fromEntries(['front', 'long', 'short'].map(face =>
    [face, new URL('./art/' + id + '-' + face + '.webp', import.meta.url).href])),
}));

const dayMs = 86400000;
const kstOffset = 9 * 3600000;
const firstDay = Date.UTC(2026, 10, 27) / dayMs;

export function dailyAt(time = Date.now()) {
  const day = Math.floor((time + kstOffset) / dayMs);
  const index = ((day - firstDay) % prizes.length + prizes.length) % prizes.length;
  return {day, date: new Date(day * dayMs).toISOString().slice(0, 10),
    next: (day + 1) * dayMs - kstOffset, prize: prizes[index]};
}

export function bridgeSetup(prize, rodRadius) {
  const {width, length, height, grams} = prize;
  // All three gaps in model_author are surface-to-surface. Leave at least
  // 10 mm of flat support beyond each inner rod's centreline at spawn.
  const radiusMm = rodRadius * 1000;
  const inner = Math.min(Math.round(height + (length - height) * .32),
    Math.floor(length - 2 * (radiusMm + 10)));
  const outer = Math.round(length * .30);
  return {box_width: width / 1000, box_length: length / 1000,
    box_height: height / 1000, box_mass: grams / 1000,
    gap: inner / 1000, gap_12: outer / 1000, gap_34: outer / 1000};
}

export function boxSpecs(p) {
  return `${p.width} × ${p.length} × ${p.height} mm · ${p.grams} g`;
}
