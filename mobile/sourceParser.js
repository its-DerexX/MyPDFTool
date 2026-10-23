const POSTAL_AREAS = {
  '63571': { gemeinde: 'Gelnhausen', ortsteile: ['Gelnhausen-Mitte', 'Haitz', 'Hailer', 'Höchst', 'Meerholz', 'Roth'] },
  '63584': { gemeinde: 'Gründau', ortsteile: ['Breitenborn', 'Gettenbach', 'Hain-Gründau', 'Lieblos', 'Mittel-Gründau', 'Niedergründau', 'Rothenbergen'] },
  '63579': { gemeinde: 'Freigericht', ortsteile: ['Altenmittlau', 'Bernbach', 'Horbach', 'Neuses', 'Somborn'] },
  '63594': { gemeinde: 'Hasselroth', ortsteile: ['Gondsroth', 'Neuenhaßlau', 'Niedermittlau'] },
  '63589': { gemeinde: 'Linsengericht', ortsteile: ['Altenhaßlau', 'Eidengesäß', 'Geislitz', 'Großenhausen', 'Lützelhausen'] },
  '63633': { gemeinde: 'Birstein', ortsteile: ['Birstein', 'Bösgesäß', 'Böß-Gesäß', 'Fischborn', 'Hettersroth', 'Illnhausen', 'Kirchbracht', 'Lichenroth', 'Mauswinkel', 'Oberreichenbach', 'Obersotzbach', 'Unterreichenbach', 'Untersotzbach', 'Völzberg', 'Wettges', 'Wüstwillenroth'] },
  '63636': { gemeinde: 'Brachttal', ortsteile: ['Schlierbach', 'Hellstein', 'Neuenschmidten', 'Spielberg', 'Udenhain', 'Streitberg'] },
  '36399': { gemeinde: 'Freiensteinau', ortsteile: ['Freiensteinau', 'Fleschenbach', 'Gunzenau', 'Holzmühl', 'Nieder-Moos', 'Ober-Moos', 'Radmühl', 'Radmühl I', 'Radmühl II', 'Reichlos', 'Reinhards', 'Salz', 'Weidenau'] },
  '63607': { gemeinde: 'Wächtersbach', ortsteile: ['Wächtersbach', 'Aufenau', 'Hesseldorf', 'Leisenwald', 'Neudorf', 'Waldensberg', 'Weilers', 'Wittgenborn'] },
  '63619': { gemeinde: 'Bad Orb', ortsteile: ['Bad Orb'] }
};

// Keep these lists centralized so new legal forms and industries can be added
// without changing the classification logic below.
const LEGAL_FORM_PATTERNS = [
  /\bg\.?m\.?b\.?h\.?\b/i,
  /\b(?:ug|u\.?g\.?)\s*(?:\(\s*haftungsbeschränkt\s*\))?\b/i,
  /\ba\.?g\.?\b/i,
  /\bk\.?g\.?\b/i,
  /\bo\.?h\.?g\.?\b/i,
  /\bg\.?b\.?r\.?\b/i,
  /\be\.?\s*k(?:fm|fr)?\.?\b/i,
  /\be\.?\s*v\.?\b/i,
  /\bgmbh\s*&\s*co\.?\s*(?:kg|ohg)\b/i,
  /\bug\s*&\s*co\.?\s*kg\b/i,
  /\bkgaa\b/i,
  /\bse\b/i,
  /\bpartg(?:\s*mbb)?\b/i,
  /\be\.?\s*g\.?\b/i,
  /\bggmbh\b/i,
  /\bstiftung\b/i,
  /\bkoerperschaft\s+des\s+oeffentlichen\s+rechts\b/i,
  /\bkdör\b/i,
  /\banstalt\s+des\s+öffentlichen\s+rechts\b/i,
  /\baör\b/i,
  /\bltd\.?\b/i,
  /\blimited\b/i,
  /\bllc\b|\bl\.?l\.?c\.?\b/i,
  /\binc\.?\b|\bincorporated\b/i,
  /\bcorp\.?\b|\bcorporation\b/i,
  /\bplc\b/i,
  /\bb\.?v\.?\b/i,
  /\bn\.?v\.?\b/i,
  /\bs\.?a\.?\b/i,
  /\bs\.?a\.?\s*r\.?l\.?\b/i,
  /\bsarl\b/i,
  /\bs\.?l\.?\b/i
];

