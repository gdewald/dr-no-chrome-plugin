// data.js — built-in lists and ASCII characters.
// Loaded as a plain script (no modules) so its globals are visible to
// detect.js / block.js (content script) and to the options/popup pages.

// Tier 1 — unambiguously medical (all lowercase). Any one of these blocks on
// its own. Keep this list free of words that carry a common non-medical sense;
// anything that needs a subject to mean something medical belongs in
// CONTEXT_PHRASES below.
const MEDICAL_KEYWORDS = [
  // symptoms. Sensations that need a body part to be medical ("lump", "rash",
  // "bleeding") are deliberately absent — they live in SENSATIONS and are
  // handled by tier 2, so "lump sum" and "bleeding edge" stay unblocked.
  'symptom', 'symptoms of', 'headache', 'migraine', 'chest pain', 'stomach pain',
  'abdominal pain', 'sore throat', 'fever', 'cough', 'dizzy', 'dizziness',
  'nausea', 'vomiting', 'diarrhea', 'shortness of breath', 'bloating',
  'blurry vision', 'palpitations', 'insomnia',
  // conditions / diseases. "std", "stroke", "depression" and "fatigue" are
  // absent on purpose: each collides with a common non-medical sense
  // (std::vector, stroke of luck, the Great Depression, metal fatigue) and a
  // hard block is too costly to spend on a guess. "stroke symptoms" and
  // "depression symptoms" still block via "symptom" above.
  'cancer', 'tumor', 'tumour', 'diabetes', 'heart attack', 'covid',
  'flu', 'pneumonia', 'infection', 'hepatitis', 'anemia',
  'anaemia', 'thyroid', 'arthritis', 'asthma', 'allergy', 'allergic', 'ulcer',
  'appendicitis', 'meningitis', 'sepsis', 'blood clot', 'aneurysm', 'seizure',
  'anxiety disorder', 'adhd', 'autism', 'dementia', 'alzheimer',
  // drugs / treatment
  'dosage', 'dose of', 'mg of', 'side effects', 'side effect of', 'overdose',
  'ibuprofen', 'acetaminophen', 'paracetamol', 'aspirin', 'antibiotic',
  'medication', 'prescription', 'how to treat', 'treatment for', 'cure for',
  'remedy for', 'home remedy',
  // self-diagnosis phrases that need no help to be medical
  'am i dying', 'what disease', 'should i go to the er', 'should i see a doctor',
  'emergency room', 'urgent care',
];

// Tier 2 — question framings. These are grammar, not medicine: they only mean
// something medical once the query also names a body part. On their own they
// stay out of the way of "do i have to pay taxes" or "why does my car shake".
const CONTEXT_PHRASES = [
  'do i have', 'why does my', 'why do i', 'is it normal', 'is it serious',
  "won't stop", 'wont stop', 'diagnose', 'diagnosis', 'what causes',
  'how do i get rid of', 'should i worry about', 'is this normal',
];

// The subject that gives a context phrase or a sensation its medical meaning.
// Never blocks alone — "back to school" and "hand it in" are not medical.
const BODY_PARTS = [
  'head', 'forehead', 'skull', 'face', 'jaw', 'throat', 'neck', 'shoulder',
  'arm', 'elbow', 'wrist', 'hand', 'finger', 'thumb', 'knuckle', 'chest',
  'breast', 'rib', 'back', 'spine', 'stomach', 'belly', 'abdomen', 'gut',
  'hip', 'groin', 'leg', 'thigh', 'knee', 'shin', 'calf', 'ankle', 'foot',
  'feet', 'toe', 'heel', 'skin', 'eye', 'ear', 'nose', 'mouth', 'tongue',
  'tooth', 'teeth', 'gums', 'lip', 'heart', 'lung', 'liver', 'kidney',
  'bladder', 'bowel', 'colon', 'intestine', 'sinus', 'muscle', 'joint',
  'bone', 'nerve', 'blood', 'brain', 'scalp', 'tonsils', 'gland', 'lymph',
  'artery', 'vein', 'tendon', 'ligament',
];

