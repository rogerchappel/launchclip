// The frame tells' sampling (src/frame_tells.js): which frames, rects and
// plates it reads, with the decoders faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dimmedPlates, measureFrameTells} from '../src/frame_tells.js';

const flat = (width, height) => ({width, height, pixels: new Uint8Array(width * height * 4).fill(30)});
// A grey checkerboard with a step of 100: detailed as it is, gone under a 0.9 dim (the edge step needs 240).
const checker = async () => ({width: 20, height: 20, frames: Buffer.from(Array.from({length: 400}, (_, i) => ((i % 20) + Math.floor(i / 20)) % 2 ? 130 : 30))});
const story = (dim) => ({
  format: {width: 1080, height: 1920},
  brand: {colors: {bg: '#191714', accent: '#ffb08a'}},
  plate: {kind: 'image', params: {src: 'assets/photo.jpg', dim}},
  scenes: [{id: 's1', start: 0, end: 4, track: 0}, {id: 's2', start: 4, end: 8, track: 1}]
});

test('dimmedPlates: image and video plates over the dim threshold, from the story, chapters and scenes', () => {
  const plates = dimmedPlates({plate: {kind: 'image', params: {src: 'a.jpg', dim: 0.9}}, scenes: [{id: 's1', start: 2, backdrop: {kind: 'video', params: {src: 'b.mp4', dim: 0.95}}}, {id: 's2', plate: {kind: 'image', params: {src: 'c.jpg', dim: 0.5}}}]});
  assert.deepEqual(plates.map(p => [p.id, p.path, p.at]), [['plate', 'plate', 0], ['s1', 'scenes[0].backdrop', 2]]);
});

test('measureFrameTells: a detailed photo under a 0.9 dim is buried; at 0.5 it is not read at all', async () => {
  const seen = [];
  const frame = async (video, t, size) => { seen.push([t, size.width]); return flat(size.width, size.height); };
  const rects = [{id: 'base', role: 'media', rect: {x: 0, y: 0, width: 1080, height: 1920}, start: 0, end: 8}, {id: 's1', role: 'text', rect: {x: 0, y: 0, width: 10, height: 10}, start: 0, end: 4}];
  const buried = await measureFrameTells('/p', 'v.mp4', story(0.9), {rects, frame, decode: checker});
  assert.deepEqual(buried.map(f => f.rule), ['buried-raster']);
  assert.deepEqual(seen, [[2, 270]], 'one quarter-size frame for the one main-track scene; no media window to read');
  assert.deepEqual(await measureFrameTells('/p', 'v.mp4', story(0.5), {rects, frame, decode: checker}), []);
});

test('measureFrameTells: a media window is read at full size at the middle of its time', async () => {
  const seen = [];
  const frame = async (video, t, size) => { seen.push([t, size.width]); return flat(size.width, size.height); };
  await measureFrameTells('/p', 'v.mp4', {...story(0), plate: undefined}, {rects: [{id: 's1-win', role: 'media', rect: {x: 100, y: 100, width: 400, height: 300}, start: 1, end: 3}], frame, decode: checker});
  assert.deepEqual(seen, [[2, 270], [2, 1080]]);
});