const COMPANY_KEYWORDS = [
  'Elektro', 'Elektrotechnik', 'Elektrobau', 'Elektronik', 'Technik', 'Servicetechnik', 'Gebäudetechnik', 'Haustechnik', 'Sanitär', 'Heizung', 'Klima', 'Lüftung', 'Installation', 'Montage', 'Maschinenbau', 'Metallbau', 'Stahlbau', 'Anlagenbau', 'Schreinerei', 'Tischlerei', 'Zimmerei', 'Dachdeckerei', 'Malerbetrieb', 'Handwerk', 'Werkstatt', 'Reparatur', 'Wartung',
  'Bau', 'Hochbau', 'Tiefbau', 'Straßenbau', 'Gartenbau', 'Landschaftsbau', 'GaLaBau', 'Gartenpflege', 'Gartenservice', 'Hausmeisterservice', 'Gebäudeservice', 'Gebäudereinigung', 'Immobilien', 'Hausverwaltung', 'Facility Management', 'Projektentwicklung',
  'Service', 'Dienstleistungen', 'Dienstleistungsservice', 'Consulting', 'Beratung', 'Unternehmensberatung', 'Handel', 'Großhandel', 'Einzelhandel', 'Vertrieb', 'Verkauf', 'Logistik', 'Transport', 'Spedition', 'Kurierdienst', 'Reinigung', 'Sicherheitsdienst', 'Personalservice', 'Büroservice',
  'IT-Service', 'Software', 'Computertechnik', 'Netzwerktechnik', 'Telekommunikation', 'Medien', 'Marketing', 'Werbung', 'Druckerei', 'Gastronomie', 'Catering', 'Restaurant', 'Hotel', 'Blumenservice', 'Floristik', 'Landwirtschaft', 'Forstwirtschaft', 'Autotechnik', 'Kfz-Service', 'Fahrzeugtechnik',
  'Elektroservice', 'Gartenbaubetrieb', 'Immobilienverwaltung', 'Gebäudetechnik', 'Kaskadenservice'
];

const SECTION_LABELS = [
  'Rechnungsadresse', 'Anschlussnehmer', 'Anschlussnutzer', 'Anschlussstandort',
  'Kontaktdaten', 'Antragsteller', 'Antragsdaten', 'Tiefbau', 'Fachbetrieb',
  'Fachkraft', 'Messkonzept', 'Netzanschluss'
];

function normalizeText(value) {
  return String(value || '').toLocaleLowerCase('de-DE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

function normalizeLocation(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactBusinessText(value) {
  return normalizeText(value).replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}

function hasLegalForm(value) {
  const text = compactBusinessText(value);
  return LEGAL_FORM_PATTERNS.some(pattern => pattern.test(text));
}

function hasCompanyKeyword(value) {
  const text = compactBusinessText(value);
  const compact = text.replace(/[^a-z0-9äöü]/g, '');
  return COMPANY_KEYWORDS.some(keyword => {
    const normalizedKeyword = compactBusinessText(keyword);
    const keywordWords = normalizedKeyword.split(' ').filter(Boolean);
    const wordPattern = new RegExp(`(^|\\s)${keywordWords.map(escapeRegExp).join('\\s+')}($|\\s)`, 'i');
    if (wordPattern.test(text)) return true;
    const compactKeyword = normalizedKeyword.replace(/[^a-z0-9äöü]/g, '');
    return compactKeyword.length >= 6 && compact.includes(compactKeyword);
  });
}

function isCompanyLine(value, allowSingleWord = false) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (allowSingleWord && text.split(/\s+/).length === 1) return true;
  return hasLegalForm(text) || hasCompanyKeyword(text);
}

function parseAddressLine(line) {
  const cleaned = String(line || '').trim()
    .replace(/^(?:straße|strasse|anschrift|adresse)\s*:\s*/iu, '');
  const match = cleaned.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-–—/]\s*\d+[a-zA-Z]?)?)$/u);
  if (!match) return null;
  return {
    street: match[1].trim(),
    houseNumber: match[2].replace(/[–—]/g, '-').replace(/\s*[-/]\s*/g, value => value.includes('/') ? '/' : '-')
  };
}

