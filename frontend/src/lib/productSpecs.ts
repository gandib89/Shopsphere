// Specifications and warranty copy for the catalogue, taken from Apple's published tech-spec
// pages (apple.com/<product>/specs). Every product in a category is described with the SAME
// ordered field list, so two products can be read row-for-row in the compare tray — a field a
// product does not publish comes back as an em dash rather than shifting the rows out of line.

export type SpecRow = { label: string; value: string };

const CATEGORY_ALIASES: Record<string, string> = {
  'Mobile Phones': 'iPhone', Laptops: 'MacBook', Tablets: 'iPad',
  Smartwatches: 'Apple Watch', 'Mac Mini': 'Mac mini',
};

// Field order per category. This is the comparison contract: same labels, same order, always.
const CATEGORY_FIELDS: Record<string, string[]> = {
  MacBook: ['Chip', 'Display', 'Memory', 'Storage', 'Battery', 'Ports', 'Camera', 'Wireless', 'Weight', 'Operating system'],
  'Mac mini': ['Chip', 'Memory', 'Storage', 'Ports', 'Wireless', 'Dimensions', 'Weight', 'Operating system'],
  iPhone: ['Display', 'Chip', 'Rear cameras', 'Front camera', 'Video', 'Battery', 'Storage', 'Material', 'Water resistance', 'Connector', 'Wireless', 'Weight'],
  'Apple Watch': ['Case sizes', 'Case material', 'Display', 'Chip', 'Battery', 'Water resistance', 'Health sensors', 'Wireless'],
  Accessories: ['Chip', 'Battery', 'Connectivity', 'Charging', 'Water resistance', 'Weight', 'Compatibility'],
};

const MACOS = 'macOS with Apple Intelligence';