// Body parts that double as everyday words. A sensation still disambiguates
// them ("back pain" is medical), but a bare question framing cannot: "why does
// my back button not work" is not a symptom. So these are excluded from the
// framing rule and only ever count alongside a sensation.
const AMBIGUOUS_PARTS = [
  'back', 'head', 'face', 'eye', 'ear', 'nose', 'mouth', 'tongue', 'lip',
  'arm', 'hand', 'finger', 'thumb', 'shoulder', 'neck', 'chest', 'breast',
  'rib', 'spine', 'gut', 'hip', 'leg', 'foot', 'feet', 'toe', 'heel', 'calf',
  'skin', 'heart', 'bone', 'blood', 'brain', 'muscle', 'joint', 'nerve',
  'gland',
];

// Pairs with a body part to block ("knee hurts", "back pain"). Alone these are
// far too common to trust — a car can have a burning smell.
const SENSATIONS = [
  'hurt', 'hurts', 'hurting', 'pain', 'painful', 'ache', 'aching', 'achy',
  'sore', 'soreness', 'swollen', 'swelling', 'itch', 'itchy', 'burning',
  'numb', 'numbness', 'tingling', 'stiff', 'stiffness', 'bleeding', 'bruise',
  'lump', 'bump', 'rash', 'mole', 'discharge', 'cramp', 'twitch', 'twitching',
  'throbbing', 'tender', 'swell', 'infected',
];

// Known medical / self-diagnosis destinations. Matched against the hostname:
// blocks the domain itself and any subdomain of it.
const MEDICAL_DOMAINS = [
  'webmd.com',
  'mayoclinic.org',
  'healthline.com',
  'drugs.com',
  'medlineplus.gov',
  'nih.gov',
  'patient.info',
  'medicalnewstoday.com',
  'everydayhealth.com',
  'health.com',
  'clevelandclinic.org',
  'medicinenet.com',
  'rxlist.com',
  'verywellhealth.com',
  'nhs.uk',
  'my.clevelandclinic.org',
];

// Recognized search engines -> the URL query parameter holding the search terms.
// Keyed by a substring that must appear in the hostname.
const SEARCH_ENGINES = {
  'google.': 'q',
  'bing.com': 'q',
  'duckduckgo.com': 'q',
  'search.yahoo.': 'p',
  'ecosia.org': 'q',
  'startpage.com': 'query',
  'search.brave.com': 'q',
  'qwant.com': 'q',
};

// ASCII characters the user can pick from on the options page.
const CHARACTERS = {
  cat: {
    name: 'Waving cat',
    art: String.raw`
   /\_/\
  ( o.o )   ~ meow, no WebMD today ~
   > ^ <
  /     \
 (       )___
  \_____/    \
`,
  },
  bear: {
    name: 'Shrugging bear',
    art: String.raw`
   ( )_( )
   ( o.o )
  \(  :  )/   step away from the symptoms
   (_)  (_)
`,
  },
  robot: {
    name: 'Robot doctor',
    art: String.raw`
    [-_-]
   /|###|\    BEEP. DIAGNOSIS: touch grass.
    |###|
   _|# #|_
  (_)   (_)
`,
  },
  owl: {
    name: 'Wise owl',
    art: String.raw`
    ,___,
    (O,O)    whooo needs another symptom search?
    (   )
   --"-"---
`,
  },
};

// Make available to service-worker-less content-script context and pages.
if (typeof window !== 'undefined') {
  window.DR_NO_DATA = {
    MEDICAL_KEYWORDS,
    CONTEXT_PHRASES,
    BODY_PARTS,
    AMBIGUOUS_PARTS,
    SENSATIONS,
    MEDICAL_DOMAINS,
    SEARCH_ENGINES,
    CHARACTERS,
  };
}