function parsePostalLine(line) {
  const cleaned = String(line || '').trim().replace(/^(?:plz|postleitzahl|ort)\s*:\s*/iu, '');
  return cleaned.match(/^(\d{5}),?\s*(.+)$/);
}

function resolvePostalLocation(postal, rawLocation) {
  const area = POSTAL_AREAS[postal];
  if (!area) return { gemeinde: rawLocation || '', ortsteil: '' };
  const raw = String(rawLocation || '').trim();
  const normalized = normalizeLocation(raw);
  const municipality = normalizeLocation(area.gemeinde);
  const ortsteil = area.ortsteile
    .filter(value => normalizeLocation(value) !== municipality && normalized.includes(normalizeLocation(value)))
    .sort((left, right) => normalizeLocation(right).length - normalizeLocation(left).length)[0] || '';
  if (ortsteil) return { gemeinde: area.gemeinde, ortsteil };
  const remainderMatch = raw.match(new RegExp(`^${escapeRegExp(area.gemeinde)}(?:\\s+|\\s*[,;/|-]\\s*)(.+)$`, 'iu'));
  const remainder = remainderMatch?.[1]?.trim() || '';
  return {
    gemeinde: area.gemeinde,
    ortsteil: remainder && normalizeLocation(remainder) !== municipality ? remainder : ''
  };
}

function isSectionHeader(line, label) {
  const normalizedLine = normalizeText(line).replace(/\s*:\s*/g, ':').trim();
  const normalizedLabel = normalizeText(label).replace(/\s*:\s*$/, '').trim();
  return normalizedLine === normalizedLabel
    || normalizedLine.startsWith(`${normalizedLabel}:`)
    || normalizedLine.startsWith(`${normalizedLabel} `);
}

function sectionStart(lines, labels) {
  return lines.findIndex(line => labels.some(label => isSectionHeader(line, label)));
}

function extractSection(lines, labels, endLabels = SECTION_LABELS) {
  const start = sectionStart(lines, labels);
  if (start < 0) return [];
  const firstLine = lines[start];
  const label = labels.find(candidate => isSectionHeader(firstLine, candidate));
  const inlineValue = label ? firstLine.slice(firstLine.toLocaleLowerCase('de-DE').indexOf(label.toLocaleLowerCase('de-DE')) + label.length).replace(/^\s*[:\-]\s*/u, '').trim() : '';
  const end = lines.findIndex((line, index) => index > start && endLabels.some(endLabel => isSectionHeader(line, endLabel)));
  const body = lines.slice(start + 1, end < 0 ? lines.length : end);
  return inlineValue ? [inlineValue, ...body] : body;
}

function stripRecipientLabel(line) {
  return String(line || '').trim()
    .replace(/^(?:empfänger|firma|unternehmen|name|vorname|nachname|straße|strasse|hausnummer|plz|postleitzahl|ort)\s*:?\s*/iu, '')
    .trim();
}

function parseName(lines) {
  const fullName = lines.join(' ').replace(/\s+/g, ' ').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    fullName,
    vorname: parts.length > 1 ? parts.slice(0, -1).join(' ') : '',
    name: parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '')
  };
}

function parseRecipientLines(lines) {
  const recipientLines = lines.map(stripRecipientLabel).filter(Boolean);
  if (!recipientLines.length) return { hasRecipient: false, firma: '', vorname: '', name: '' };

  if (recipientLines.length === 1) {
    const line = recipientLines[0];
    if (isCompanyLine(line, true)) return { hasRecipient: true, firma: line, vorname: '', name: '' };
    const person = parseName([line]);
    return { hasRecipient: true, firma: '', vorname: person.vorname, name: person.name };
  }

  const companyLines = recipientLines.filter(line => isCompanyLine(line));
  if (!companyLines.length) {
    const person = parseName(recipientLines);
    return { hasRecipient: true, firma: '', vorname: person.vorname, name: person.name };
  }

  const personLines = recipientLines.filter(line => !companyLines.includes(line));
  const person = personLines.length ? parseName(personLines) : { vorname: '', name: '' };
  return {
    hasRecipient: true,
    firma: companyLines.join(' '),
    vorname: person.vorname,
    name: person.name
  };
}

