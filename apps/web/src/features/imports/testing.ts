/** Test-only XLSX builders. */
import { crc32, deflateRawSync } from 'node:zlib';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** A deflated zip of the given parts, enough for `readXlsx`. */
function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** A workbook whose first sheet has `rows` one-cell rows, padded with `padding` spaces per part. */
export function workbook(rows: string[], padding = 0): Uint8Array<ArrayBuffer> {
  const pad = ' '.repeat(padding);
  return zip({
    'xl/workbook.xml': `<workbook xmlns="${NS}"><sheets><sheet name="S"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${NS}">${pad}<sheetData>${rows.join('')}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<sst xmlns="${NS}">${pad}</sst>`,
    'xl/styles.xml': `<styleSheet xmlns="${NS}">${pad}</styleSheet>`,
  });
}