const SPECS: Record<string, Record<string, string>> = {
  // ── Laptops ────────────────────────────────────────────────────────────
  'MacBook Air 13-inch (M5)': {
    Chip: 'Apple M5 — 10-core CPU, 8- or 10-core GPU',
    Display: '13.6-inch Liquid Retina, 2560×1664 at 224 ppi, 500 nits',
    Memory: '16GB, 24GB or 32GB unified memory',
    Storage: '512GB – 4TB SSD',
    Battery: 'Up to 18 hours video streaming, 15 hours wireless web',
    Ports: 'MagSafe 3, two Thunderbolt 4 (USB-C), 3.5 mm headphone',
    Camera: '12MP Center Stage with Desk View, 1080p',
    Weight: '1.24 kg (2.7 lb)',
    'Operating system': MACOS,
  },
  'MacBook Air 15-inch (M5)': {
    Chip: 'Apple M5 — 10-core CPU, 10-core GPU',
    Display: '15.3-inch Liquid Retina, 2880×1864 at 224 ppi, 500 nits',
    Memory: '16GB, 24GB or 32GB unified memory',
    Storage: '512GB – 4TB SSD',
    Battery: 'Up to 18 hours video streaming, 15 hours wireless web',
    Ports: 'MagSafe 3, two Thunderbolt 4 (USB-C), 3.5 mm headphone',
    Camera: '12MP Center Stage with Desk View, 1080p',
    Weight: '1.51 kg (3.3 lb)',
    'Operating system': MACOS,
  },
  'MacBook Pro 14-inch': {
    Chip: 'Apple M5, M5 Pro or M5 Max — up to 18-core CPU, 40-core GPU',
    Display: '14.2-inch Liquid Retina XDR, 3024×1964, 120Hz ProMotion, 1000 nits SDR',
    Memory: '16GB – 128GB unified memory',
    Storage: '1TB – 8TB SSD',
    Battery: 'Up to 24 hours video streaming',
    Ports: 'MagSafe 3, three Thunderbolt 4/5, HDMI, SDXC, 3.5 mm headphone',
    Camera: '12MP Center Stage with Desk View',
    Wireless: 'Wi-Fi 7, Bluetooth 6',
    Weight: '1.55 – 1.63 kg (3.4 – 3.6 lb)',
    'Operating system': MACOS,
  },
  'MacBook Pro 16-inch': {
    Chip: 'Apple M5 Pro or M5 Max — up to 18-core CPU, 40-core GPU',
    Display: '16.2-inch Liquid Retina XDR, 3456×2234, 120Hz ProMotion, 1000 nits SDR',
    Memory: '24GB – 128GB unified memory',
    Storage: '1TB – 8TB SSD',
    Battery: 'Up to 22 – 24 hours video streaming',
    Ports: 'MagSafe 3, three Thunderbolt 4/5, HDMI, SDXC, 3.5 mm headphone',
    Camera: '12MP Center Stage with Desk View',
    Wireless: 'Wi-Fi 7, Bluetooth 6',
    Weight: '2.13 kg (4.7 lb)',
    'Operating system': MACOS,
  },
  'MacBook Neo': {
    Chip: 'Apple A18 Pro',
    Display: '13-inch Liquid Retina, 2560×1664',
    Memory: '16GB unified memory',
    Storage: '256GB or 512GB SSD',
    Battery: 'Up to 15 hours video streaming',
    Ports: 'Two USB-C, 3.5 mm headphone',
    Camera: '12MP Center Stage',
    Weight: '1.2 kg (2.6 lb)',
    'Operating system': MACOS,
  },
  'Mac mini': {
    Chip: 'Apple M6 (12-core CPU, 12-core GPU) or M5 Pro (up to 18-core CPU, 20-core GPU)',
    Memory: '16GB – 64GB unified memory',
    Storage: '256GB – 8TB SSD',
    Ports: 'Four Thunderbolt (five on M5 Pro), HDMI, Gigabit Ethernet (10Gb option)',
    Wireless: 'Wi-Fi 7, Bluetooth 6',
    Dimensions: '12.7 × 12.7 × 5.0 cm',
    Weight: '0.68 – 0.73 kg (1.5 – 1.6 lb)',
    'Operating system': MACOS,
  },

  // ── iPhone ─────────────────────────────────────────────────────────────
  'iPhone 17': {
    Display: '6.3-inch Super Retina XDR OLED, 2622×1206 at 460 ppi, 120Hz ProMotion, 3000 nits peak',
    Chip: 'A19 — 6-core CPU, 5-core GPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main f/1.6, 48MP Ultra Wide f/2.2',
    'Front camera': '18MP Center Stage f/1.9',
    Video: '4K Dolby Vision up to 60 fps',
    Battery: 'Up to 30 hours video playback; 50% charge in 20 minutes (40W)',
    Storage: '256GB or 512GB',
    Material: 'Aluminium with Ceramic Shield 2 front',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7, Bluetooth 6, dual eSIM',
    Weight: '177 g (6.24 oz)',
  },
  'iPhone 17 Pro Max': {
    Display: '6.9-inch Super Retina XDR OLED, 2868×1320 at 460 ppi, 120Hz ProMotion, 3000 nits peak',
    Chip: 'A19 Pro — 6-core CPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main f/1.78, 48MP Ultra Wide f/2.2, 48MP Telephoto f/2.8 (4×, 100 mm)',
    'Front camera': '18MP Center Stage f/1.9',
    Video: '4K Dolby Vision up to 120 fps',
    Battery: 'Up to 39 hours video playback',
    Storage: '256GB, 512GB, 1TB or 2TB',
    Material: 'Aluminium unibody',
    'Water resistance': 'IP68 (6 m for 30 minutes)',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7 (2×2 MIMO), Bluetooth 6',
    Weight: '233 g (8.22 oz)',
  },
  'iPhone 16': {
    Display: '6.1-inch Super Retina XDR OLED, 2556×1179 at 460 ppi, 2000 nits peak',
    Chip: 'A18 — 6-core CPU, 5-core GPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main, 12MP Ultra Wide, 2× optical zoom in',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 60 fps',
    Battery: 'Up to 22 hours video playback',
    Storage: '128GB',
    Material: 'Aluminium with Ceramic Shield front',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7, MagSafe up to 25W',
    Weight: '170 g (6.00 oz)',
  },
  'iPhone 16 Plus': {
    Display: '6.7-inch Super Retina XDR OLED, 2796×1290 at 460 ppi, 2000 nits peak',
    Chip: 'A18 — 6-core CPU, 5-core GPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main, 12MP Ultra Wide, 2× optical zoom in',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 60 fps',
    Battery: 'Up to 27 hours video playback',
    Storage: '128GB or 256GB',
    Material: 'Aluminium with Ceramic Shield front',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7, MagSafe up to 25W',
    Weight: '199 g (7.03 oz)',
  },
  'iPhone 16 Pro': {
    Display: '6.3-inch Super Retina XDR OLED, 2622×1206 at 460 ppi, 120Hz ProMotion, 2000 nits peak',
    Chip: 'A18 Pro — 6-core CPU, 6-core GPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main, 48MP Ultra Wide, 12MP 5× Telephoto',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 120 fps',
    Battery: 'Up to 27 hours video playback',
    Storage: '128GB, 256GB, 512GB or 1TB',
    Material: 'Grade 5 titanium',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7, Bluetooth 5.3',
    Weight: '199 g (7.03 oz)',
  },
  'iPhone 16 Pro Max': {
    Display: '6.9-inch Super Retina XDR OLED, 2868×1320 at 460 ppi, 120Hz ProMotion, 2000 nits peak',
    Chip: 'A18 Pro — 6-core CPU, 6-core GPU, 16-core Neural Engine',
    'Rear cameras': '48MP Fusion Main, 48MP Ultra Wide, 12MP 5× Telephoto',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 120 fps',
    Battery: 'Up to 33 hours video playback',
    Storage: '256GB, 512GB or 1TB',
    Material: 'Grade 5 titanium',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 7, Bluetooth 5.3',
    Weight: '227 g (7.99 oz)',
  },
  'iPhone 15 Pro Max': {
    Display: '6.7-inch Super Retina XDR OLED, 2796×1290 at 460 ppi, 120Hz ProMotion, 2000 nits peak',
    Chip: 'A17 Pro — 6-core CPU, 6-core GPU',
    'Rear cameras': '48MP Main, 12MP Ultra Wide, 12MP 5× Telephoto',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 60 fps',
    Battery: 'Up to 29 hours video playback',
    Storage: '256GB, 512GB or 1TB',
    Material: 'Grade 5 titanium',
    'Water resistance': 'IP68',
    Connector: 'USB-C',
    Wireless: '5G, Wi-Fi 6E, Bluetooth 5.3',
    Weight: '221 g (7.81 oz)',
  },
  'iPhone 14 Pro Max': {
    Display: '6.7-inch Super Retina XDR OLED, 2796×1290 at 460 ppi, 120Hz ProMotion, 2000 nits peak',
    Chip: 'A16 Bionic — 6-core CPU, 5-core GPU',
    'Rear cameras': '48MP Main, 12MP Ultra Wide, 12MP 3× Telephoto',
    'Front camera': '12MP TrueDepth',
    Video: '4K Dolby Vision up to 60 fps',
    Battery: 'Up to 29 hours video playback',
    Storage: '128GB, 256GB, 512GB or 1TB',
    Material: 'Surgical-grade stainless steel',
    'Water resistance': 'IP68',
    Connector: 'Lightning',
    Wireless: '5G, Wi-Fi 6, Bluetooth 5.3',
    Weight: '240 g (8.47 oz)',
  },

  // ── Apple Watch ────────────────────────────────────────────────────────
  'Apple Watch Series 11': {
    'Case sizes': '42 mm or 46 mm',
    'Case material': 'Aluminium or titanium',
    Display: 'Always-On Retina LTPO3 OLED, up to 2000 nits, 326 ppi',
    Chip: 'S10 SiP — 64-bit dual-core, 4-core Neural Engine, 64GB',
    Battery: 'Up to 24 hours (38 hours Low Power); 80% in about 30 minutes',
    'Water resistance': '50 m water resistant, IP6X dust resistant',
    'Health sensors': 'Electrical heart, third-generation optical heart, blood oxygen, temperature',
    Wireless: 'Wi-Fi, Bluetooth 5.3, GPS, second-generation Ultra Wideband',
  },
  'Apple Watch Ultra 3': {
    'Case sizes': '49 mm',
    'Case material': 'Grade 5 titanium with flat sapphire crystal',
    Display: 'Always-On Retina LTPO3 OLED, up to 3000 nits, 326 ppi',
    Chip: 'S10 SiP — 64-bit dual-core, 64GB',
    Battery: 'Up to 42 hours (72 hours Low Power); 80% in about 45 minutes',
    'Water resistance': '100 m (ISO 22810), recreational diving to 40 m',
    'Health sensors': 'Electrical heart, optical heart, blood oxygen, temperature, depth gauge',
    Wireless: 'Wi-Fi, Bluetooth 5.3, dual-frequency GPS, satellite Emergency SOS, optional 5G/LTE',
  },
  'Apple Watch SE 3': {
    'Case sizes': '40 mm or 44 mm',
    'Case material': 'Aluminium with Ion-X front glass',
    Display: 'Always-On Retina OLED LTPO, up to 1000 nits',
    Chip: 'S10 SiP — dual-core, 4-core Neural Engine, 64GB',
    Battery: 'Up to 18 hours (32 hours Low Power); 80% in about 45 minutes',
    'Water resistance': '50 m water resistant',
    'Health sensors': 'Optical heart, sleep stages and apnea notifications, cycle tracking',
    Wireless: 'Wi-Fi, Bluetooth 5.3, GPS, optional 5G RedCap/LTE',
  },

  // ── Accessories ────────────────────────────────────────────────────────
  'AirPods 4': {
    Chip: 'Apple H2',
    Battery: 'Up to 5 hours listening; up to 30 hours with the case',
    Connectivity: 'Bluetooth 5.3, Personalised Spatial Audio',
    Charging: 'USB-C charging case',
    'Water resistance': 'IP54 (buds and case)',
    Weight: '4.3 g per earbud',
    Compatibility: 'iPhone, iPad, Mac and Apple Watch',
  },
  'AirPods 4 with Active Noise Cancellation': {
    Chip: 'Apple H2',
    Battery: 'Up to 4 hours with ANC; up to 20 hours with the case',
    Connectivity: 'Bluetooth 5.3, Active Noise Cancellation, Transparency, Adaptive Audio',
    Charging: 'USB-C or Qi wireless charging case',
    'Water resistance': 'IP54 (buds and case)',
    Weight: '4.3 g per earbud',
    Compatibility: 'iPhone, iPad, Mac and Apple Watch',
  },
  'AirPods Pro 3': {
    Chip: 'Apple H2; second-generation Ultra Wideband in the case',
    Battery: 'Up to 8 hours with ANC; up to 24 hours with the case; 5 min charge is about 1 hour',
    Connectivity: 'Bluetooth 5.3, ANC, Transparency, Adaptive Audio, Hearing Aid feature',
    Charging: 'MagSafe, Apple Watch charger, Qi or USB-C',
    'Water resistance': 'IP57',
    Weight: '5.55 g per earbud',
    Compatibility: 'iPhone, iPad, Mac and Apple Watch',
  },
  'AirPods Max 2': {
    Chip: 'Apple H2',
    Battery: 'Up to 20 hours with ANC and Spatial Audio',
    Connectivity: 'Bluetooth 5.3, ANC, Transparency, Personalised Spatial Audio',
    Charging: 'USB-C',
    Weight: '386 g',
    Compatibility: 'iPhone, iPad, Mac and Apple TV',
  },
  'Magic Keyboard with Touch ID': {
    Battery: 'Rechargeable, about one month per charge',
    Connectivity: 'Bluetooth, Touch ID, USB-C cable in the box',
    Charging: 'USB-C',
    Compatibility: 'Mac models with Apple silicon',
  },
  'Magic Keyboard for iPad Pro': {
    Connectivity: 'Smart Connector, backlit keys, built-in trackpad',
    Charging: 'USB-C pass-through charging',
    Compatibility: '11-inch and 13-inch iPad Pro',
  },
  'Magic Keyboard for iPad Air': {
    Connectivity: 'Smart Connector, backlit keys, built-in trackpad',
    Charging: 'USB-C pass-through charging',
    Compatibility: '11-inch and 13-inch iPad Air',
  },
  'Magic Trackpad (USB-C)': {
    Battery: 'Rechargeable, about one month per charge',
    Connectivity: 'Bluetooth, Multi-Touch surface with Force Touch',
    Charging: 'USB-C',
    Compatibility: 'Mac with macOS 13 or later, iPad with iPadOS 16.1 or later',
  },
  'Magic Mouse (USB-C)': {
    Battery: 'Rechargeable, about one month per charge',
    Connectivity: 'Bluetooth, Multi-Touch surface',
    Charging: 'USB-C',
    Compatibility: 'Mac with macOS 13 or later, iPad with iPadOS 16.1 or later',
  },
  'MagSafe Charger (1 m)': {
    Connectivity: 'MagSafe magnetic alignment, Qi2 wireless charging',
    Charging: 'Up to 25W with a 30W or higher USB-C adapter',
    Compatibility: 'iPhone 12 and later, AirPods with a wireless case',
  },
  'MagSafe Charger (2 m)': {
    Connectivity: 'MagSafe magnetic alignment, Qi2 wireless charging',
    Charging: 'Up to 25W with a 30W or higher USB-C adapter',
    Compatibility: 'iPhone 12 and later, AirPods with a wireless case',
  },
  'MagSafe Battery Pack': {
    Battery: '1460 mAh, 11.13 Wh',
    Connectivity: 'MagSafe magnetic attachment',
    Charging: '7.5W wireless on the go, up to 15W when plugged in',
    Weight: '115 g',
    Compatibility: 'iPhone 12 and iPhone 13 models',
  },
  'Apple 20W USB-C Power Adapter': {
    Charging: '20W maximum output, one USB-C port',
    Compatibility: 'iPhone, iPad, AirPods and Apple Watch',
  },
  'Apple 35W Dual USB-C Port Compact Power Adapter': {
    Charging: '35W shared across two USB-C ports',
    Compatibility: 'Two devices at once — iPhone, iPad, Mac or Apple Watch',
  },
  'Apple 40W Dynamic Power Adapter with 60W Max': {
    Charging: '40W sustained, up to 60W dynamic on one USB-C port',
    Compatibility: 'Fast charging on iPhone 16 and later, iPad and Mac',
  },
  'Apple 60W USB-C Charge Cable (1 m)': {
    Connectivity: 'USB-C to USB-C, woven, USB 2.0 data',
    Charging: 'Up to 60W power delivery',
    Compatibility: 'iPhone, iPad, Mac and Apple Watch',
  },
  'Apple 240W USB-C Charge Cable (2 m)': {
    Connectivity: 'USB-C to USB-C, woven, USB 2.0 data',
    Charging: 'Up to 240W power delivery',
    Compatibility: 'MacBook Pro, iPad and iPhone',
  },
  'USB-C to MagSafe 3 Cable (2 m)': {
    Connectivity: 'USB-C to MagSafe 3, woven, magnetically detaches',
    Charging: 'Fast charging on MagSafe 3 notebooks',
    Compatibility: 'MacBook Air and MacBook Pro with MagSafe 3',
  },
};

