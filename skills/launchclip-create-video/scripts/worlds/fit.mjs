// The topic fit table: which worlds and props suit a prompt's topic, for art
// direction (docs/SEEDED_STYLES_RFC.md §3.4: direction chooses, the seed
// varies). Each row lists the worlds that fit, best first, and the props
// that dress them; a seed picks among a row's worlds, never outside it.
//
//   suggestWorld(prompt) → {kind, time, props, topic, worlds, score} | null
//
// Matching is on whole words and short phrases in the prompt, so "cook"
// fits cooking but "cookie consent" does not. Time comes from time words
// (night, late, neon → night; sunset, evening, golden hour → dusk), else day.

export const TOPIC_FIT = Object.freeze([
  {topic: 'cooking', words: ['cook', 'cooking', 'recipe', 'recipes', 'kitchen', 'chef', 'meal', 'meals', 'bake', 'baking', 'food', 'dinner', 'lunch', 'breakfast', 'restaurant'], worlds: ['kitchen', 'cafe'], props: ['pan', 'pot', 'cutting-board', 'bread', 'fruit-bowl']},
  {topic: 'coffee', words: ['coffee', 'cafe', 'café', 'barista', 'espresso', 'latte', 'tea'], worlds: ['cafe', 'kitchen', 'shopfronts'], props: ['coffee-cup', 'mug', 'teapot', 'cake']},
  {topic: 'fitness', words: ['fitness', 'workout', 'gym', 'exercise', 'training', 'run', 'running', 'yoga', 'health', 'wellness', 'sport', 'sports', 'athlete', 'marathon'], worlds: ['gym', 'park'], props: ['dumbbell', 'kettlebell', 'water-bottle', 'ball']},
  {topic: 'developer tools', words: ['developer', 'developers', 'dev', 'devtools', 'code', 'coding', 'programming', 'api', 'sdk', 'cli', 'terminal', 'github', 'repo', 'repository', 'open source', 'open-source', 'git', 'compiler', 'debug', 'debugging'], worlds: ['home-desk', 'server-room', 'office'], props: ['laptop', 'mug', 'keyboard', 'headphones', 'succulent']},
  {topic: 'infrastructure', words: ['cloud', 'server', 'servers', 'database', 'hosting', 'infrastructure', 'kubernetes', 'devops', 'data centre', 'data center', 'deploy', 'deployment', 'uptime', 'security', 'cybersecurity', 'backup'], worlds: ['server-room', 'office', 'skyline'], props: ['server-rack', 'laptop', 'monitor']},
  {topic: 'work and teams', words: ['team', 'teams', 'office', 'meeting', 'meetings', 'collaboration', 'startup', 'business', 'saas', 'b2b', 'workplace', 'hr', 'hiring', 'productivity', 'project management', 'crm'], worlds: ['office', 'home-desk', 'rooftop'], props: ['whiteboard', 'laptop', 'chart-easel', 'plant', 'mug']},
  {topic: 'remote work', words: ['remote', 'work from home', 'wfh', 'freelance', 'freelancer', 'side project', 'indie'], worlds: ['home-desk', 'cafe', 'living-room'], props: ['laptop', 'mug', 'desk-lamp', 'headphones', 'plant']},
  {topic: 'finance', words: ['finance', 'money', 'budget', 'budgeting', 'savings', 'save', 'invest', 'investing', 'bank', 'banking', 'payments', 'fintech', 'tax', 'taxes', 'accounting', 'invoice', 'invoices', 'pricing'], worlds: ['office', 'home-desk', 'skyline'], props: ['coins', 'piggy-bank', 'calculator', 'chart-easel', 'wall-chart']},
  {topic: 'growth and analytics', words: ['growth', 'analytics', 'metrics', 'dashboard', 'revenue', 'sales', 'marketing', 'kpi', 'conversion', 'data'], worlds: ['office', 'abstract-stage', 'skyline'], props: ['chart-easel', 'wall-chart', 'trophy', 'laptop']},
  {topic: 'launch', words: ['launch', 'launching', 'release', 'announcing', 'announcement', 'introducing', 'new feature', 'product hunt', 'unveil', 'keynote'], worlds: ['abstract-stage', 'rooftop', 'space'], props: ['rocket', 'balloons', 'trophy', 'lightbulb']},
  {topic: 'space and science', words: ['space', 'rocket', 'astronomy', 'planet', 'planets', 'nasa', 'satellite', 'galaxy', 'stars', 'science', 'physics', 'moon', 'mars'], worlds: ['space', 'mountains', 'rooftop'], props: ['rocket', 'telescope', 'globe', 'flag']},
  {topic: 'education', words: ['learn', 'learning', 'school', 'class', 'classroom', 'teacher', 'teaching', 'student', 'students', 'course', 'courses', 'lesson', 'tutorial', 'education', 'study', 'university', 'explainer'], worlds: ['classroom', 'home-desk', 'living-room'], props: ['books', 'globe', 'whiteboard', 'clock', 'notebook']},
  {topic: 'ideas and creativity', words: ['idea', 'ideas', 'creative', 'creativity', 'brainstorm', 'design', 'designer', 'innovation', 'inspiration', 'invent', 'invention'], worlds: ['studio', 'workshop', 'abstract-stage'], props: ['lightbulb', 'whiteboard', 'notebook', 'flowers']},
  {topic: 'creators and media', words: ['creator', 'creators', 'youtube', 'youtuber', 'podcast', 'podcasting', 'stream', 'streaming', 'video', 'influencer', 'content', 'vlog', 'music', 'record', 'recording', 'tiktok'], worlds: ['studio', 'living-room', 'city-street'], props: ['microphone', 'camera', 'headphones', 'guitar', 'neon-sign']},
  {topic: 'making and hardware', words: ['maker', 'makers', 'diy', 'build', 'building', 'hardware', 'tools', 'repair', 'woodwork', 'robot', 'robots', 'robotics', 'engineering', '3d printing'], worlds: ['workshop', 'studio', 'server-room'], props: ['robot', 'box', 'ladder', 'lightbulb']},
  {topic: 'home and family', words: ['home', 'family', 'house', 'parents', 'parenting', 'kids', 'children', 'relationship', 'relationships', 'couple', 'dating', 'cosy', 'cozy', 'interior'], worlds: ['living-room', 'kitchen', 'park'], props: ['floor-lamp', 'framed-art', 'leafy-plant', 'tv']},
  {topic: 'shopping and retail', words: ['shop', 'shopping', 'store', 'retail', 'ecommerce', 'e-commerce', 'checkout', 'delivery', 'order', 'orders', 'market', 'boutique'], worlds: ['shopfronts', 'city-street', 'crossing'], props: ['box', 'boxes', 'gift', 'phone']},
  {topic: 'city and transport', words: ['city', 'urban', 'commute', 'commuting', 'transport', 'traffic', 'car', 'cars', 'bike', 'cycling', 'taxi', 'ride', 'rides', 'mobility', 'parking', 'maps', 'navigation'], worlds: ['crossing', 'city-street', 'skyline'], props: ['car', 'bike', 'scooter', 'traffic-cone', 'lamp-post']},
  {topic: 'nightlife and events', words: ['party', 'nightlife', 'event', 'events', 'concert', 'festival', 'celebration', 'celebrate', 'birthday', 'bar', 'club'], worlds: ['rooftop', 'alley', 'abstract-stage'], props: ['balloons', 'cake', 'gift', 'neon-sign']},
  {topic: 'travel', words: ['travel', 'trip', 'holiday', 'vacation', 'flight', 'flights', 'hotel', 'booking', 'tourism', 'journey', 'adventure'], worlds: ['beach', 'mountains', 'skyline'], props: ['suitcase', 'backpack', 'map', 'umbrella', 'palm-tree']},
  {topic: 'outdoors and nature', words: ['nature', 'outdoor', 'outdoors', 'hike', 'hiking', 'camping', 'camp', 'forest', 'trees', 'mountain', 'mountains', 'climate', 'environment', 'sustainability', 'green', 'garden', 'gardening', 'plants'], worlds: ['forest', 'mountains', 'park'], props: ['tent', 'campfire', 'backpack', 'signpost', 'pine-tree']},
  {topic: 'summer and leisure', words: ['beach', 'summer', 'sea', 'ocean', 'surf', 'sun', 'swim', 'swimming', 'relax', 'relaxing', 'weekend', 'leisure'], worlds: ['beach', 'park'], props: ['umbrella', 'ball', 'palm-tree', 'kite']},
  {topic: 'awards and success', words: ['win', 'winner', 'winning', 'award', 'awards', 'success', 'achievement', 'milestone', 'goal', 'goals', 'champion', 'record'], worlds: ['abstract-stage', 'office', 'gym'], props: ['trophy', 'balloons', 'flag', 'chart-easel']},
  {topic: 'communication', words: ['email', 'emails', 'inbox', 'message', 'messages', 'chat', 'messaging', 'notification', 'notifications', 'phone', 'call', 'calls', 'support', 'customer'], worlds: ['office', 'home-desk', 'cafe'], props: ['phone', 'envelope', 'laptop', 'headphones']},
  {topic: 'time and planning', words: ['time', 'schedule', 'scheduling', 'calendar', 'deadline', 'deadlines', 'plan', 'planning', 'habit', 'habits', 'routine', 'morning', 'focus'], worlds: ['home-desk', 'office', 'living-room'], props: ['calendar', 'alarm-clock', 'hourglass', 'clipboard']},
  {topic: 'gaming', words: ['game', 'games', 'gaming', 'gamer', 'esports', 'console', 'play'], worlds: ['living-room', 'studio', 'alley'], props: ['game-controller', 'tv', 'headphones', 'neon-sign']},
  {topic: 'ai and the future', words: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'agent', 'agents', 'automation', 'automate', 'future', 'futuristic', 'robot'], worlds: ['server-room', 'space', 'abstract-stage'], props: ['robot', 'drone', 'server-rack', 'lightbulb']}
]);