function parsePartySection(lines) {
  const cleaned = lines.map(line => String(line || '').trim()).filter(Boolean);
  const addressLineIndex = cleaned.findIndex(line => parseAddressLine(line));
  const postalLineIndex = cleaned.findIndex(line => parsePostalLine(line));
  const address = addressLineIndex >= 0 ? parseAddressLine(cleaned[addressLineIndex]) : null;
  const postalMatch = postalLineIndex >= 0 ? parsePostalLine(cleaned[postalLineIndex]) : null;
  const recipientEnd = addressLineIndex >= 0 ? addressLineIndex : (postalLineIndex >= 0 ? postalLineIndex : cleaned.length);
  const recipient = parseRecipientLines(cleaned.slice(0, recipientEnd));
  return {
    ...recipient,
    strasse: address?.street || '',
    hausnummer: address?.houseNumber || '',
    plz: postalMatch?.[1] || '',
    ort: postalMatch?.[2] || '',
    hasAddress: Boolean(address || postalMatch)
  };
}

function choosePrimaryParty(primary, secondary, tertiary) {
  const recipientSource = primary.hasRecipient ? primary : (secondary.hasRecipient ? secondary : tertiary);
  const addressSource = primary.hasAddress ? primary : (secondary.hasAddress ? secondary : tertiary);
  return {
    ...recipientSource,
    strasse: addressSource?.strasse || '',
    hausnummer: addressSource?.hausnummer || '',
    plz: addressSource?.plz || '',
    ort: addressSource?.ort || ''
  };
}

function valueAfter(lines, label) {
  const index = lines.findIndex(line => normalizeText(line).startsWith(normalizeText(label)));
  return index < 0 ? '' : lines[index].slice(label.length).trim();
}

function parseSourceData(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const billing = parsePartySection(extractSection(lines, ['Rechnungsadresse']));
  const customer = parsePartySection(extractSection(lines, ['Anschlussnehmer']));
  const user = parsePartySection(extractSection(lines, ['Anschlussnutzer']));
  const applicant = parsePartySection(extractSection(lines, ['Antragsteller']));

  // Billing recipient and billing address are intentionally resolved separately:
  // an address-only billing block supplies the address, while the recipient is
  // taken from Anschlussnehmer/Anschlussnutzer. A billing recipient blocks all
  // supplementation from those sections.
  const sourceParty = choosePrimaryParty(customer, user, applicant);
  const selectedRecipient = billing.hasRecipient ? billing : sourceParty;
  const selectedAddress = billing.hasAddress ? billing : sourceParty;
  const customerLocation = resolvePostalLocation(selectedAddress.plz, selectedAddress.ort);

  const site = parsePartySection(extractSection(lines, ['Anschlussstandort'], ['Tiefbau', ...SECTION_LABELS]));
  const customerContact = extractSection(lines, ['Kontaktdaten'], ['Antragsteller', 'Antragsdaten', ...SECTION_LABELS]);
  const phone = valueAfter(customerContact, 'Telefon:');
  const email = valueAfter(customerContact, 'E-Mail:');
  const preferredContact = email || phone;
  const siteLocation = resolvePostalLocation(site.plz, site.ort);

  return {
    'Name': selectedRecipient.name || '',
    'Vorname': selectedRecipient.vorname || '',
    'Geburtsdatum bei Privatpersonen bzw RegistergerichtRegisternummer der Firma': selectedRecipient.firma || '',
    'Straße': selectedAddress.strasse || '',
    'HausNr': selectedAddress.hausnummer || '',
    'Postleitzahl_2': selectedAddress.plz || '',
    'Ort_2': selectedAddress.plz ? customerLocation.gemeinde : (selectedAddress.ort || ''),
    'Telefon Fax EMail': preferredContact,
    'Straße ggf Anschlussnutzer': site.strasse || '',
    'HausNr ggf Anschlussnutzer': site.hausnummer || '',
    'Postleitzahl': site.plz || '',
    'Ort': site.plz ? siteLocation.gemeinde : (site.ort || ''),
    'Ortsteil  FlurstückNr  Etage': site.plz ? siteLocation.ortsteil : ''
  };
}

module.exports = {
  COMPANY_KEYWORDS,
  LEGAL_FORM_PATTERNS,
  hasCompanyKeyword,
  hasLegalForm,
  isCompanyLine,
  parseRecipientLines,
  parseSourceData
};