// Products the demo invents; their specs are illustrative, not from an Apple spec page.
const DEMO_ONLY = new Set(['MacBook Neo']);

export const isDemoSpec = (name: string) => DEMO_ONLY.has(name);

const normaliseCategory = (category: string) => CATEGORY_ALIASES[category] || category;

const fieldsFor = (category: string) => CATEGORY_FIELDS[normaliseCategory(category)] || [];

// The four rows worth showing before anyone opens the full table.
const HIGHLIGHT_FIELDS: Record<string, string[]> = {
  MacBook: ['Chip', 'Display', 'Memory', 'Battery'],
  'Mac mini': ['Chip', 'Memory', 'Storage', 'Ports'],
  iPhone: ['Rear cameras', 'Chip', 'Battery', 'Display'],
  'Apple Watch': ['Display', 'Chip', 'Battery', 'Case sizes'],
  Accessories: ['Battery', 'Connectivity', 'Charging', 'Compatibility'],
};

// Spec values are written for the table, where a full sentence reads fine. A highlight tile fits
// about one line, so drop trailing clauses and then, only if it is still too long, the trailing
// comma-separated details — "16GB, 24GB or 32GB unified memory" survives whole, a display string
// loses its resolution and brightness.
const TILE_CHARS = 34;
const headline = (value: string) => {
  const clause = value.split(/;| — /)[0].trim();
  if (clause.length <= TILE_CHARS) return clause;
  const cut = clause.lastIndexOf(',', TILE_CHARS);
  return cut > 0 ? clause.slice(0, cut) : clause;
};

