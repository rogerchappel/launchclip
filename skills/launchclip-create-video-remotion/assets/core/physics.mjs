// World physics (docs/DIRECTION_GUARDRAILS.md §1): every element of a world
// has a motion class, and only the camera moves anchored things.
//
//   anchored  fixed to the world: walls, furniture, parked cars, props on a
//             desk, a cast set's furniture. Moves only through the camera,
//             by its layer's transform.
//   ambient   moves in place, subtly and physically: clouds, water, a flame,
//             a flickering sign, light rays and glows.
//   mobile    really moves: characters, vehicles, birds, balloons.
//
// The world drawing (kit/core/worlds/) is static per layer: the world module
// moves its back, mid and front layers by the camera's depth for each layer
// (catalog-world.mjs worldCameraStates) and nothing else, so every anchored
// element shares its layer's transform. The fx layer (rays, glows, haze) is
// ambient and never parallaxed. A cast-scene standing in the plate (backdrop
// "world") is anchored to the plate's front layer (catalog-characters.mjs
// plateFollow); its characters are mobile and move only by acting cues.
//
// src/direction_guardrails.js physicsGate checks a resolved story against
// these rules. Pure ESM; imports only sibling kit/core files.

import {PROP_IDS} from './worlds/props.mjs';

export const MOTION_CLASSES = Object.freeze(['anchored', 'ambient', 'mobile']);

/** World layers: the drawn layers are anchored; the fx layer is ambient. */
export const WORLD_LAYER_MOTION = Object.freeze({back: 'anchored', mid: 'anchored', front: 'anchored', fx: 'ambient'});

// Props that are not anchored. Everything else in the prop library sits
// still in the world (a laptop, a bench, a lamp post, a parked bike).
const MOBILE_PROPS = ['car', 'scooter', 'skateboard', 'ball', 'drone', 'kite', 'balloons', 'hot-air-balloon', 'robot'];
const AMBIENT_PROPS = ['candle', 'campfire', 'neon-sign', 'flag'];

/** Motion class per prop id: {id: 'anchored' | 'ambient' | 'mobile'}. */
export const PROP_MOTION = Object.freeze(Object.fromEntries(PROP_IDS.map(id => [id, MOBILE_PROPS.includes(id) ? 'mobile' : AMBIENT_PROPS.includes(id) ? 'ambient' : 'anchored'])));

/** Motion class of the other things a scene draws. */
export const ELEMENT_MOTION = Object.freeze({'world-layer': 'anchored', 'world-fx': 'ambient', 'set-furniture': 'anchored', character: 'mobile', 'caption': 'screen', 'card': 'screen'});

/** A prop's motion class (anchored for an unknown id). */
export const propMotion = id => PROP_MOTION[id] ?? 'anchored';

// Transform keys: an anchored target may carry these only from the camera.
export const TRANSFORM_KEYS = Object.freeze(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation']);

/** Planner lines on world physics (kit/core/planning-prompt.mjs, the skills). */
export function physicsPromptLines() {
  return [
    'World physics: walls, furniture, parked cars, props and a cast set\'s desk or bench are anchored to the world; only the camera moves them (world params.camera: still, drift, pan-left, pan-right, push, pull). Never animate them on their own.',
    'Ambient things (clouds, water, flames, signs, light) move in place; mobile things (characters, vehicles, birds) move by acting cues (walk-to), never by drifting.',
    'Two world scenes of the same place (kind, time and props) joined by a cut make the room jump: make them one world scene, or move to a different place.',
    'A cast-scene over a world plate shares the plate\'s window (same start and end), so its set never pops in mid-plate.'
  ];
}
