// A minimal PDF writer for carousel documents (LinkedIn takes a PDF): one page
// per slide, each page one JPEG (DCTDecode) filling it. No dependency.

/**
 * pages: [{jpeg: Buffer, width, height}] (pixels; the page is width × height
 * points, so it keeps the slide's aspect). RGB JPEGs only. Returns the PDF.
 */
export function writePdf(pages) {
  if (!pages.length) throw new Error("a PDF needs at least one page");
  // Objects: 1 catalog, 2 page tree, then per page: page, content stream, image.
  const objects = [];
  const pageIds = pages.map((_, i) => 3 + i * 3);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach(({ jpeg, width, height }, i) => {
    if (!(width > 0 && height > 0)) throw new Error(`page ${i + 1} needs a width and height`);
    const [page, content, image] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const draw = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`;
    objects[content] = [`<< /Length ${draw.length} >>\nstream\n`, draw, "\nendstream"];
    objects[image] = [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"];
  });

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let length = chunks[0].length;
  const push = (part) => { const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part, "latin1"); chunks.push(buffer); length += buffer.length; };
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const part of [objects[id]].flat()) push(part);
    push("\nendobj\n");
  }
  const xref = length;
  push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < objects.length; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks, length);
}