const NIGHT = ['night', 'nights', 'midnight', 'late', 'neon', 'nightlife', 'after dark', 'moonlight', 'stars', 'evening shift', 'night owl'];
const DUSK = ['sunset', 'dusk', 'evening', 'golden hour', 'twilight', 'sundown', 'end of the day', 'after work'];

const normalise = text => ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9à-ÿ\s-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (text, word) => text.includes(` ${word} `);

/** The time of day a prompt asks for (day unless it names night or dusk). */
export function timeForPrompt(prompt) {
  const text = normalise(prompt);
  if (NIGHT.some(word => has(text, word))) return 'night';
  if (DUSK.some(word => has(text, word))) return 'dusk';
  return 'day';
}

/**
 * The world that fits a prompt: the best-scoring topic row (words it
 * matches; longer phrases count more), its first world, its props and the
 * prompt's time. Ties go to the earlier row. null when no topic matches,
 * so the seed picks freely.
 */
export function suggestWorld(prompt) {
  const text = normalise(prompt);
  let best = null;
  for (const row of TOPIC_FIT) {
    const hits = row.words.filter(word => has(text, word));
    if (!hits.length) continue;
    const score = hits.reduce((sum, word) => sum + word.split(/[\s-]/).length, 0);
    if (!best || score > best.score) best = {row, score, hits};
  }
  if (!best) return null;
  return {kind: best.row.worlds[0], time: timeForPrompt(prompt), props: [...best.row.props], topic: best.row.topic, worlds: [...best.row.worlds], matched: best.hits, score: best.score};
}
