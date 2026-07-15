import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function analyzePng(buffer, options = {}) {
  const decoded = decodePng(buffer);
  const maximumSamples = positiveInteger(options.maximumSamples, 120_000);
  const stride = Math.max(1, Math.floor(Math.sqrt((decoded.width * decoded.height) / maximumSamples)));
  const colors = new Map();
  let samples = 0;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let edgeComparisons = 0;
  let edges = 0;
  let minimumLuma = 255;
  let maximumLuma = 0;

  for (let y = 0; y < decoded.height; y += stride) {
    let previous = null;
    for (let x = 0; x < decoded.width; x += stride) {
      const offset = (y * decoded.width + x) * 4;
      const alpha = decoded.pixels[offset + 3] / 255;
      const red = composite(decoded.pixels[offset], alpha);
      const green = composite(decoded.pixels[offset + 1], alpha);
      const blue = composite(decoded.pixels[offset + 2], alpha);
      const luma = red * .2126 + green * .7152 + blue * .0722;
      const quantized = `${red >> 3}:${green >> 3}:${blue >> 3}`;
      colors.set(quantized, (colors.get(quantized) ?? 0) + 1);
      samples += 1;
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      minimumLuma = Math.min(minimumLuma, luma);
      maximumLuma = Math.max(maximumLuma, luma);
      if (previous) {
        edgeComparisons += 1;
        if (Math.max(Math.abs(red - previous[0]), Math.abs(green - previous[1]), Math.abs(blue - previous[2])) >= 20) edges += 1;
      }
      previous = [red, green, blue];
    }
  }

  const mean = samples ? lumaSum / samples : 0;
  const variance = samples ? Math.max(0, lumaSquaredSum / samples - mean * mean) : 0;
  const dominantSamples = Math.max(0, ...colors.values());
  const foregroundRatio = samples ? 1 - dominantSamples / samples : 0;
  const edgeRatio = edgeComparisons ? edges / edgeComparisons : 0;
  const lumaRange = maximumLuma - minimumLuma;
  const lumaStandardDeviation = Math.sqrt(variance);
  const blank = foregroundRatio < Number(options.minimumForegroundRatio ?? .0005)
    && lumaRange < Number(options.minimumLumaRange ?? 8)
    && lumaStandardDeviation < Number(options.minimumLumaStandardDeviation ?? 1)
    && edgeRatio < Number(options.minimumEdgeRatio ?? .0002);

  return {
    width: decoded.width,
    height: decoded.height,
    samples,
    quantized_colors: colors.size,
    foreground_ratio: rounded(foregroundRatio),
    edge_ratio: rounded(edgeRatio),
    luma_range: rounded(lumaRange),
    luma_standard_deviation: rounded(lumaStandardDeviation),
    blank
  };
}

function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Visual snapshot must be a PNG image");
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error("Visual snapshot contains a truncated PNG chunk");
    const data = buffer.subarray(start, end);
    if (type === "IHDR") header = parseHeader(data);
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (!header || !imageData.length) throw new Error("Visual snapshot PNG is missing image data");
  const channels = channelsFor(header.colorType);
  const bytesPerPixel = header.colorType === 3 ? 1 : channels;
  const rowBytes = header.width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(imageData));
  const expected = (rowBytes + 1) * header.height;
  if (raw.length !== expected) throw new Error(`Visual snapshot PNG has ${raw.length} decoded bytes; expected ${expected}`);
  const scanlines = Buffer.alloc(rowBytes * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const rawOffset = y * (rowBytes + 1);
    const outputOffset = y * rowBytes;
    unfilterRow(raw[rawOffset], raw.subarray(rawOffset + 1, rawOffset + 1 + rowBytes), scanlines, outputOffset, rowBytes, bytesPerPixel);
  }
  return { ...header, pixels: rgbaPixels(scanlines, header, palette, transparency) };
}

function parseHeader(data) {
  if (data.length !== 13) throw new Error("Visual snapshot PNG has an invalid header");
  const header = {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colorType: data[9],
    compression: data[10],
    filter: data[11],
    interlace: data[12]
  };
  if (!header.width || !header.height) throw new Error("Visual snapshot PNG must have positive dimensions");
  if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) throw new Error("Visual snapshot PNG uses an unsupported encoding");
  channelsFor(header.colorType);
  return header;
}

function channelsFor(colorType) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Visual snapshot PNG uses unsupported color type ${colorType}`);
  return channels;
}

function unfilterRow(filter, source, output, outputOffset, rowBytes, bytesPerPixel) {
  for (let x = 0; x < rowBytes; x += 1) {
    const left = x >= bytesPerPixel ? output[outputOffset + x - bytesPerPixel] : 0;
    const above = outputOffset >= rowBytes ? output[outputOffset - rowBytes + x] : 0;
    const upperLeft = outputOffset >= rowBytes && x >= bytesPerPixel ? output[outputOffset - rowBytes + x - bytesPerPixel] : 0;
    const prediction = filter === 0 ? 0
      : filter === 1 ? left
        : filter === 2 ? above
          : filter === 3 ? Math.floor((left + above) / 2)
            : filter === 4 ? paeth(left, above, upperLeft)
              : null;
    if (prediction === null) throw new Error(`Visual snapshot PNG uses unsupported row filter ${filter}`);
    output[outputOffset + x] = (source[x] + prediction) & 0xff;
  }
}

function rgbaPixels(scanlines, header, palette, transparency) {
  const output = Buffer.alloc(header.width * header.height * 4);
  let source = 0;
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const target = pixel * 4;
    if (header.colorType === 0) {
      output[target] = output[target + 1] = output[target + 2] = scanlines[source++];
      output[target + 3] = 255;
    } else if (header.colorType === 2) {
      output[target] = scanlines[source++]; output[target + 1] = scanlines[source++]; output[target + 2] = scanlines[source++]; output[target + 3] = 255;
    } else if (header.colorType === 3) {
      const index = scanlines[source++];
      if (!palette || index * 3 + 2 >= palette.length) throw new Error("Visual snapshot PNG references a missing palette color");
      output[target] = palette[index * 3]; output[target + 1] = palette[index * 3 + 1]; output[target + 2] = palette[index * 3 + 2]; output[target + 3] = transparency?.[index] ?? 255;
    } else if (header.colorType === 4) {
      output[target] = output[target + 1] = output[target + 2] = scanlines[source++]; output[target + 3] = scanlines[source++];
    } else {
      output[target] = scanlines[source++]; output[target + 1] = scanlines[source++]; output[target + 2] = scanlines[source++]; output[target + 3] = scanlines[source++];
    }
  }
  return output;
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function composite(channel, alpha) {
  return Math.round(channel * alpha + 255 * (1 - alpha));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function rounded(value) {
  return Number(value.toFixed(6));
}
