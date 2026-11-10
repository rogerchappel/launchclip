// The starter cast: ready-made characters with stable ids. Each is a set of
// rig params (rig.mjs); clothes default to brand roles or neutrals, so the
// same person dresses in each brand's colours. Ids never change once
// shipped: stories and style packs refer to characters by id.
//
// The mix is deliberate: a range of skin tones (white people among them),
// builds, heights, ages (children and a teen too), hair textures and dress,
// with glasses, hearing aids, headscarves and beards across it.
// Characters are illustrative people, not depictions of anyone.
//
// After the people come animals, mascots and objects with faces (kinds.mjs):
// original designs, none a known character or mascot.
//
// Imports only sibling kit/core files.

import {normalizeRigParams, rigFingerprint} from './rig.mjs';
import {castRoles, characterColors} from './palette.mjs';
import {isKind, kindColors} from './kinds.mjs';

const C = (id, name, summary, params, voice) => ({id, name, summary, params, voice});

export const STARTER_CAST = Object.freeze([
  C('maya', 'Maya', 'founder; curly hair, hoodie', {build: 'average', skin: 'brown', hair: {style: 'curly', color: 'espresso'}, outfit: {top: 'hoodie'}, colors: {top: 'primary', bottom: 'denim', shoes: 'white', accent: 'paper'}}, 'af_heart'),
  C('theo', 'Theo', 'engineer; glasses, tee', {build: 'slim', height: 'tall', skin: 'fair', hair: {style: 'short', color: 'brown'}, outfit: {top: 'tee'}, accessories: ['glasses'], colors: {top: 'accent', bottom: 'charcoal', shoes: 'black'}}, 'am_michael'),
  C('amara', 'Amara', 'designer; braids, sweater', {build: 'average', skin: 'deep', hair: {style: 'braids', color: 'black'}, outfit: {top: 'sweater'}, accessories: ['earrings'], colors: {top: 'mustard', bottom: 'charcoal', shoes: 'tan', accent: 'accent'}}, 'af_nova'),
  C('kenji', 'Kenji', 'product manager; side part, shirt', {build: 'average', skin: 'light', hair: {style: 'sidepart', color: 'black'}, outfit: {top: 'shirt'}, colors: {top: 'sky', bottom: 'navy', shoes: 'black'}}, 'am_puck'),
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
  C('noor', 'Noor', 'engineer; headscarf, hoodie', {build: 'slim', height: 'tall', skin: 'medium', hair: {style: 'headscarf', color: 'plum'}, outfit: {top: 'hoodie'}, accessories: ['glasses'], colors: {top: 'slate', bottom: 'charcoal', shoes: 'white', accent: 'accent'}}, 'af_alloy'),
  C('oliver', 'Oliver', 'designer; fair, quiff, stubble, jacket', {build: 'athletic', height: 'tall', skin: 'fair', hair: {style: 'quiff', color: 'blonde'}, outfit: {top: 'jacket'}, accessories: ['stubble'], colors: {top: 'navy', bottom: 'denim', shoes: 'tan', accent: 'white'}}, 'bm_lewis'),
  C('hannah', 'Hannah', 'teacher; rosy skin, ponytail, cardigan', {build: 'curvy', skin: 'rosy', hair: {style: 'ponytail', color: 'strawberry'}, outfit: {top: 'cardigan'}, accessories: ['freckles', 'earrings'], colors: {top: 'sage', bottom: 'charcoal', shoes: 'brick', accent: 'cream'}}, 'bf_lily'),
  C('ben', 'Ben', 'child; light skin, short brown hair, tee', {build: 'average', age: 'child', skin: 'light', hair: {style: 'short', color: 'chestnut'}, outfit: {top: 'tee', bottom: 'shorts'}, colors: {top: 'primary', bottom: 'denim', shoes: 'white'}}, 'am_puck'),
  C('lily', 'Lily', 'child; fair skin, pigtails, dress', {build: 'slim', age: 'child', skin: 'porcelain', hair: {style: 'pigtails', color: 'blonde'}, outfit: {top: 'dress'}, colors: {top: 'coral', bottom: 'white', shoes: 'navy', accent: 'accent'}}, 'af_sky'),
  C('kofi', 'Kofi', 'child; deep skin, twists, hoodie', {build: 'round', age: 'child', skin: 'deep', hair: {style: 'twists', color: 'black'}, outfit: {top: 'hoodie'}, accessories: ['backpack'], colors: {top: 'mustard', bottom: 'charcoal', shoes: 'white', accent: 'accent'}}, 'am_echo'),
  C('max', 'Max', 'student; teen, undercut, headphones, hoodie', {build: 'slim', age: 'teen', skin: 'ivory', hair: {style: 'undercut', color: 'brown'}, outfit: {top: 'hoodie'}, headwear: 'headphones', colors: {top: 'charcoal', bottom: 'black', shoes: 'white', accent: 'primary'}}, 'am_liam'),
  // The wider cast: a personality each, simply dressed (one accessory at most), so casts differ from video to video.
  C('juno', 'Juno', 'bubbly intern; space buns, tee, freckles', {build: 'petite', height: 'short', skin: 'rosy', hair: {style: 'space-buns', color: 'pink-dye'}, outfit: {top: 'tee', bottom: 'skirt'}, accessories: ['freckles'], colors: {top: 'accent', bottom: 'charcoal', shoes: 'white'}}, 'af_sky'),
  C('milo', 'Milo', 'sleepy night-owl developer; spiky hair, hoodie, headphones', {build: 'slim', skin: 'beige', hair: {style: 'spiky', color: 'jet'}, outfit: {top: 'hoodie'}, headwear: 'headphones', colors: {top: 'indigo', bottom: 'black', shoes: 'white', accent: 'mint'}}, 'am_puck'),
  C('pippa', 'Pippa', 'cheerful baker; bun, shirt, freckles', {build: 'round', height: 'short', skin: 'fair', hair: {style: 'bun', color: 'honey'}, outfit: {top: 'shirt', over: 'apron'}, accessories: ['freckles'], colors: {top: 'cream', bottom: 'denim', shoes: 'brick', accent: 'coral'}}, 'bf_lily'),
  C('otis', 'Otis', 'gentle giant; bald, sweater, long beard', {build: 'broad', height: 'very-tall', skin: 'umber', hair: {style: 'bald', color: 'black'}, outfit: {top: 'sweater'}, accessories: ['long-beard'], colors: {top: 'forest', bottom: 'khaki', shoes: 'tan'}}, 'am_onyx'),
  C('wren', 'Wren', 'quiet bookworm; shoulder hair, cardigan, round glasses', {build: 'slim', skin: 'ivory', hair: {style: 'shoulder', color: 'ash'}, outfit: {top: 'cardigan', bottom: 'long-skirt'}, accessories: ['round-glasses'], colors: {top: 'sage', bottom: 'plum', shoes: 'tan', accent: 'cream'}}, 'af_river'),
  C('gus', 'Gus', 'grumpy but kind handyman; balding, polo, moustache', {build: 'stocky', skin: 'light', hair: {style: 'balding', color: 'grey'}, outfit: {top: 'polo', over: 'hi-vis'}, accessories: ['moustache'], colors: {top: 'slate', bottom: 'charcoal', shoes: 'black', accent: 'lemon'}}, 'bm_george'),
  C('ivy', 'Ivy', 'plant-loving optimist; pixie, tank, necklace', {build: 'average', skin: 'ivory', hair: {style: 'pixie', color: 'green-dye'}, outfit: {top: 'tank'}, accessories: ['necklace'], colors: {top: 'mint', bottom: 'olive', shoes: 'tan', accent: 'ochre'}}, 'af_nova'),
  C('bex', 'Bex', 'fearless skater; mohawk, jersey, watch', {build: 'athletic', skin: 'golden', hair: {style: 'mohawk', color: 'violet-dye'}, outfit: {top: 'jersey', bottom: 'shorts'}, accessories: ['watch'], colors: {top: 'tangerine', bottom: 'black', shoes: 'white', accent: 'white'}}, 'af_jessica'),
  C('remy', 'Remy', 'perfectionist chef; quiff, chef coat, goatee', {build: 'average', skin: 'light', hair: {style: 'quiff', color: 'espresso'}, outfit: {top: 'chef-coat'}, accessories: ['goatee'], colors: {top: 'white', bottom: 'charcoal', shoes: 'black', accent: 'red'}}, 'am_fenrir'),
  C('suki', 'Suki', 'calm problem-solver; bob, turtleneck, earrings', {build: 'petite', skin: 'porcelain', hair: {style: 'bob', color: 'jet'}, outfit: {top: 'turtleneck'}, accessories: ['earrings'], colors: {top: 'black', bottom: 'stone', shoes: 'black', accent: 'accent'}}, 'af_kore'),
  C('tavi', 'Tavi', 'restless inventor; curly hair, lab coat, glasses', {build: 'slim', height: 'tall', skin: 'bronze', hair: {style: 'curly', color: 'black'}, outfit: {top: 'lab-coat'}, accessories: ['glasses'], colors: {top: 'white', bottom: 'navy', shoes: 'tan', accent: 'primary'}}, 'am_echo'),
  C('nell', 'Nell', 'no-nonsense grandmother; senior, bun, coat, cat eye glasses, cane', {build: 'petite', height: 'very-short', age: 'senior', skin: 'fair', hair: {style: 'bun', color: 'snow'}, outfit: {top: 'coat'}, accessories: ['cat-eye-glasses'], mobility: 'cane', colors: {top: 'burgundy', bottom: 'charcoal', shoes: 'black', accent: 'lavender'}}, 'bf_alice'),
  C('rory', 'Rory', 'class clown; teen, curly hair, jersey, freckles', {build: 'average', age: 'teen', skin: 'ivory', hair: {style: 'curly', color: 'copper'}, outfit: {top: 'jersey', bottom: 'shorts'}, accessories: ['freckles'], colors: {top: 'red', bottom: 'navy', shoes: 'white', accent: 'white'}}, 'am_liam'),
  C('fern', 'Fern', 'curious kid scientist; child, twists, tee, round glasses', {build: 'slim', age: 'child', skin: 'mahogany', hair: {style: 'twists', color: 'black'}, outfit: {top: 'tee', bottom: 'leggings'}, accessories: ['round-glasses'], colors: {top: 'lemon', bottom: 'teal', shoes: 'white', accent: 'coral'}}, 'af_sky'),
  C('zeke', 'Zeke', 'laid-back surfer; long hair, tank, sunglasses', {build: 'athletic', height: 'tall', skin: 'fair', hair: {style: 'long', color: 'blonde'}, outfit: {top: 'tank', bottom: 'shorts'}, accessories: ['sunglasses'], colors: {top: 'ceil', bottom: 'sand', shoes: 'tan'}}, 'am_santa'),
  C('posy', 'Posy', 'shy artist; pigtails, sweater, beret', {build: 'curvy', height: 'short', skin: 'beige', hair: {style: 'pigtails', color: 'auburn'}, outfit: {top: 'sweater', bottom: 'skirt'}, headwear: 'beret', colors: {top: 'lavender', bottom: 'indigo', shoes: 'burgundy', accent: 'cream'}}, 'af_aoede'),
  C('bram', 'Bram', 'earnest park ranger; short hair, shirt, stubble, bucket hat', {build: 'broad', skin: 'light', hair: {style: 'short', color: 'brown'}, outfit: {top: 'shirt', over: 'vest', bottom: 'shorts'}, accessories: ['stubble'], headwear: 'bucket-hat', colors: {top: 'khaki', bottom: 'olive', shoes: 'tan', accent: 'forest'}}, 'bm_daniel'),
  C('indi', 'Indi', 'high-energy fitness coach; cornrows, tank, watch, headband', {build: 'athletic', skin: 'deep', hair: {style: 'cornrows', color: 'black'}, outfit: {top: 'tank', bottom: 'leggings'}, headwear: 'headband', accessories: ['watch'], colors: {top: 'coral', bottom: 'black', shoes: 'white', accent: 'lemon'}}, 'af_bella'),
  C('coco', 'Coco', 'dramatic fashion lover; afro, dress, cat eye glasses', {build: 'curvy', skin: 'umber', hair: {style: 'afro', color: 'espresso'}, outfit: {top: 'dress'}, accessories: ['cat-eye-glasses'], colors: {top: 'rose', bottom: 'rose', shoes: 'burgundy', accent: 'mustard'}}, 'bf_isabella'),
  C('hugo', 'Hugo', 'anxious overthinker; sidepart, cardigan, bowtie', {build: 'slim', skin: 'light', hair: {style: 'sidepart', color: 'chestnut'}, outfit: {top: 'cardigan'}, accessories: ['bowtie'], colors: {top: 'ochre', bottom: 'navy', shoes: 'tan', accent: 'burgundy'}}, 'bm_fable'),
  C('etta', 'Etta', 'wise mentor; senior, locs, kurta, necklace', {build: 'average', age: 'senior', skin: 'deep', hair: {style: 'locs', color: 'silver'}, outfit: {top: 'kurta'}, accessories: ['necklace'], colors: {top: 'teal', bottom: 'cream', shoes: 'tan', accent: 'ochre'}}, 'bf_emma'),
  C('ned', 'Ned', 'awkward new hire; undercut, polo, lanyard', {build: 'average', height: 'tall', skin: 'rosy', hair: {style: 'undercut', color: 'strawberry'}, outfit: {top: 'polo'}, accessories: ['lanyard'], colors: {top: 'sky', bottom: 'khaki', shoes: 'white', accent: 'primary'}}, 'am_michael'),
  C('opal', 'Opal', 'unflappable nurse; ponytail, scrubs, stethoscope', {build: 'round', skin: 'bronze', hair: {style: 'ponytail', color: 'espresso'}, outfit: {top: 'scrubs'}, accessories: ['stethoscope'], colors: {top: 'ceil', bottom: 'ceil', shoes: 'white', accent: 'navy'}}, 'af_sarah'),
  C('percy', 'Percy', 'fussy professor; senior, balding, blazer, sideburns', {build: 'round', height: 'short', age: 'senior', skin: 'porcelain', hair: {style: 'balding', color: 'snow'}, outfit: {top: 'blazer'}, accessories: ['sideburns'], colors: {top: 'khaki', bottom: 'charcoal', shoes: 'burgundy', accent: 'forest'}}, 'bm_lewis'),
  C('rufus', 'Rufus', 'loud best friend; quiff, jacket, beard', {build: 'stocky', skin: 'fair', hair: {style: 'quiff', color: 'copper'}, outfit: {top: 'jacket'}, accessories: ['beard'], colors: {top: 'brick', bottom: 'denim', shoes: 'black', accent: 'cream'}}, 'am_adam'),
  C('tilly', 'Tilly', 'tiny tornado; child, space buns, dress', {build: 'average', age: 'child', skin: 'almond', hair: {style: 'space-buns', color: 'black'}, outfit: {top: 'dress'}, colors: {top: 'tangerine', bottom: 'white', shoes: 'red', accent: 'lemon'}}, 'af_heart'),
  C('ugo', 'Ugo', 'big-hearted delivery rider; buzz, jacket, crossbody bag, bike helmet', {build: 'athletic', skin: 'ebony', hair: {style: 'buzz', color: 'black'}, outfit: {top: 'jacket'}, headwear: 'bike-helmet', accessories: ['crossbody-bag'], colors: {top: 'lemon', bottom: 'black', shoes: 'black', accent: 'primary'}}, 'am_eric'),
  C('vera', 'Vera', 'sharp-witted editor; senior, bob, turtleneck, glasses, wheelchair', {build: 'slim', age: 'senior', skin: 'light', hair: {style: 'bob', color: 'grey'}, outfit: {top: 'turtleneck'}, accessories: ['glasses'], mobility: 'wheelchair', colors: {top: 'burgundy', bottom: 'black', shoes: 'black', accent: 'accent'}}, 'bf_emma'),
  C('wally', 'Wally', 'daydreaming gardener; curly hair, tee, stubble, sunhat', {build: 'round', skin: 'rosy', hair: {style: 'curly', color: 'brown'}, outfit: {top: 'tee', over: 'apron'}, headwear: 'sunhat', accessories: ['stubble'], colors: {top: 'sage', bottom: 'khaki', shoes: 'brick', accent: 'forest'}}, 'bm_george'),
  C('yuki', 'Yuki', 'determined student; teen, topknot, hoodie, backpack', {build: 'petite', age: 'teen', skin: 'porcelain', hair: {style: 'topknot', color: 'jet'}, outfit: {top: 'hoodie', bottom: 'skirt'}, accessories: ['backpack'], colors: {top: 'lavender', bottom: 'charcoal', shoes: 'white', accent: 'accent'}}, 'af_nicole'),
  C('ziggy', 'Ziggy', 'chaotic creative; spiky hair, tee, nose stud', {build: 'slim', height: 'tall', skin: 'bronze', hair: {style: 'spiky', color: 'blue-dye'}, outfit: {top: 'tee'}, accessories: ['nose-stud'], colors: {top: 'black', bottom: 'burgundy', shoes: 'white', accent: 'lemon'}}, 'am_puck'),
  C('arlo', 'Arlo', 'thoughtful dad; wavy hair, cardigan, stubble', {build: 'average', skin: 'fair', hair: {style: 'wavy', color: 'espresso'}, outfit: {top: 'cardigan'}, accessories: ['stubble'], colors: {top: 'slate', bottom: 'khaki', shoes: 'tan', accent: 'cream'}}, 'am_michael'),
  C('birdie', 'Birdie', 'gossipy neighbour; senior, curly hair, dress, cat eye glasses', {build: 'curvy', height: 'short', age: 'senior', skin: 'rosy', hair: {style: 'curly', color: 'platinum'}, outfit: {top: 'dress', bottom: 'long-skirt'}, accessories: ['cat-eye-glasses'], colors: {top: 'mint', bottom: 'mint', shoes: 'cream', accent: 'coral'}}, 'bf_alice'),
  C('chip', 'Chip', 'eager little helper; child, buzz, tee, cap', {build: 'stocky', age: 'child', skin: 'umber', hair: {style: 'buzz', color: 'black'}, outfit: {top: 'tee', bottom: 'shorts'}, headwear: 'cap', colors: {top: 'sky', bottom: 'tangerine', shoes: 'white', accent: 'red'}}, 'am_echo'),
  C('enzo', 'Enzo', 'smooth-talking salesman; quiff, blazer, tie', {build: 'average', skin: 'beige', hair: {style: 'quiff', color: 'chestnut'}, outfit: {top: 'blazer'}, accessories: ['tie'], colors: {top: 'indigo', bottom: 'indigo', shoes: 'tan', accent: 'red'}}, 'am_fenrir'),
  C('flo', 'Flo', 'tireless organiser; braids, shirt, lanyard', {build: 'athletic', height: 'tall', skin: 'mahogany', hair: {style: 'braids', color: 'black'}, outfit: {top: 'shirt', over: 'vest'}, accessories: ['lanyard'], colors: {top: 'white', bottom: 'navy', shoes: 'black', accent: 'primary'}}, 'af_nova'),
  C('goldie', 'Goldie', 'sunny optimist; long hair, dress', {build: 'average', skin: 'beige', hair: {style: 'long', color: 'honey'}, outfit: {top: 'dress'}, colors: {top: 'lemon', bottom: 'lemon', shoes: 'tan', accent: 'coral'}}, 'af_heart'),
  C('hal', 'Hal', 'steady builder; short hair, tee, stubble, hard hat, prosthetic arm', {build: 'broad', skin: 'brown', hair: {style: 'short', color: 'black'}, outfit: {top: 'tee', over: 'hi-vis'}, headwear: 'hard-hat', accessories: ['stubble'], mobility: 'prosthetic-arm', colors: {top: 'stone', bottom: 'denim', shoes: 'tan', accent: 'tangerine'}}, 'am_adam'),
  C('mabel', 'Mabel', 'competitive gamer; pigtails, hoodie, glasses, headphones', {build: 'round', skin: 'light', hair: {style: 'pigtails', color: 'pink-dye'}, outfit: {top: 'hoodie'}, headwear: 'headphones', accessories: ['glasses'], colors: {top: 'black', bottom: 'charcoal', shoes: 'white', accent: 'accent'}}, 'af_jessica'),
  C('dulcie', 'Dulcie', 'soft-spoken vet; shoulder hair, scrubs, watch', {build: 'petite', skin: 'fair', hair: {style: 'shoulder', color: 'chestnut'}, outfit: {top: 'scrubs'}, accessories: ['watch'], colors: {top: 'sage', bottom: 'sage', shoes: 'white', accent: 'teal'}}, 'bf_lily'),
  C('xena', 'Xena', 'bold explorer; braids, jacket, crossbody bag, prosthetic leg', {build: 'athletic', height: 'tall', skin: 'bronze', hair: {style: 'braids', color: 'espresso'}, outfit: {top: 'jacket', bottom: 'shorts'}, accessories: ['crossbody-bag'], mobility: 'prosthetic-leg', colors: {top: 'olive', bottom: 'khaki', shoes: 'tan', accent: 'ochre'}}, 'af_kore'),
  C('jools', 'Jools', 'dry-humoured barista; undercut, tee, nose stud', {build: 'average', skin: 'ivory', hair: {style: 'undercut', color: 'violet-dye'}, outfit: {top: 'tee', over: 'apron'}, accessories: ['nose-stud'], colors: {top: 'charcoal', bottom: 'black', shoes: 'black', accent: 'ochre'}}, 'af_alloy'),

  // Animals, mascots and objects with faces (kinds.mjs): the same rig, poses and expressions as the people.
  C('mochi', 'Mochi', 'cat; curious, pokes at everything', {kind: 'cat', colors: {body: '#f0b46a', detail: 'cream', accent: 'rose'}}, 'af_sky'),
  C('soot', 'Soot', 'small black cat; aloof, secretly kind', {kind: 'cat', size: 'small', colors: {body: '#2b2a33', detail: '#f4efe6', accent: 'rose'}}, 'bf_lily'),
  C('biscuit', 'Biscuit', 'dog; loyal, over-eager helper', {kind: 'dog'}, 'am_puck'),
  C('bruno', 'Bruno', 'big bear; gentle and sleepy', {kind: 'bear', size: 'large'}, 'bm_george'),
  C('clover', 'Clover', 'rabbit; nervous quick thinker', {kind: 'rabbit'}, 'af_nicole'),
  C('rusty', 'Rusty', 'fox; clever shortcut-finder', {kind: 'fox'}, 'am_liam'),
  C('puddle', 'Puddle', 'frog; unbothered optimist', {kind: 'frog'}, 'am_echo'),
  C('pebble', 'Pebble', 'penguin; formal, does it by the book', {kind: 'penguin'}, 'bm_lewis'),
  C('hoot', 'Hoot', 'owl; patient night-shift mentor', {kind: 'owl'}, 'bf_emma'),
  C('bloop', 'Bloop', 'blob in the brand colour; the cheerful helper', {kind: 'blob'}, 'af_heart'),
  C('fizz', 'Fizz', 'small blob in the accent colour; excitable sidekick', {kind: 'blob', size: 'small', colors: {body: 'accent', accent: 'primary'}}, 'af_bella'),
  C('drip', 'Drip', 'droplet; calm, goes with the flow', {kind: 'droplet', colors: {body: 'sky'}}, 'af_river'),
  C('twinkle', 'Twinkle', 'star; the win, always celebrating', {kind: 'star'}, 'af_jessica'),
  C('grumble', 'Grumble', 'little monster; the problem, grumpy but harmless', {kind: 'monster', colors: {body: 'plum', accent: 'mustard'}}, 'am_onyx'),
  C('ping', 'Ping', 'phone; always notifying, easily distracted', {kind: 'phone'}, 'af_nova'),
  C('byte', 'Byte', 'laptop; hard-working, slightly overheated', {kind: 'laptop'}, 'am_michael'),
  C('latte', 'Latte', 'coffee cup; warm morning person', {kind: 'cup'}, 'af_kore'),
  C('watt', 'Watt', 'light bulb; the bright idea', {kind: 'bulb'}, 'am_eric'),
  C('rivet', 'Rivet', 'robot; literal-minded automation', {kind: 'robot'}, 'am_adam'),
  C('cog', 'Cog', 'small teal robot; tinkering sidekick', {kind: 'robot', size: 'small', colors: {body: '#7fc4c0', accent: 'coral'}}, 'am_fenrir'),
  C('penny', 'Penny', 'gold coin; thrifty, counts everything', {kind: 'coin'}, 'bf_alice'),
  C('paige', 'Paige', 'book; knows the manual by heart', {kind: 'book'}, 'bf_isabella'),
  C('nimbus', 'Nimbus', 'cloud; soft-spoken, keeps everyone\'s files', {kind: 'cloud'}, 'af_aoede'),
  C('ember', 'Ember', 'red fox with dark socks; bold and impatient', {kind: 'fox', size: 'small', colors: {body: '#c9482f'}}, 'af_alloy')
]);

