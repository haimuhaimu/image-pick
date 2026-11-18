import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
}

function geometricPng(width, height, variant, {circleX=0.5,ink=null}={}) {
  const palette = [[206, 102, 71], [82, 128, 130], [126, 138, 96], [201, 165, 94]];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const color = ink ?? palette[variant];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const circle = Math.hypot(u - circleX, (v - 0.40) * height / width) < 0.21;
    const arch = u > 0.23 && u < 0.77 && v > 0.45 && v < 0.80;
    const triangle = v > 0.22 && v < 0.80 && Math.abs(u - 0.5) < (v - 0.22) * 0.50;
    const fill = variant === 0 ? circle : variant === 1 ? arch : variant === 2 ? triangle : circle || arch;
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const line = v > 0.87 && v < 0.875 && u > 0.12 && u < 0.88;
    const rgb = fill ? color : line ? [150, 143, 131] : [244 - Math.round(v * 8), 239 - Math.round(v * 8), 226 - Math.round(v * 8)];
    raw[offset] = rgb[0]; raw[offset + 1] = rgb[1]; raw[offset + 2] = rgb[2];
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function createOnce(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Demo destination must contain regular files');
  }
}

export async function generateDemo(directory = '.image-pick/demo') {
  const dir = resolve(directory); await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Demo directory must be a real directory');
  const definitions = [
    { id: 'circle', title: '圆 · 留白构图', size: [720, 900] },
    { id: 'arch', title: '方 · 横向节奏', size: [960, 640] },
    { id: 'triangle', title: '三角 · 视觉重心', size: [800, 800] },
    { id: 'reference', title: '参考 · 圆与方', size: [720, 900] },
  ];
  const photos = [];
  for (let i = 0; i < definitions.length; i++) {
    const { id, title, size } = definitions[i]; const file = `${id}.png`;
    await createOnce(join(dir, file), geometricPng(...size, i));
    photos.push({ id, file, title, group: i === 3 ? '参考图' : '候选图', baseline: i === 3 ? 'selected' : 'candidate',
      ...(i < 3 ? { referenceId: 'reference' } : {}), ...(i === 0 ? { focusBox: [0.25, 0.18, 0.75, 0.62] } : {}) });
  }
  const manifest = join(dir, 'album.json');
  await createOnce(manifest, `${JSON.stringify({ schemaVersion: 1, id: 'geometric-demo', revision: '1', title: '形状练习 · ImagePick Demo', photos }, null, 2)}\n`);
  return manifest;
}

export async function generateHandoffDemo(directory='.image-pick/handoff-demo') {
  const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});
  const info=await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Demo directory must be a real directory');
  const definitions=[
    {id:'current',title:'当前候选 · 位置已调回，颜色待确认',variant:0,options:{circleX:0.5,ink:[120,133,166]}},
    {id:'source',title:'来源图 · 圆偏在左侧',variant:0,options:{circleX:0.34}},
    {id:'previous',title:'上一版 · 圆向右移得太多',variant:0,options:{circleX:0.68,ink:[120,133,166]}},
    {id:'reference',title:'参考图 · 只参考暖色，不要求照抄形状',variant:3,options:{}},
  ];
  const photos=[];
  for (const definition of definitions) {
    const file=`${definition.id}.png`;
    await createOnce(join(dir,file),geometricPng(720,900,definition.variant,definition.options));
    photos.push({id:definition.id,file,title:definition.title,group:definition.id === 'current' ? '待评价' : '对照素材',baseline:'candidate',
      ...(definition.id === 'current' ? {comparisons:{source:'source',previous:'previous',reference:'reference'}} : {})});
  }
  const manifest=join(dir,'album.json');
  await createOnce(manifest,`${JSON.stringify({schemaVersion:1,id:'handoff-demo',revision:'1',title:'反馈交接演示 · 合成图片，非真实评价',photos},null,2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const generate=process.argv[2] === '--handoff' ? generateHandoffDemo : generateDemo;
  generate().then(path => process.stdout.write(`${path}\n`)).catch(error => { process.stderr.write(`Demo generation failed: ${error.code ?? error.message}\n`); process.exitCode = 1; });
}