export function productHighlights(name: string, category: string): SpecRow[] {
  const values = SPECS[name];
  if (!values) return [];
  const fields = HIGHLIGHT_FIELDS[normaliseCategory(category)] || fieldsFor(category);
  return fields.filter(field => values[field]).slice(0, 4)
    .map(field => ({ label: field, value: headline(values[field]) }));
}

/** The fields this product actually publishes, in the category's comparison order. */
export function productSpecs(name: string, category: string): SpecRow[] {
  const values = SPECS[name];
  if (!values) return [];
  const fields = fieldsFor(category);
  const ordered = fields.length ? fields : Object.keys(values);
  return ordered.filter(field => values[field]).map(field => ({ label: field, value: values[field] }));
}

/** Every field in the category, so two products line up row-for-row even when one omits a value. */
export const specFields = (category: string) => fieldsFor(category);

export const specValue = (name: string, field: string) => SPECS[name]?.[field] || '—';

// Apple's standard cover, which is what every product in this catalogue ships with.
export const WARRANTY = {
  headline: 'Apple One-Year Limited Warranty',
  points: [
    'One year of hardware repair coverage from delivery, against defects in materials and workmanship.',
    '90 days of complimentary technical support from Apple.',
    'AppleCare+ can be added for unlimited accidental-damage repairs (a service fee applies per incident), battery replacement once capacity falls below 80%, and 24/7 priority support.',
    'Not covered: accidental damage, cosmetic wear, consumables, and damage from unauthorised service or modification.',
    'Warranty service is arranged through the seller and Apple Authorised Service Providers.',
  ],
};
