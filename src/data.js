// data.js — built-in lists and ASCII characters.
// Loaded as a plain script (no modules) so its globals are visible to
// detect.js / block.js (content script) and to the options/popup pages.

// Curated built-in medical search terms (all lowercase). Matched as substrings
// against a lowercased search query, so multi-word phrases work too.
const MEDICAL_KEYWORDS = [
  // symptoms
  'symptom', 'symptoms of', 'headache', 'migraine', 'chest pain', 'stomach pain',
  'abdominal pain', 'sore throat', 'fever', 'cough', 'rash', 'itchy', 'dizzy',
  'dizziness', 'nausea', 'vomiting', 'diarrhea', 'fatigue', 'swelling', 'swollen',
  'bleeding', 'shortness of breath', 'numbness', 'tingling', 'cramp', 'bloating',
  'lump', 'bruise', 'blurry vision', 'palpitations', 'insomnia',
  // conditions / diseases
  'cancer', 'tumor', 'tumour', 'diabetes', 'stroke', 'heart attack', 'covid',
  'flu', 'pneumonia', 'infection', 'std', 'sti', 'hiv', 'hepatitis', 'anemia',
  'anaemia', 'thyroid', 'arthritis', 'asthma', 'allergy', 'allergic', 'ulcer',
  'appendicitis', 'meningitis', 'sepsis', 'blood clot', 'aneurysm', 'seizure',
  'depression', 'anxiety disorder', 'adhd', 'autism', 'dementia', 'alzheimer',
  // drugs / treatment
  'dosage', 'dose of', 'mg of', 'side effects', 'side effect of', 'overdose',
  'ibuprofen', 'acetaminophen', 'paracetamol', 'aspirin', 'antibiotic',
  'medication', 'prescription', 'how to treat', 'treatment for', 'cure for',
  'remedy for', 'home remedy',
  // anxious self-diagnosis phrases
  'is it serious', 'am i dying', 'do i have', 'what disease', 'diagnose',
  'diagnosis', 'why does my', 'why do i', 'is it normal', "won't stop",
  'should i go to the er', 'emergency room',
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
  ='(o.o)'=   ¯\_(ツ)_/¯
   (  :  )     step away from the symptoms
  (__(")(")__)
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
  window.DR_NO_DATA = { MEDICAL_KEYWORDS, MEDICAL_DOMAINS, SEARCH_ENGINES, CHARACTERS };
}