// The starters that are not people, by group (kinds.mjs KIND_GROUPS).
export const STARTER_KIND_IDS = Object.freeze(STARTER_CAST.filter(entry => isKind(entry.params)).map(entry => entry.id));

// Retired characters: no longer offered (not listed, not in STARTER_IDS), but
// a story that already names one by id still draws it as it always did.
export const RETIRED_CAST = Object.freeze([
  C('fatima', 'Fatima', 'data analyst; headscarf, blazer', {build: 'average', skin: 'tan', hair: {style: 'headscarf', color: 'primary'}, outfit: {top: 'blazer'}, colors: {top: 'charcoal', bottom: 'charcoal', shoes: 'black', accent: 'cream'}}, 'af_sarah')
]);

const BY_ID = new Map([...STARTER_CAST, ...RETIRED_CAST].map(entry => [entry.id, entry]));
export const STARTER_IDS = Object.freeze(STARTER_CAST.map(entry => entry.id));
export const RETIRED_IDS = Object.freeze(RETIRED_CAST.map(entry => entry.id));
/** True for an id a story may name: a starter, or a retired starter. */
export const isStarterId = id => BY_ID.has(id);

/** A starter (or retired) character by id, with normalised params, or null. */
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
  const colors = isKind(params) ? kindColors(params.colors, roles) : characterColors(params.colors, roles);
  return {params, style, colors, fingerprint: rigFingerprint(params, style), look: JSON.stringify({style, params, colors})};
}
