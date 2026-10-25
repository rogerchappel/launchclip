// The starter cast: ready-made characters with stable ids. Each is a set of
// rig params (rig.mjs); clothes default to brand roles or neutrals, so the
// same person dresses in each brand's colours. Ids never change once
// shipped: stories and style packs refer to characters by id.
//
// The mix is deliberate: a range of skin tones, builds, heights, ages, hair
// textures and dress, with glasses, hearing aids, headscarves and beards
// across it. Characters are illustrative people, not depictions of anyone.
//
// Imports only sibling kit/core files.

import {normalizeRigParams, rigFingerprint} from './rig.mjs';
import {castRoles, characterColors} from './palette.mjs';

const C = (id, name, summary, params, voice) => ({id, name, summary, params, voice});

export const STARTER_CAST = Object.freeze([
  C('maya', 'Maya', 'founder; curly hair, hoodie', {build: 'average', skin: 'brown', hair: {style: 'curly', color: 'espresso'}, outfit: {top: 'hoodie'}, colors: {top: 'primary', bottom: 'denim', shoes: 'white', accent: 'paper'}}, 'af_heart'),
  C('theo', 'Theo', 'engineer; glasses, tee', {build: 'slim', height: 'tall', skin: 'fair', hair: {style: 'short', color: 'brown'}, outfit: {top: 'tee'}, accessories: ['glasses'], colors: {top: 'accent', bottom: 'charcoal', shoes: 'black'}}, 'am_michael'),
  C('amara', 'Amara', 'designer; braids, sweater', {build: 'average', skin: 'deep', hair: {style: 'braids', color: 'black'}, outfit: {top: 'sweater'}, accessories: ['earrings'], colors: {top: 'mustard', bottom: 'charcoal', shoes: 'tan', accent: 'accent'}}, 'af_nova'),
  C('kenji', 'Kenji', 'product manager; side part, shirt', {build: 'average', skin: 'light', hair: {style: 'sidepart', color: 'black'}, outfit: {top: 'shirt'}, colors: {top: 'sky', bottom: 'navy', shoes: 'black'}}, 'am_puck'),
  C('fatima', 'Fatima', 'data analyst; headscarf, blazer', {build: 'average', skin: 'tan', hair: {style: 'headscarf', color: 'primary'}, outfit: {top: 'blazer'}, colors: {top: 'charcoal', bottom: 'charcoal', shoes: 'black', accent: 'cream'}}, 'af_sarah'),
  C('diego', 'Diego', 'sales lead; beard, blazer', {build: 'broad', skin: 'medium', hair: {style: 'short', color: 'black'}, outfit: {top: 'blazer'}, accessories: ['beard'], colors: {top: 'navy', bottom: 'navy', shoes: 'tan', accent: 'white'}}, 'am_adam'),
  C('grace', 'Grace', 'executive; silver bob, blazer', {build: 'slim', skin: 'porcelain', hair: {style: 'bob', color: 'silver'}, outfit: {top: 'blazer'}, accessories: ['round-glasses'], colors: {top: 'primary', bottom: 'charcoal', shoes: 'black', accent: 'white'}}, 'bf_emma'),
  C('kwame', 'Kwame', 'developer; buzz cut, tee', {build: 'athletic', height: 'tall', skin: 'ebony', hair: {style: 'buzz', color: 'black'}, outfit: {top: 'tee'}, accessories: ['stubble'], colors: {top: 'primary', bottom: 'denim', shoes: 'white'}}, 'am_eric'),
  C('priya', 'Priya', 'researcher; long hair, shirt', {build: 'slim', height: 'short', skin: 'tan', hair: {style: 'long', color: 'black'}, outfit: {top: 'shirt'}, accessories: ['earrings'], colors: {top: 'white', bottom: 'olive', shoes: 'tan', accent: 'accent'}}, 'af_jessica'),
  C('sam', 'Sam', 'support lead; pixie cut, sweater', {build: 'round', height: 'short', skin: 'fair', hair: {style: 'pixie', color: 'copper'}, outfit: {top: 'sweater'}, accessories: ['freckles'], colors: {top: 'teal', bottom: 'charcoal', shoes: 'black'}}, 'af_river'),
  C('omar', 'Omar', 'operations; moustache, shirt', {build: 'round', skin: 'brown', hair: {style: 'short', color: 'grey'}, outfit: {top: 'shirt'}, accessories: ['moustache', 'glasses'], colors: {top: 'cream', bottom: 'stone', shoes: 'tan'}}, 'bm_george'),
  C('lena', 'Lena', 'marketer; ponytail, tee', {build: 'athletic', skin: 'light', hair: {style: 'ponytail', color: 'blonde'}, outfit: {top: 'tee'}, colors: {top: 'accent', bottom: 'denim', shoes: 'white'}}, 'af_bella'),
  C('jamal', 'Jamal', 'founder; afro, hoodie', {build: 'average', skin: 'deep', hair: {style: 'afro', color: 'black'}, outfit: {top: 'hoodie'}, accessories: ['beard'], colors: {top: 'charcoal', bottom: 'black', shoes: 'white', accent: 'accent'}}, 'am_fenrir'),
  C('mei', 'Mei', 'student; bun, sweater', {build: 'slim', height: 'short', skin: 'porcelain', hair: {style: 'bun', color: 'black'}, outfit: {top: 'sweater'}, accessories: ['round-glasses'], colors: {top: 'rose', bottom: 'navy', shoes: 'white'}}, 'af_sky'),
  C('rafael', 'Rafael', 'freelancer; wavy hair, shirt', {build: 'slim', skin: 'medium', hair: {style: 'wavy', color: 'chestnut'}, outfit: {top: 'shirt'}, accessories: ['stubble'], colors: {top: 'forest', bottom: 'sand', shoes: 'brick'}}, 'am_liam'),
  C('ruth', 'Ruth', 'retired teacher; white hair, sweater', {build: 'round', height: 'short', skin: 'fair', hair: {style: 'curly', color: 'silver'}, outfit: {top: 'sweater'}, accessories: ['glasses', 'hearing-aid'], colors: {top: 'plum', bottom: 'stone', shoes: 'tan', accent: 'accent'}}, 'bf_alice'),
  C('nia', 'Nia', 'shop owner; locs, dress', {build: 'average', height: 'tall', skin: 'brown', hair: {style: 'locs', color: 'espresso'}, outfit: {top: 'dress'}, accessories: ['earrings'], colors: {top: 'primary', bottom: 'charcoal', shoes: 'black', accent: 'mustard'}}, 'af_kore'),
  C('arjun', 'Arjun', 'IT admin; short hair, lanyard', {build: 'broad', skin: 'tan', hair: {style: 'short', color: 'black'}, outfit: {top: 'tee'}, accessories: ['lanyard', 'beard'], colors: {top: 'slate', bottom: 'charcoal', shoes: 'black', accent: 'primary'}}, 'am_onyx'),
  C('sofia', 'Sofia', 'lawyer; long hair, blazer', {build: 'average', skin: 'light', hair: {style: 'long', color: 'auburn'}, outfit: {top: 'blazer'}, accessories: ['earrings'], colors: {top: 'charcoal', bottom: 'charcoal', shoes: 'black', accent: 'white'}}, 'bf_isabella'),
  C('tomas', 'Tomás', 'barista; bald, beard, tee', {build: 'athletic', skin: 'medium', hair: {style: 'bald', color: 'espresso'}, outfit: {top: 'tee'}, accessories: ['beard'], colors: {top: 'olive', bottom: 'denim', shoes: 'brick'}}, 'am_santa'),
  C('hana', 'Hana', 'nurse; bob, sweater', {build: 'average', height: 'short', skin: 'light', hair: {style: 'bob', color: 'black'}, outfit: {top: 'sweater'}, accessories: ['hearing-aid'], colors: {top: 'sky', bottom: 'navy', shoes: 'white', accent: 'accent'}}, 'af_aoede'),
  C('ade', 'Ade', 'accountant; buzz cut, shirt', {build: 'round', skin: 'ebony', hair: {style: 'buzz', color: 'grey'}, outfit: {top: 'shirt'}, accessories: ['round-glasses', 'stubble'], colors: {top: 'white', bottom: 'charcoal', shoes: 'black'}}, 'bm_daniel'),
  C('zara', 'Zara', 'creator; wavy hair, tee', {build: 'slim', skin: 'deep', hair: {style: 'wavy', color: 'black'}, outfit: {top: 'tee'}, accessories: ['earrings'], colors: {top: 'primary', bottom: 'black', shoes: 'white', accent: 'mustard'}}, 'af_nicole'),
  C('noor', 'Noor', 'engineer; headscarf, hoodie', {build: 'slim', height: 'tall', skin: 'medium', hair: {style: 'headscarf', color: 'plum'}, outfit: {top: 'hoodie'}, accessories: ['glasses'], colors: {top: 'slate', bottom: 'charcoal', shoes: 'white', accent: 'accent'}}, 'af_alloy')
]);

const BY_ID = new Map(STARTER_CAST.map(entry => [entry.id, entry]));
export const STARTER_IDS = Object.freeze(STARTER_CAST.map(entry => entry.id));

/** A starter character by id, with normalised params, or null. */
export function starterCharacter(id) {
  const entry = BY_ID.get(id);
  return entry ? {...entry, params: normalizeRigParams(entry.params, `cast ${id}`)} : null;
}

/**
 * Everything needed to draw one character in a story: normalised params,
 * the drawing style, the resolved colours and the identity fingerprint.
 */
export function characterLook(params, {style = 'flat', brand = null, mapping = null} = {}) {
  const roles = castRoles(brand, mapping);
  const colors = characterColors(params.colors, roles);
  return {params, style, colors, fingerprint: rigFingerprint(params, style), look: JSON.stringify({style, params, colors})};
}
