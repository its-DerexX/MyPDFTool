import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import {
  PDFBool,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  degrees,
  drawText,
  rgb
} from 'pdf-lib';
import pako from 'pako/dist/pako.cjs.js';
import { zipSync } from 'fflate';

const templateAsset = require('./assets/blanko.pdf');
const FORM_FONT_SIZE = 9.268;
const GATEWAY_2D_CODE_TYPES = ['qr', 'datamatrix', 'aztec', 'pdf417'];
const WORK_NUMBER_BARCODE_TYPES = ['ean13', 'ean8', 'code128', 'code39', 'itf14', 'upc_a', 'upc_e'];
const RSE_REMARK_PRESET = 'iMSys RSE nachgerüstet';
const DEFAULT_REMARK_PRESETS = ['Antenne außen', 'Antenne innen (Unterputzschrank)', RSE_REMARK_PRESET, 'Kaskade Z1', 'Kaskade Z2'].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
const LEGACY_REMARK_PRESETS = new Set(['Keine Besonderheiten', 'Kunde informiert', 'Zugang nicht möglich']);
const REMARK_PRESETS_FILE = new File(Paths.document, 'MyPDFTool-Bemerkungsvorlagen.json');

async function readPdf(uri) {
  return new Uint8Array(await new File(uri).arrayBuffer());
}

async function extractPdfText(uri) {
  const bytes = await readPdf(uri);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const text = [];
  let streamStart = 0;
  while ((streamStart = binary.indexOf('stream', streamStart)) >= 0) {
    let dataStart = streamStart + 6;
    if (binary[dataStart] === '\r') dataStart++;
    if (binary[dataStart] === '\n') dataStart++;
    const dataEnd = binary.indexOf('endstream', dataStart);
    if (dataEnd < 0) break;
    try {
      const compressed = bytes.slice(dataStart, dataEnd);
      const decoded = pako.inflate(compressed);
      const content = Array.from(decoded, byte => String.fromCharCode(byte)).join('');
      const arrays = content.match(/\[[\s\S]*?\]\s*TJ/g) || [];
      for (const array of arrays) {
        const strings = array.match(/\((?:\\.|[^\\)])*\)/g) || [];
        for (const string of strings) text.push(decodePdfString(string.slice(1, -1)));
      }
    } catch (_) {}
    streamStart = dataEnd + 9;
  }
  return text.join('\n');
}

function decodePdfString(value) {
  return value.replace(/\\([0-7]{1,3}|\\|\(|\)|n|r|t|b|f)/g, (_, escaped) => {
    if (/^[0-7]/.test(escaped)) return String.fromCharCode(parseInt(escaped, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[escaped] || escaped;
  });
}

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

function normalizeLocation(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
}

function resolvePostalLocation(postal, rawLocation) {
  const area = POSTAL_AREAS[postal];
  if (!area) return { gemeinde: rawLocation, ortsteil: '' };
  const normalized = normalizeLocation(rawLocation);
  const municipality = normalizeLocation(area.gemeinde);
  const ortsteil = area.ortsteile.find(value => normalized.includes(normalizeLocation(value)));
  return {
    gemeinde: area.gemeinde,
    ortsteil: ortsteil && normalizeLocation(ortsteil) !== municipality ? ortsteil : ''
  };
}

function cleanFilenamePart(value) {
  return String(value || '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function removePdfExtension(value) {
  return cleanFilenamePart(value).replace(/\.pdf$/i, '').trim();
}

function ensurePdfFilename(value, fallback) {
  const cleaned = removePdfExtension(value);
  const fallbackBase = removePdfExtension(fallback) || 'Zaehlerwechselbeleg';
  return `${cleaned || fallbackBase}.pdf`;
}

function splitRemarkFields(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = ['', ''];
  for (const word of words) {
    if (!lines[0] || `${lines[0]} ${word}`.length <= 48) lines[0] = lines[0] ? `${lines[0]} ${word}` : word;
    else lines[1] = lines[1] ? `${lines[1]} ${word}` : word;
  }
  return lines;
}

function getRemarkFilenameSuffix(value) {
  const normalizedRemark = String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de-DE');
  const filenameSuffixes = ['iMSys Kaskade Z1', 'iMSys Kaskade Z2', 'Kaskade Z1', 'Kaskade Z2'];
  return filenameSuffixes.find(suffix => normalizedRemark.includes(suffix.toLocaleLowerCase('de-DE'))) || '';
}

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function nativePath(uri) {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

async function expandSource(asset) {
  const extension = fileExtension(asset.name);
  if (extension === 'pdf') return [{ uri: asset.uri, name: asset.name }];
  if (extension !== 'zip' && extension !== 'rar') {
    throw new Error(`Nicht unterstütztes Dateiformat: ${asset.name}`);
  }

  // RAR/ZIP extraction is native and therefore requires the installed iOS build,
  // not Expo Go. The module is loaded only when an archive is actually selected.
  const { unarchive } = require('react-native-unarchive');
  const archiveFile = new File(Paths.cache, `mypdftool_archive_${Date.now()}.${extension}`);
  archiveFile.write(await readPdf(asset.uri));
  const extractionDirectory = new Directory(Paths.cache, `mypdftool_extract_${Date.now()}`);
  extractionDirectory.create({ idempotent: true, intermediates: true });
  const result = await unarchive(nativePath(archiveFile.uri), nativePath(extractionDirectory.uri));
  const pdfs = result.files.filter(file => fileExtension(file.name) === 'pdf');
  if (!pdfs.length) throw new Error(`In „${asset.name}“ wurde keine PDF-Datei gefunden.`);
  return pdfs.map(file => ({
    uri: file.path.startsWith('file://') ? file.path : `file://${file.path}`,
    name: file.name
  }));
}

function blockBetween(lines, startLabel, endLabel) {
  const start = lines.findIndex(line => line === startLabel);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line === endLabel);
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function parseAddressLine(line) {
  // Accept single house numbers as well as ranges such as 58-60, 58 – 60,
  // and common additions such as 12a or 12/14.
  const match = String(line || '').trim().match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-–—/]\s*\d+[a-zA-Z]?)?)$/u);
  if (!match) return null;
  return {
    street: match[1].trim(),
    houseNumber: match[2].replace(/[–—]/g, '-').replace(/\s*[-/]\s*/g, value => value.includes('/') ? '/' : '-')
  };
}

function parsePostalLine(line) {
  return String(line || '').trim().match(/^(\d{5}),?\s*(.+)$/);
}

function parsePerson(lines) {
  // Anschlussnehmer normally uses three lines:
  //   name / street + house number / postal code + town
  // Company customers use four lines and put the company between name and address.
  const hasCompany = lines.length >= 4;
  const fullName = lines[0] || '';
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const company = hasCompany ? (lines[1] || '') : '';
  const street = lines[hasCompany ? 2 : 1] || '';
  const address = parseAddressLine(street);
  const postal = parsePostalLine(lines[hasCompany ? 3 : 2]);
  return {
    fullName,
    firma: company,
    vorname: nameParts.shift() || '',
    name: nameParts.join(' '),
    strasse: address ? address.street : street,
    hausnummer: address ? address.houseNumber : '',
    plz: postal ? postal[1] : '',
    ort: postal ? postal[2] : ''
  };
}

function parseSourceData(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const customer = parsePerson(blockBetween(lines, 'Anschlussnehmer', 'Kontaktdaten:'));
  const customerLocation = resolvePostalLocation(customer.plz, customer.ort);
  const applicant = parsePerson(blockBetween(lines, 'Antragsteller', 'Kontaktdaten:'));
  const installer = parsePerson(blockBetween(lines, 'Fachbetrieb:', 'Fachkraft:'));
  const site = blockBetween(lines, 'Anschlussstandort', 'Tiefbau');
  const siteAddress = site.map(parseAddressLine).find(Boolean);
  const sitePostalMatch = site.map(parsePostalLine).find(Boolean);
  const sitePostal = sitePostalMatch ? {
    plz: sitePostalMatch[1],
    ...resolvePostalLocation(sitePostalMatch[1], sitePostalMatch[2])
  } : null;
  const customerContact = blockBetween(lines, 'Kontaktdaten:', 'Antragsteller');
  const installerContact = blockBetween(lines, 'Antragsteller', 'Antragsdaten');
  const phone = valueAfter(customerContact, 'Telefon:');
  const email = valueAfter(customerContact, 'E-Mail:');
  const installerPhone = valueAfter(installerContact, 'Telefon:') || valueAfter(installerContact, 'Telefon:');
  const installerEmail = valueAfter(installerContact, 'E-Mail:');
  const preferredContact = email || phone;
  return {
    'Name': customer.name,
    'Vorname': customer.vorname,
    'Geburtsdatum bei Privatpersonen bzw RegistergerichtRegisternummer der Firma': customer.firma,
    'Straße': customer.strasse,
    'HausNr': customer.hausnummer,
    'Postleitzahl_2': customer.plz,
    'Ort_2': customer.plz ? customerLocation.gemeinde : customer.ort,
    'Telefon Fax EMail': preferredContact,
    'Straße ggf Anschlussnutzer': siteAddress ? siteAddress.street : '',
    'HausNr ggf Anschlussnutzer': siteAddress ? siteAddress.houseNumber : '',
    'Postleitzahl': sitePostal ? sitePostal.plz : '',
    'Ort': sitePostal ? sitePostal.gemeinde : '',
    'Ortsteil  FlurstückNr  Etage': sitePostal ? sitePostal.ortsteil : '',
    // The installer/company section is intentionally left untouched.
  };
}

function valueAfter(lines, label) {
  const index = lines.findIndex(line => line.startsWith(label));
  return index < 0 ? '' : lines[index].slice(label.length).trim();
}

async function createFilledPdf(sourceUri, outputDirectory) {
  const sourceText = await extractPdfText(sourceUri);
  const values = parseSourceData(sourceText);
  const template = await Asset.loadAsync(templateAsset);
  const targetPdf = await PDFDocument.load(await readPdf(template[0].localUri || template[0].uri));
  const targetForm = targetPdf.getForm();
  let filled = 0;

  for (const [fieldName, value] of Object.entries(values)) {
    try {
      const field = targetForm.getTextField(fieldName);
      field.setText(value || '');
      field.setFontSize(FORM_FONT_SIZE);
      filled++;
    } catch (_) {}
  }

  if (filled === 0) throw new Error('Die Quelldatei konnte nicht gelesen werden. Bitte die Antragsdaten-PDF auswählen.');

  // Keep the existing AcroForm widgets and let the PDF viewer render the values,
  // just as it does when a user fills the original blank form manually.
  targetForm.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  const outputBytes = await targetPdf.save();
  const address = [values['Straße ggf Anschlussnutzer'], values['HausNr ggf Anschlussnutzer']]
    .filter(Boolean).join(' ');
  const place = values['Ortsteil  FlurstückNr  Etage'] || values['Ort'];
  const filename = [values.Name, address, place].map(cleanFilenamePart).filter(Boolean).join(', ') || 'Zaehlerwechselbeleg';
  return { filename: `${filename}.pdf`, bytes: outputBytes, filled };
}

const EEG_GROUPS = Array.from({ length: 12 }, (_, index) => `EEG Gr.${String(index + 1).padStart(2, '0')}`);
const SZA_TYPES = ['DS', 'ZRZ', 'DT', 'ALT'];
const SZA_STAND_FIELDS = {
  DS: [{ field: 'htzst1', marker: 'zst1', label: '1.8.0' }],
  ZRZ: [
    { field: 'htzst1', marker: 'zst1', label: '1.8.0' },
    { field: 'htzst2', marker: 'zst2', label: '2.8.0' }
  ],
  DT: [
    { field: 'htzst1', marker: 'zst1', label: '1.8.1' },
    { field: 'htzst2', marker: 'zst2', label: '1.8.2' },
    { field: 'htzst3', marker: 'zst3', label: '2.8.0' }
  ],
  ALT: [{ field: 'htzst1', marker: 'zst1', label: '' }]
};
const SZE_TYPES = ['DS', 'ZRZ'];
const SZE_STAND_FIELDS = {
  DS: [{ field: 'htzst6', marker: 'zst6', label: '1.8.0' }],
  ZRZ: [
    { field: 'htzst6', marker: 'zst6', label: '1.8.0' },
    { field: 'htzst7', marker: 'zst7', label: '2.8.0' }
  ]
};
const EEG_LOCATION_GROUPS = [
  ['EEG Gr.01', ['Kirchbracht', 'Lichenroth', 'Oberreichenbach', 'Völzberg', 'Wettges', 'Radmühl']],
  ['EEG Gr.02', ['Birstein', 'Bösgesäß', 'Böß-Gesäß', 'Bös-Gesäß', 'Fischborn', 'Hettersroth', 'Illnhausen', 'Mauswinkel', 'Obersotzbach', 'Unterreichenbach', 'Untersotzbach', 'Wüstwillenroth', 'Hellstein', 'Schlierbach', 'Udenhain', 'Katholisch-Willenroth']],
  ['EEG Gr.03', ['Helfersdorf', 'Leisenwald', 'Waldensberg', 'Wittgenborn', 'Wächtersbach', 'Neuenschmidten', 'Spielberg', 'Streitberg']],
  ['EEG Gr.04', ['Breitenborn A.W.', 'Gettenbach', 'Hain-Gründau', 'Lieblos', 'Mittel-Gründau', 'Niedergründau', 'Rothenbergen']],
  ['EEG Gr.05', ['Aufenau', 'Hesseldorf', 'Neudorf', 'Weilers', 'Orb']],
  ['EEG Gr.06', ['Mernes', 'Burgjoß', 'Burgjoss']],
  ['EEG Gr.07', ['Bieber', 'Breitenborn A.B.', 'Kassel', 'Lanzingen', 'Roßbach', 'Wirthheim', 'Wirtsheim', 'Wirtheim']],
  ['EEG Gr.08', ['Lettgenbrunn', 'Oberndorf', 'Pfaffenhausen', 'Flörsbach', 'Kempfenbrunn', 'Lohrhaupten', 'Mosborn']],
  ['EEG Gr.09', ['Gondsroth', 'Neuenhaßlau', 'Niedermittlau']],
  ['EEG Gr.10', ['Somborn']],
  ['EEG Gr.11', ['Altenmittlau', 'Bernbach', 'Neuses']],
  ['EEG Gr.12', ['Gelnhausen', 'Altenhaßlau', 'Eidengesäß', 'Geislitz', 'Großenhausen', 'Lützelhausen', 'Horbach']]
];

const EEG_LOCATION_LOOKUP = EEG_LOCATION_GROUPS.flatMap(([group, locations]) => locations.map(location => [normalizeLocation(location), group]));

function inferEegGroupFromFilename(filename) {
  const normalizedFilename = normalizeLocation(filename);
  return EEG_LOCATION_LOOKUP
    .filter(([location]) => normalizedFilename.includes(location))
    .sort((left, right) => right[0].length - left[0].length)[0]?.[1] || '';
}

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function dateKey(date) {
  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
}

function formatPdfDate(date) {
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function formatBildnummerDate(date) {
  if (!date) return '';
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function extractGatewayWerkNr(value) {
  let payload = String(value || '');
  try {
    payload = decodeURIComponent(payload);
  } catch (_) {}
  const normalized = payload.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = normalized.match(/EEMH\d+/);
  return match ? match[0] : '';
}

function MiniCalendar({ value, onChange }) {
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date((value || today).getFullYear(), (value || today).getMonth(), 1));
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? new Date(year, month, day) : null;
  });

  function moveMonth(offset) {
    setVisibleMonth(new Date(year, month + offset, 1));
    setMonthMenuOpen(false);
  }

  return (
    <View style={styles.calendar}>
      <View style={styles.calendarHeader}>
        <Pressable style={styles.calendarArrow} onPress={() => moveMonth(-1)}><Text style={styles.calendarArrowText}>‹</Text></Pressable>
        <Pressable style={styles.monthTitleButton} onPress={() => setMonthMenuOpen(open => !open)}>
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]} {year}⌄</Text>
        </Pressable>
        <Pressable style={styles.calendarArrow} onPress={() => moveMonth(1)}><Text style={styles.calendarArrowText}>›</Text></Pressable>
      </View>
      {monthMenuOpen && <View style={styles.monthMenu}>
        {MONTH_NAMES.map((name, index) => <Pressable key={name} style={[styles.monthItem, index === month && styles.monthItemSelected]} onPress={() => { setVisibleMonth(new Date(year, index, 1)); setMonthMenuOpen(false); }}>
          <Text style={[styles.monthItemText, index === month && styles.monthItemTextSelected]}>{name}</Text>
        </Pressable>)}
      </View>}
      <View style={styles.weekdayRow}>{WEEKDAY_NAMES.map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.calendarGrid}>{cells.map((day, index) => <Pressable key={`${index}-${day ? day.getDate() : 'empty'}`} disabled={!day} style={[styles.dayCell, day && dateKey(day) === dateKey(value) && styles.dayCellSelected]} onPress={() => day && onChange(day)}>
        <Text style={[styles.dayText, day && dateKey(day) === dateKey(value) && styles.dayTextSelected]}>{day ? day.getDate() : ''}</Text>
      </Pressable>)}</View>
    </View>
  );
}

function escapePdfLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function replaceAppearanceText(targetPdf, field, value) {
  field.acroField.dict.set(PDFName.of('V'), PDFString.of(value));
  const widgets = field.acroField.getWidgets();

  for (const widget of widgets) {
    const appearanceEntry = widget.dict.get(PDFName.of('AP'));
    const appearance = appearanceEntry && targetPdf.context.lookup(appearanceEntry);
    const normalEntry = appearance?.get(PDFName.of('N'));
    const normal = normalEntry && targetPdf.context.lookup(normalEntry);
    if (!normal?.getContents || !normal.dict) continue;

    const contents = String.fromCharCode(...normal.getContents());
    const updatedContents = contents.replace(/\((?:\\.|[^\\)])*\)\s*Tj/, `(${escapePdfLiteral(value)}) Tj`);
    if (updatedContents === contents) continue;

    const streamDict = normal.dict.clone(targetPdf.context);
    streamDict.set(PDFName.of('Length'), PDFNumber.of(updatedContents.length));
    const updatedStream = targetPdf.context.stream(updatedContents, streamDict);
    appearance.set(PDFName.of('N'), targetPdf.context.register(updatedStream));
  }
}

const SAVED_TEXT_FIELD = {
  text: 'Bernges',
  x: 312.000004,
  y: 61.92,
  width: 56.25,
  height: 17.25,
  baseline: 3.670898,
  fontSize: 15
};

function hasSavedTextField(targetPdf) {
  const contentsName = PDFName.of('Contents');
  const subtypeName = PDFName.of('Subtype');
  for (const page of targetPdf.getPages()) {
    const rawAnnots = page.node.get(PDFName.of('Annots'));
    const annots = rawAnnots && targetPdf.context.lookup(rawAnnots);
    if (!annots?.asArray) continue;
    for (const ref of annots.asArray()) {
      const annotation = targetPdf.context.lookup(ref);
      if (annotation?.get(subtypeName)?.toString() !== '/FreeText') continue;
      const contents = annotation.get(contentsName);
      const text = contents?.decodeText ? contents.decodeText() : '';
      if (text === SAVED_TEXT_FIELD.text) return true;
    }
  }
  return false;
}

async function addSavedTextField(targetPdf) {
  if (hasSavedTextField(targetPdf)) return;

  const page = targetPdf.getPages()[0];
  const context = targetPdf.context;
  const font = await targetPdf.embedFont(StandardFonts.Helvetica);
  const appearance = context.formXObject(
    drawText(font.encodeText(SAVED_TEXT_FIELD.text), {
      font: PDFName.of(font.name),
      size: SAVED_TEXT_FIELD.fontSize,
      color: rgb(0, 0, 0),
      x: 0,
      y: SAVED_TEXT_FIELD.baseline,
      rotate: degrees(0),
      xSkew: degrees(0),
      ySkew: degrees(0)
    }),
    {
      Resources: { Font: { [font.name]: font.ref } },
      BBox: context.obj([0, 0, SAVED_TEXT_FIELD.width, SAVED_TEXT_FIELD.height]),
      Matrix: context.obj([1, 0, 0, 1, 0, 0])
    }
  );
  const appearanceRef = context.register(appearance);
  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    F: 4,
    Rect: context.obj([
      SAVED_TEXT_FIELD.x,
      SAVED_TEXT_FIELD.y,
      SAVED_TEXT_FIELD.x + SAVED_TEXT_FIELD.width,
      SAVED_TEXT_FIELD.y + SAVED_TEXT_FIELD.height
    ]),
    Contents: PDFString.of(SAVED_TEXT_FIELD.text),
    C: context.obj([0, 0, 0]),
    CA: 1,
    IT: 'FreeTextTypewriter',
    BS: context.obj({ Type: 'Border', W: 0, S: 'S' }),
    Rotate: 0,
    DA: PDFString.of(`${font.name} ${SAVED_TEXT_FIELD.fontSize} Tf 0 0 0 rg 0 0 0 RG `),
    AP: context.obj({ N: appearanceRef })
  });
  page.node.addAnnot(context.register(annotation));
}

async function updateGatewayAnnotation(targetPdf, gatewayWerkNr, gatewayType) {
  const gateway = extractGatewayWerkNr(gatewayWerkNr);
  if (!gateway) return;

  const type = gatewayType === 'Draht' ? 'Draht' : 'Funk';
  const text = `SMGW ${gateway} ${type}`;
  const context = targetPdf.context;
  const subtypeName = PDFName.of('Subtype');
  const contentsName = PDFName.of('Contents');
  const annotationName = PDFName.of('Annots');

  // Remove the old FreeText overlay. Some mobile PDF viewers render its
  // default white background in addition to its appearance stream.
  for (const page of targetPdf.getPages()) {
    const rawAnnots = page.node.get(annotationName);
    const annots = rawAnnots && context.lookup(rawAnnots);
    if (!annots?.asArray) continue;

    const keptAnnotations = annots.asArray().filter(ref => {
      const annotation = context.lookup(ref);
      if (annotation?.get(subtypeName)?.toString() !== '/FreeText') return true;
      const contents = annotation.get(contentsName);
      const currentText = contents?.decodeText ? contents.decodeText() : '';
      return !/^SMGW\s+/i.test(currentText);
    });
    if (keptAnnotations.length !== annots.asArray().length) {
      page.node.set(annotationName, context.obj(keptAnnotations));
    }
  }

  // Draw the value into the page content so every PDF preview renders it
  // consistently, without an annotation background or duplicate text.
  const page = targetPdf.getPages()[0];
  const font = await targetPdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 83.25, y: 421.17, size: 15, font, color: rgb(0, 0, 0) });
}

async function createRsePdf(sourceUri, group, werkNr, selectedDate, einbauEnabled, ausbauEnabled, zusammenlegungEnabled, wsdsEnabled, wpEnabled, pvEnabled, haushaltEnabled, gewerbeEnabled, baustromEnabled, allgemeinEnabled, klemmeEnabled, einbauWerkNr, ausbauWerkNr, gatewayWerkNr, gatewayType, szaType, szaStandValues, szeType, szeStandValues, bemerkungen, bildnummer) {
  const targetPdf = await PDFDocument.load(await readPdf(sourceUri));
  const targetForm = targetPdf.getForm();
  const [bemerkungen1, bemerkungen2] = splitRemarkFields(bemerkungen);
  const fields = {
    '1': haushaltEnabled ? 'x' : '',
    '7': pvEnabled ? 'x' : '',
    '9': wpEnabled ? 'x' : '',
    '10': gewerbeEnabled ? 'x' : '',
    '11': baustromEnabled ? 'x' : '',
    '12': allgemeinEnabled ? 'x' : '',
    '13': klemmeEnabled ? 'x' : '',
    F: einbauEnabled ? 'x' : '',
    G: ausbauEnabled ? 'x' : '',
    M: zusammenlegungEnabled ? 'x' : '',
    J: wsdsEnabled ? 'x' : '',
    'Werk Nr_2': einbauWerkNr.trim(),
    'Werk Nr': ausbauWerkNr.trim(),
    'Bemerkungen 1': bemerkungen1,
    'Bemerkungen 2': bemerkungen2,
    Schausteller: selectedDate ? `${formatBildnummerDate(selectedDate)}_${String(bildnummer || '').trim()}` : ''
  };
  for (let index = 1; index <= 5; index++) {
    fields[`zst${index}`] = '';
    fields[`htzst${index}`] = '';
  }
  if (ausbauWerkNr.trim()) {
    for (const standField of SZA_STAND_FIELDS[szaType] || []) {
      fields[standField.marker] = String(szaStandValues?.[standField.field] || '').trim();
      fields[standField.field] = standField.label;
    }
  }
  for (let index = 6; index <= 9; index++) {
    fields[`zst${index}`] = '';
    fields[`htzst${index}`] = '';
  }
  fields.zst0 = '';
  fields.htzst0 = '';
  if (einbauEnabled && einbauWerkNr.trim()) {
    for (const standField of SZE_STAND_FIELDS[szeType] || []) {
      fields[standField.marker] = String(szeStandValues?.[standField.field] || '').trim();
      fields[standField.field] = standField.label;
    }
  }
  if (group && werkNr.trim()) {
    const groupNumber = Number(group.slice(-2));
    Object.assign(fields, {
      'Werk NrRow2': werkNr.trim(),
      TypRow2: 'LCR 160',
      CodeRow2: `613/${String(5 + groupNumber).padStart(2, '0')}`,
      VerwendungsartRow2: group
    });
  }
  if (selectedDate) {
    if (ausbauEnabled || zusammenlegungEnabled) fields.Datum = formatPdfDate(selectedDate);
    else fields.Datum_2 = formatPdfDate(selectedDate);
  }

  for (const [fieldName, value] of Object.entries(fields)) {
    replaceAppearanceText(targetPdf, targetForm.getTextField(fieldName), value);
  }

  await addSavedTextField(targetPdf);
  await updateGatewayAnnotation(targetPdf, gatewayWerkNr, gatewayType);

  targetForm.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
  return targetPdf.save();
}

export default function App() {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editScreen, setEditScreen] = useState(false);
  const [selectedEditPdf, setSelectedEditPdf] = useState(null);
  const [selectedEditPdfName, setSelectedEditPdfName] = useState('');
  const [rseEnabled, setRseEnabled] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(EEG_GROUPS[0]);
  const [groupAutoDetected, setGroupAutoDetected] = useState(false);
  const [werkNr, setWerkNr] = useState('');
  const [einbauWerkNr, setEinbauWerkNr] = useState('');
  const [ausbauWerkNr, setAusbauWerkNr] = useState('');
  const [gatewayWerkNr, setGatewayWerkNr] = useState('');
  const [gatewayType, setGatewayType] = useState('Draht');
  const [szaType, setSzaType] = useState('DS');
  const [szaStandValues, setSzaStandValues] = useState({});
  const [szeType, setSzeType] = useState('ZRZ');
  const [szeStandValues, setSzeStandValues] = useState({ htzst6: '0', htzst7: '0' });
  const [editBusy, setEditBusy] = useState(false);
  const [einbauEnabled, setEinbauEnabled] = useState(false);
  const [ausbauEnabled, setAusbauEnabled] = useState(false);
  const [szwEnabled, setSzwEnabled] = useState(false);
  const [zlgEnabled, setZlgEnabled] = useState(false);
  const [wsdsEnabled, setWsdsEnabled] = useState(false);
  const [wpEnabled, setWpEnabled] = useState(false);
  const [pvEnabled, setPvEnabled] = useState(false);
  const [haushaltEnabled, setHaushaltEnabled] = useState(false);
  const [gewerbeEnabled, setGewerbeEnabled] = useState(false);
  const [baustromEnabled, setBaustromEnabled] = useState(false);
  const [allgemeinEnabled, setAllgemeinEnabled] = useState(false);
  const [klemmeEnabled, setKlemmeEnabled] = useState(false);
  const [scannerTarget, setScannerTarget] = useState(null);
  const scannerLockRef = React.useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [selectedDate, setSelectedDate] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [bildnummer, setBildnummer] = useState('');
  const [bemerkungen, setBemerkungen] = useState('');
  const [remarkPresets, setRemarkPresets] = useState(DEFAULT_REMARK_PRESETS);
  const [remarkMenuOpen, setRemarkMenuOpen] = useState(false);
  const [newRemarkPreset, setNewRemarkPreset] = useState('');
  const [newRemarkPresetOpen, setNewRemarkPresetOpen] = useState(false);
  const [rseRemarkAuto, setRseRemarkAuto] = useState(false);
  const [selectedFileNameSelection, setSelectedFileNameSelection] = useState({ start: 0, end: 0 });

  function moveSelectedFileNameCursorToEnd(value) {
    const end = String(value || '').length;
    setSelectedFileNameSelection({ start: end, end });
  }

  React.useEffect(() => {
    const onlyRse = rseEnabled && !einbauEnabled && !ausbauEnabled && !szwEnabled && !zlgEnabled;
    if (onlyRse && !bemerkungen.trim()) {
      setBemerkungen(RSE_REMARK_PRESET);
      setRseRemarkAuto(true);
    } else if (!onlyRse && rseRemarkAuto && bemerkungen === RSE_REMARK_PRESET) {
      setBemerkungen('');
      setRseRemarkAuto(false);
    }
  }, [rseEnabled, einbauEnabled, ausbauEnabled, szwEnabled, zlgEnabled, bemerkungen, rseRemarkAuto]);

  React.useEffect(() => {
    setKlemmeEnabled(einbauEnabled || szwEnabled || zlgEnabled);
  }, [einbauEnabled, szwEnabled, zlgEnabled]);

  async function openScanner(target) {
    let permission = cameraPermission;
    if (!permission?.granted) permission = await requestCameraPermission();
    if (!permission?.granted) {
      Alert.alert('Kamerazugriff benötigt', 'Bitte erlaube den Kamerazugriff, damit ein Barcode gescannt werden kann.');
      return;
    }
    scannerLockRef.current = false;
    setScannerTarget(target);
  }

  function handleBarcodeScanned({ data }) {
    if (!data || !scannerTarget || scannerLockRef.current) return;
    scannerLockRef.current = true;
    const target = scannerTarget;
    const rawPayload = String(data);
    setScannerTarget(null);

    if (target === 'einbau') setEinbauWerkNr(rawPayload.trim());
    else if (target === 'ausbau') setAusbauWerkNr(rawPayload.trim());
    else {
      const gateway = extractGatewayWerkNr(rawPayload);
      if (!gateway) {
        Alert.alert('Gateway-QR-Code gelesen', 'Der QR-Code wurde gelesen, enthält aber keine Werknummer im Format EEMH##########.');
        return;
      }
      setGatewayWerkNr(gateway);
    }
  }

  function closeScanner() {
    scannerLockRef.current = true;
    setScannerTarget(null);
  }

  async function choosePdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/zip', 'application/x-rar-compressed', 'application/x-rar'],
      multiple: true,
      copyToCacheDirectory: true
    });
    if (!result.canceled) setSelected(result.assets);
  }

  async function fillPdf() {
    if (!selected.length) return;
    setBusy(true);
    try {
      const mode = await new Promise(resolve => Alert.alert(
        'Speicherformat auswählen',
        'Wie sollen die fertigen PDFs gespeichert werden?',
        [
          { text: 'Als ZIP-Datei', onPress: () => resolve('zip') },
          { text: 'Als einzelne PDFs', onPress: () => resolve('pdfs') },
          { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(null) }
        ],
        { cancelable: true, onDismiss: () => resolve(null) }
      ));
      if (!mode) return;

      const outputDirectory = new Directory(Paths.document, 'MyPDF-Ausgabe');
      outputDirectory.create({ idempotent: true, intermediates: true });
      const sources = [];
      for (const asset of selected) sources.push(...await expandSource(asset));
      const generated = [];
      for (const source of sources) generated.push(await createFilledPdf(source.uri, outputDirectory));

      if (mode === 'zip') {
        const files = Object.fromEntries(generated.map(file => [file.filename, file.bytes]));
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const zipFile = new File(outputDirectory, `Zaehlerwechselbelege_${stamp}.zip`);
        zipFile.write(zipSync(files));
      } else {
        for (const file of generated) {
          const outputFile = new File(outputDirectory, file.filename);
          outputFile.write(file.bytes);
        }
      }
      Alert.alert('Fertig', `${generated.length} PDF${generated.length === 1 ? '' : 's'} wurden in „MyPDF-Ausgabe“ gespeichert.`);
    } catch (error) {
      Alert.alert('Fehler', error.message || 'Die PDF konnte nicht verarbeitet werden.');
    } finally { setBusy(false); }
  }

  async function fillRsePdf() {
    const effectiveEinbau = einbauEnabled || szwEnabled;
    const effectiveAusbau = ausbauEnabled || szwEnabled;
    const hasSelection = rseEnabled || effectiveEinbau || effectiveAusbau || zlgEnabled || wsdsEnabled || wpEnabled || pvEnabled || haushaltEnabled || gewerbeEnabled || baustromEnabled || allgemeinEnabled || klemmeEnabled;
    if (!selectedEditPdf || !hasSelection || !selectedDate || (rseEnabled && (!selectedGroup || !werkNr.trim()))) return;
    setEditBusy(true);
    try {
      const outputDirectory = new Directory(Paths.document, 'MyPDF-Ausgabe');
      outputDirectory.create({ idempotent: true, intermediates: true });
      const originalSourceName = selectedEditPdf.name || 'Zaehlerwechselbeleg.pdf';
      const sourceName = ensurePdfFilename(selectedEditPdfName, originalSourceName);
      const sourceBaseName = sourceName.replace(/\.pdf$/i, '');
      const originalBaseName = cleanFilenamePart(originalSourceName.replace(/\.pdf$/i, ''));
      const customFilenameBase = cleanFilenamePart(selectedEditPdfName).replace(/\.pdf$/i, '').trim();
      const hasCustomFilename = Boolean(customFilenameBase && customFilenameBase !== originalBaseName);
      const rseOnly = rseEnabled && !effectiveEinbau && !effectiveAusbau && !zlgEnabled;
      const remarkFilenameSuffix = getRemarkFilenameSuffix(bemerkungen);
      const outputFilename = remarkFilenameSuffix
        ? `${cleanFilenamePart(sourceBaseName)}, ${remarkFilenameSuffix}.pdf`
        : rseOnly
          ? `${cleanFilenamePart(sourceBaseName)}, iMSys RSE nachgerüstet.pdf`
          : hasCustomFilename
            ? `${cleanFilenamePart(sourceBaseName)}.pdf`
            : `${cleanFilenamePart(sourceBaseName)}_bearbeitet.pdf`;
      const outputFile = new File(outputDirectory, outputFilename);
      outputFile.write(await createRsePdf(selectedEditPdf.uri, rseEnabled ? selectedGroup : null, werkNr, selectedDate, effectiveEinbau, effectiveAusbau, zlgEnabled, wsdsEnabled, wpEnabled, pvEnabled, haushaltEnabled, gewerbeEnabled, baustromEnabled, allgemeinEnabled, klemmeEnabled, einbauWerkNr, ausbauWerkNr, gatewayWerkNr, gatewayType, szaType, szaStandValues, szeType, szeStandValues, bemerkungen, bildnummer));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(outputFile.uri, {
          dialogTitle: 'Bearbeitete PDF Vorschau',
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf'
        });
      } else {
        Alert.alert('Gespeichert', 'Die bearbeitete PDF wurde in „MyPDF-Ausgabe“ gespeichert.');
      }
    } catch (error) {
      Alert.alert('Fehler', error.message || 'Die PDF konnte nicht bearbeitet werden.');
    } finally {
      setEditBusy(false);
    }
  }

  async function chooseEditPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true
    });
    if (!result.canceled) {
      const selectedAsset = result.assets[0];
      try {
        if (REMARK_PRESETS_FILE.exists) {
          const savedPresets = JSON.parse(await REMARK_PRESETS_FILE.text());
          if (Array.isArray(savedPresets) && savedPresets.length) {
            const customPresets = savedPresets.filter(value => typeof value === 'string' && value.trim() && !LEGACY_REMARK_PRESETS.has(value.trim()));
            setRemarkPresets([...new Set([...DEFAULT_REMARK_PRESETS, ...customPresets])].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })));
          }
        }
      } catch (_) {}
      const detectedGroup = inferEegGroupFromFilename(selectedAsset.name || selectedAsset.uri || '');
      setSelectedEditPdf(selectedAsset);
      setSelectedEditPdfName(removePdfExtension(selectedAsset.name || 'Zaehlerwechselbeleg.pdf'));
      setSelectedFileNameSelection({ start: 0, end: 0 });
      setRseEnabled(false);
      setSelectedGroup(detectedGroup || EEG_GROUPS[0]);
      setGroupAutoDetected(Boolean(detectedGroup));
      setGroupMenuOpen(false);
      setWerkNr('');
      setEinbauEnabled(false);
      setAusbauEnabled(false);
      setSzwEnabled(false);
      setZlgEnabled(false);
      setWsdsEnabled(false);
      setEinbauWerkNr('');
      setAusbauWerkNr('');
      setGatewayWerkNr('');
      setGatewayType('Draht');
      setSzaType('DS');
      setSzaStandValues({});
      setSzeType('ZRZ');
      setSzeStandValues({ htzst6: '0', htzst7: '0' });
      setWpEnabled(false);
      setPvEnabled(false);
      setHaushaltEnabled(false);
      setGewerbeEnabled(false);
      setBaustromEnabled(false);
      setAllgemeinEnabled(false);
      setKlemmeEnabled(false);
      setSelectedDate(null);
      setCalendarOpen(false);
      setBildnummer('');
      setBemerkungen('');
      setRseRemarkAuto(false);
      setRemarkMenuOpen(false);
      setNewRemarkPreset('');
      setNewRemarkPresetOpen(false);
      setEditScreen(true);
    }
  }

  async function saveRemarkPreset() {
    const value = newRemarkPreset.trim();
    if (!value) return;
    const nextPresets = [...new Set([...remarkPresets, value])].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
    setRemarkPresets(nextPresets);
    setBemerkungen(value);
    setRseRemarkAuto(false);
    setNewRemarkPreset('');
    setNewRemarkPresetOpen(false);
    setRemarkMenuOpen(false);
    try {
      REMARK_PRESETS_FILE.write(JSON.stringify(nextPresets));
    } catch (_) {}
  }

  if (editScreen) {
    return (
      <SafeAreaView style={styles.safe}>
        <Modal visible={Boolean(scannerTarget)} animationType="slide" onRequestClose={closeScanner}>
          <View style={styles.scannerScreen}>
            <CameraView
              style={styles.camera}
              facing="back"
              onBarcodeScanned={scannerTarget ? handleBarcodeScanned : undefined}
              barcodeScannerSettings={{ barcodeTypes: scannerTarget === 'gateway' ? GATEWAY_2D_CODE_TYPES : WORK_NUMBER_BARCODE_TYPES }}
            />
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <Text style={styles.scannerEyebrow}>SCANNER</Text>
                <Text style={styles.scannerTitle}>{scannerTarget === 'einbau' ? 'Werk Nr. Einbau' : scannerTarget === 'ausbau' ? 'Werk Nr. Ausbau' : 'Werk Nr. Gateway'}</Text>
                <Text style={styles.scannerHint}>{scannerTarget === 'gateway' ? 'QR-/2D-Code in den Rahmen halten.' : 'Barcode in den Rahmen halten.'}</Text>
              </View>
              <View style={styles.scanFrame}>
                <View style={styles.scanFrameLine} />
              </View>
              <View style={styles.scannerStatus}><View style={styles.scannerStatusDot} /><Text style={styles.scannerStatusText}>Bereit zum Erfassen</Text></View>
              <Pressable style={styles.scannerCloseButton} onPress={closeScanner}>
                <Text style={styles.primaryButtonText}>Abbrechen</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.editContainer}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
          >
          <Pressable onPress={() => setEditScreen(false)} style={styles.backButton}>
            <Text style={styles.backText}>‹ Zurück</Text>
          </Pressable>
          <Text style={styles.title}>PDF bearbeiten</Text>
          <Text style={styles.subtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Zählerwechselbeleg ausfüllen</Text>
          <Text style={styles.selectedFileTitle}>Ausgewählte PDF</Text>
          <TextInput
            value={selectedEditPdfName}
            onChangeText={value => { setSelectedEditPdfName(value); moveSelectedFileNameCursorToEnd(value); }}
            onFocus={() => moveSelectedFileNameCursorToEnd(selectedEditPdfName)}
            selection={selectedFileNameSelection}
            placeholder="Dateiname eingeben"
            placeholderTextColor="#8a96aa"
            style={styles.selectedFileNameInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            multiline
            numberOfLines={2}
            textAlignVertical="top"
          />

          <View style={styles.card}>
            <Text style={[styles.sectionTitle, styles.compactSectionTitle]}>Datum:</Text>
            <Pressable style={styles.dateButton} onPress={() => setCalendarOpen(open => !open)}>
              <Text style={[styles.dateButtonText, selectedDate && styles.dateButtonValue]}>{selectedDate ? formatPdfDate(selectedDate) : 'Datum auswählen'}</Text>
              <Text style={styles.dateButtonArrow}>{calendarOpen ? '⌃' : '⌄'}</Text>
            </Pressable>
            {calendarOpen && <MiniCalendar value={selectedDate} onChange={date => { setSelectedDate(date); setCalendarOpen(false); }} />}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Grund:</Text>
            <View style={styles.checkboxGrid}>
            <Pressable style={styles.checkboxGridItem} onPress={() => setEinbauEnabled(value => !value)}>
              <View style={[styles.checkbox, einbauEnabled && styles.checkboxChecked]}>{einbauEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
              <Text style={styles.checkboxLabel}>SZE</Text>
            </Pressable>
            <Pressable style={styles.checkboxGridItem} onPress={() => setAusbauEnabled(value => !value)}>
              <View style={[styles.checkbox, ausbauEnabled && styles.checkboxChecked]}>{ausbauEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
              <Text style={styles.checkboxLabel}>SZA</Text>
            </Pressable>
            <Pressable style={styles.checkboxGridItem} onPress={() => setSzwEnabled(value => !value)}>
              <View style={[styles.checkbox, szwEnabled && styles.checkboxChecked]}>{szwEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
              <Text style={styles.checkboxLabel}>SZW</Text>
            </Pressable>
            <Pressable style={styles.checkboxGridItem} onPress={() => setZlgEnabled(value => !value)}>
              <View style={[styles.checkbox, zlgEnabled && styles.checkboxChecked]}>{zlgEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
              <Text style={styles.checkboxLabel}>ZLG</Text>
            </Pressable>
            <Pressable style={styles.checkboxGridItem} onPress={() => setWsdsEnabled(value => !value)}>
              <View style={[styles.checkbox, wsdsEnabled && styles.checkboxChecked]}>{wsdsEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
              <Text style={styles.checkboxLabel}>WS/DS</Text>
            </Pressable>
            <Pressable style={styles.checkboxGridItem} onPress={() => setRseEnabled(value => !value)}>
              <View style={[styles.checkbox, rseEnabled && styles.checkboxChecked]}>
                {rseEnabled && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>RSE</Text>
            </Pressable>
            </View>

            {rseEnabled && <>
              <Text style={styles.label}>EEG-Gruppe</Text>
              <Pressable style={styles.dropdown} onPress={() => setGroupMenuOpen(value => !value)}>
                <Text style={styles.dropdownText}>{selectedGroup}</Text>
                <Text style={styles.dropdownArrow}>{groupMenuOpen ? '⌃' : '⌄'}</Text>
              </Pressable>
              {groupMenuOpen && <View style={styles.dropdownMenu}>
                {EEG_GROUPS.map(group => <Pressable key={group} style={styles.dropdownItem} onPress={() => { setSelectedGroup(group); setGroupAutoDetected(false); setGroupMenuOpen(false); }}>
                  <Text style={styles.dropdownItemText}>{group}</Text>
                </Pressable>)}
              </View>}
              <Text style={styles.label}>Werk Nr.</Text>
              <TextInput
                value={werkNr}
                onChangeText={value => setWerkNr(value.replace(/[^0-9]/g, ''))}
                placeholder="Werknummer eingeben"
                placeholderTextColor="#8a96aa"
                style={styles.input}
                keyboardType="numeric"
                inputMode="numeric"
              />
              <Text style={styles.hint}>Typ: LCR 160 · Code: {`613/${String(5 + Number(selectedGroup.slice(-2))).padStart(2, '0')}`}</Text>
            </>}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Zählernummern:</Text>
            <View style={[styles.subsectionCard, styles.subsectionAusbau]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleAusbau]}>Ausbau</Text>
              <Text style={styles.label}>Werk Nr. Ausbau</Text>
              <View style={styles.scannerInputRow}>
                <TextInput value={ausbauWerkNr} onChangeText={setAusbauWerkNr} placeholder="Werknummer eingeben oder scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('ausbau')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {ausbauWerkNr.trim() && <>
                <Text style={styles.label}>Ausbauart</Text>
                <View style={styles.szaTypeRow}>
                  {SZA_TYPES.map(type => <Pressable key={type} style={[styles.gatewayTypeButton, szaType === type && styles.gatewayTypeButtonSelected]} onPress={() => setSzaType(type)}>
                    <Text style={[styles.gatewayTypeText, szaType === type && styles.gatewayTypeTextSelected]}>{type}</Text>
                  </Pressable>)}
                </View>
                <View style={styles.szaStandGrid}>
                  {(SZA_STAND_FIELDS[szaType] || []).map(standField => <View key={standField.field} style={styles.szaStandItem}>
                    {standField.label ? <Text style={styles.szaStandLabel}>{standField.label}</Text> : null}
                    <TextInput
                      value={szaStandValues[standField.field] || ''}
                      onChangeText={value => setSzaStandValues(current => ({ ...current, [standField.field]: szaType === 'ALT' ? value.replace(/[^0-9,]/g, '') : value.replace(/[^0-9]/g, '') }))}
                      placeholder={standField.label ? 'Stand eingeben' : 'Stand eingeben'}
                      placeholderTextColor="#8a96aa"
                      style={styles.szaStandInput}
                      keyboardType={szaType === 'ALT' ? 'decimal-pad' : 'numeric'}
                      inputMode={szaType === 'ALT' ? 'decimal' : 'numeric'}
                    />
                  </View>)}
                </View>
              </>}
            </View>

            <View style={[styles.subsectionCard, styles.subsectionEinbau]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleEinbau]}>Einbau</Text>
              <Text style={styles.label}>Werk Nr. Einbau</Text>
              <View style={styles.scannerInputRow}>
                <TextInput value={einbauWerkNr} onChangeText={setEinbauWerkNr} placeholder="Werknummer eingeben oder scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('einbau')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {(einbauEnabled || szwEnabled) && einbauWerkNr.trim() && <>
                <Text style={styles.label}>Einbauart</Text>
                <View style={styles.szaTypeRow}>
                  {SZE_TYPES.map(type => <Pressable key={type} style={[styles.gatewayTypeButton, szeType === type && styles.gatewayTypeButtonSelected]} onPress={() => setSzeType(type)}>
                    <Text style={[styles.gatewayTypeText, szeType === type && styles.gatewayTypeTextSelected]}>{type}</Text>
                  </Pressable>)}
                </View>
                <View style={styles.szaStandGrid}>
                  {(SZE_STAND_FIELDS[szeType] || []).map(standField => <View key={standField.field} style={styles.szaStandItem}>
                    <Text style={styles.szaStandLabel}>{standField.label}</Text>
                    <TextInput
                      value={szeStandValues[standField.field] || ''}
                      onChangeText={value => setSzeStandValues(current => ({ ...current, [standField.field]: value.replace(/[^0-9]/g, '') }))}
                      placeholder="Stand eingeben"
                      placeholderTextColor="#8a96aa"
                      style={styles.szaStandInput}
                      keyboardType="numeric"
                      inputMode="numeric"
                    />
                  </View>)}
                </View>
              </>}
            </View>

            <View style={[styles.subsectionCard, styles.subsectionGateway]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleGateway]}>Gateway</Text>
              <Text style={styles.label}>Werk Nr. Gateway (optional)</Text>
              <View style={styles.scannerInputRow}>
                <TextInput value={gatewayWerkNr} onChangeText={setGatewayWerkNr} placeholder="Werknummer eingeben oder QR scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('gateway')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {gatewayWerkNr.trim() && <>
                <Text style={styles.label}>Übertragung Gateway</Text>
                <View style={styles.gatewayTypeRow}>
                  {['Draht', 'Funk'].map(type => <Pressable key={type} style={[styles.gatewayTypeButton, gatewayType === type && styles.gatewayTypeButtonSelected]} onPress={() => setGatewayType(type)}>
                    <Text style={[styles.gatewayTypeText, gatewayType === type && styles.gatewayTypeTextSelected]}>{type}</Text>
                  </Pressable>)}
                </View>
              </>}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Kundengruppe:</Text>
            <View style={styles.checkboxGrid}>
              <Pressable style={styles.checkboxGridItem} onPress={() => setWpEnabled(value => !value)}>
                <View style={[styles.checkbox, wpEnabled && styles.checkboxChecked]}>{wpEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>WP</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setPvEnabled(value => !value)}>
                <View style={[styles.checkbox, pvEnabled && styles.checkboxChecked]}>{pvEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>PV</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setHaushaltEnabled(value => !value)}>
                <View style={[styles.checkbox, haushaltEnabled && styles.checkboxChecked]}>{haushaltEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>Haushalt</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setGewerbeEnabled(value => !value)}>
                <View style={[styles.checkbox, gewerbeEnabled && styles.checkboxChecked]}>{gewerbeEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>Gewerbe</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setBaustromEnabled(value => !value)}>
                <View style={[styles.checkbox, baustromEnabled && styles.checkboxChecked]}>{baustromEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>Baustrom</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setAllgemeinEnabled(value => !value)}>
                <View style={[styles.checkbox, allgemeinEnabled && styles.checkboxChecked]}>{allgemeinEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>Allgemein</Text>
              </Pressable>
              <Pressable style={styles.checkboxGridItem} onPress={() => setKlemmeEnabled(value => !value)}>
                <View style={[styles.checkbox, klemmeEnabled && styles.checkboxChecked]}>{klemmeEnabled && <Text style={styles.checkmark}>✓</Text>}</View>
                <Text style={styles.checkboxLabel}>Steckklemme</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Bildnummer:</Text>
            <TextInput
              value={bildnummer}
              onChangeText={value => setBildnummer(value.replace(/,/g, '.').replace(/[^0-9.]/g, ''))}
              placeholder="Bildnummer eingeben"
              placeholderTextColor="#8a96aa"
              style={styles.input}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Bemerkungen:</Text>
            <TextInput
              value={bemerkungen}
              onChangeText={value => { setBemerkungen(value); setRseRemarkAuto(false); }}
              placeholder="Bemerkung eingeben"
              placeholderTextColor="#8a96aa"
              style={styles.remarksInput}
              multiline
              textAlignVertical="top"
            />
            <Pressable style={styles.remarkPresetToggle} onPress={() => setRemarkMenuOpen(open => !open)}>
              <Text style={styles.remarkPresetToggleText}>Bemerkung auswählen</Text>
              <View style={styles.remarkPresetArrow}><Text style={styles.remarkPresetArrowText}>{remarkMenuOpen ? '⌃' : '⌄'}</Text></View>
            </Pressable>
            {remarkMenuOpen && <View style={styles.remarkPresetMenu}>
              {remarkPresets.map(preset => <Pressable key={preset} style={styles.remarkPresetItem} onPress={() => { setBemerkungen(preset); setRseRemarkAuto(false); setRemarkMenuOpen(false); }}>
                <Text style={styles.remarkPresetText}>{preset}</Text>
              </Pressable>)}
            </View>}
            {!newRemarkPresetOpen && <Pressable style={styles.savePresetButton} onPress={() => setNewRemarkPresetOpen(true)}>
              <Text style={styles.savePresetButtonText}>Neue Vorlage speichern</Text>
            </Pressable>}
            {newRemarkPresetOpen && <View style={styles.newPresetRow}>
              <TextInput
                value={newRemarkPreset}
                onChangeText={setNewRemarkPreset}
                placeholder="Neue Vorlage"
                placeholderTextColor="#8a96aa"
                style={[styles.input, styles.newPresetInput]}
              />
              <Pressable style={styles.savePresetAction} onPress={saveRemarkPreset}>
                <Text style={styles.savePresetActionText}>Speichern</Text>
              </Pressable>
            </View>}
          </View>

          <Pressable style={[styles.button, styles.primary, (() => { const hasSelection = rseEnabled || einbauEnabled || ausbauEnabled || szwEnabled || zlgEnabled || wsdsEnabled || wpEnabled || pvEnabled || haushaltEnabled || gewerbeEnabled || baustromEnabled || allgemeinEnabled || klemmeEnabled; return !selectedEditPdf || !hasSelection || !selectedDate || (rseEnabled && !werkNr.trim()) || editBusy; })() && styles.disabled]} disabled={(() => { const hasSelection = rseEnabled || einbauEnabled || ausbauEnabled || szwEnabled || zlgEnabled || wsdsEnabled || wpEnabled || pvEnabled || haushaltEnabled || gewerbeEnabled || baustromEnabled || allgemeinEnabled || klemmeEnabled; return !selectedEditPdf || !hasSelection || !selectedDate || (rseEnabled && !werkNr.trim()) || editBusy; })()} onPress={fillRsePdf}>
            {editBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>PDF erstellen und speichern</Text>}
          </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>MyPDFTool</Text>
        <Text style={styles.subtitle}>Zählerwechselbeleg ausfüllen</Text>
        <Text style={styles.help}>Wähle einzelne PDFs oder ZIP-/RAR-Dateien aus. Jede enthaltene PDF wird separat gelesen und ausgefüllt.</Text>
        <Pressable style={styles.button} onPress={choosePdf}><Text style={styles.buttonText}>Quellen auswählen</Text></Pressable>
        {selected.length > 0 && <Text style={styles.file}>{selected.length} Quelle{selected.length === 1 ? '' : 'n'} ausgewählt</Text>}
        <Pressable style={[styles.button, styles.primary, (!selected.length || busy) && styles.disabled]} disabled={!selected.length || busy} onPress={fillPdf}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>PDFs ausfüllen und speichern</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={chooseEditPdf}>
          <Text style={styles.buttonText}>PDF bearbeiten</Text>
        </Pressable>
        <Text style={styles.note}>Die fertigen Dateien werden direkt im iPhone-Dateien-Ordner „MyPDF-Ausgabe“ gespeichert.</Text>
        <Text style={styles.version}>Update Version 1.3</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  keyboardAvoiding: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 34, fontWeight: '700', color: '#172033' },
  subtitle: { fontSize: 19, marginTop: 6, color: '#3d4c68' },
  help: { fontSize: 16, lineHeight: 24, marginTop: 28, color: '#53627b' },
  button: { minHeight: 54, borderRadius: 12, backgroundColor: '#dce4f2', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primary: { backgroundColor: '#2457d6', marginTop: 12 },
  disabled: { opacity: 0.45 },
  buttonText: { color: '#172033', fontSize: 17, fontWeight: '600' },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { backgroundColor: '#eef2f8', marginTop: 12, borderWidth: 1, borderColor: '#cbd5e5' },
  file: { marginTop: 14, color: '#2457d6', fontSize: 14 },
  selectedFileTitle: { marginTop: 24, color: '#53627b', fontSize: 13, fontWeight: '600' },
  selectedFileName: { marginTop: 4, color: '#172033', fontSize: 16, fontWeight: '600' },
  selectedFileNameInput: { marginTop: 4, minHeight: 84, height: 84, paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, color: '#172033', fontSize: 16, fontWeight: '600', lineHeight: 24, backgroundColor: '#fff' },
  note: { marginTop: 28, color: '#71809a', lineHeight: 20, textAlign: 'center' },
  remarksInput: { minHeight: 78, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, color: '#172033', fontSize: 16, backgroundColor: '#f8fafc' },
  remarkPresetToggle: { marginTop: 10, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2457d6', borderRadius: 10, backgroundColor: '#2457d6', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remarkPresetToggleText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  remarkPresetArrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  remarkPresetArrowText: { color: '#fff', fontSize: 18, lineHeight: 20 },
  remarkPresetMenu: { marginTop: 4, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  remarkPresetItem: { paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#eef2f8' },
  remarkPresetText: { color: '#172033', fontSize: 15 },
  savePresetButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6 },
  savePresetButtonText: { color: '#2457d6', fontSize: 14, fontWeight: '600' },
  newPresetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  newPresetInput: { flex: 1, minHeight: 44, fontSize: 14 },
  savePresetAction: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#2457d6', alignItems: 'center', justifyContent: 'center' },
  savePresetActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  version: { position: 'absolute', right: 12, bottom: 8, color: '#9aa5b8', fontSize: 11 },
  editContainer: { padding: 24, paddingBottom: 300 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 18 },
  backText: { color: '#2457d6', fontSize: 17, fontWeight: '600' },
  card: { marginTop: 26, padding: 20, borderRadius: 16, backgroundColor: '#fff', shadowColor: '#172033', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  subsectionCard: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  subsectionAusbau: { backgroundColor: '#f2f6ff', borderColor: '#c3d2f4' },
  subsectionEinbau: { backgroundColor: '#f1fbf6', borderColor: '#bfe3cd' },
  subsectionGateway: { backgroundColor: '#f7f9fc', borderColor: '#dbe3ef' },
  subsectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  subsectionTitleAusbau: { color: '#2457d6' },
  subsectionTitleEinbau: { color: '#198754' },
  subsectionTitleGateway: { color: '#53627b' },
  sectionTitle: { color: '#172033', fontSize: 19, fontWeight: '700', marginBottom: 18 },
  compactSectionTitle: { marginBottom: 4 },
  sectionHint: { color: '#71809a', fontSize: 13, lineHeight: 19, marginTop: -8 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#9aa5b8', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  checkboxChecked: { backgroundColor: '#2457d6', borderColor: '#2457d6' },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 17 },
  checkboxLabel: { color: '#172033', fontSize: 17, fontWeight: '600' },
  checkboxGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  checkboxGridItem: { width: '48%', flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  label: { color: '#53627b', fontSize: 14, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  dropdown: { minHeight: 50, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc' },
  dropdownText: { color: '#172033', fontSize: 16 },
  dropdownArrow: { color: '#53627b', fontSize: 20 },
  dropdownMenu: { marginTop: 4, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef2f8' },
  dropdownItemText: { color: '#172033', fontSize: 16 },
  dropdownItemTextSelected: { color: '#2457d6', fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 14, color: '#172033', fontSize: 16, backgroundColor: '#f8fafc' },
  scannerInputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scannerInput: { flex: 1, paddingHorizontal: 6, fontSize: 14.5, fontWeight: '600', letterSpacing: -0.1, textAlign: 'center' },
  readOnlyInput: { color: '#53627b' },
  scanButton: { minHeight: 44, width: 70, marginLeft: 'auto', borderRadius: 10, backgroundColor: '#2457d6', alignItems: 'center', justifyContent: 'center' },
  scanButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  gatewayTypeRow: { flexDirection: 'row', gap: 8 },
  gatewayTypeButton: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e5', backgroundColor: '#eef2f8', alignItems: 'center', justifyContent: 'center' },
  gatewayTypeButtonSelected: { borderColor: '#2457d6', backgroundColor: '#2457d6' },
  gatewayTypeText: { color: '#172033', fontSize: 15, fontWeight: '700' },
  gatewayTypeTextSelected: { color: '#fff' },
  szaTypeRow: { flexDirection: 'row', gap: 6 },
  szaStandGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  szaStandItem: { flex: 1, minWidth: 120 },
  szaStandLabel: { color: '#53627b', fontSize: 14, fontWeight: '700', marginBottom: 6 },
  szaStandInput: { minHeight: 42, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 12, color: '#172033', fontSize: 16, backgroundColor: '#f8fafc' },
  scannerScreen: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  scannerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', paddingTop: 54, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.18)' },
  scannerHeader: { width: '100%', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16, backgroundColor: 'rgba(10,18,35,0.72)' },
  scannerEyebrow: { color: '#9fb8ff', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  scannerTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 4 },
  scannerHint: { color: '#e7ecf8', fontSize: 15, marginTop: 8, textAlign: 'center' },
  scanFrame: { width: '88%', height: 190, marginTop: 58, borderWidth: 2, borderColor: '#fff', borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' },
  scanFrameLine: { width: '88%', height: 2, backgroundColor: '#65a4ff', shadowColor: '#65a4ff', shadowOpacity: 0.9, shadowRadius: 8 },
  scannerStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 18, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(10,18,35,0.72)' },
  scannerStatusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#4ade80', marginRight: 8 },
  scannerStatusText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  scannerCloseButton: { position: 'absolute', bottom: 42, left: 24, right: 24, minHeight: 52, borderRadius: 12, backgroundColor: '#2457d6', alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: 16, color: '#71809a', fontSize: 13, lineHeight: 19 },
  autoGroupHint: { marginTop: 8, color: '#2457d6', fontSize: 13, fontWeight: '600' },
  dateValue: { marginLeft: 'auto', color: '#2457d6', fontSize: 16, fontWeight: '600' },
  dateButton: { minHeight: 50, marginTop: 0, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', position: 'relative', backgroundColor: '#eef2f8' },
  dateButtonText: { flex: 1, color: '#172033', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  dateButtonValue: { fontSize: 18, fontWeight: '700' },
  dateButtonArrow: { position: 'absolute', right: 14, color: '#53627b', fontSize: 20, fontWeight: '700' },
  calendar: { marginTop: 4, padding: 12, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e1e7f0' },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calendarArrow: { width: 38, height: 36, alignItems: 'center', justifyContent: 'center' },
  calendarArrowText: { color: '#2457d6', fontSize: 30, lineHeight: 32 },
  monthTitleButton: { paddingHorizontal: 12, paddingVertical: 8 },
  monthTitle: { color: '#172033', fontSize: 16, fontWeight: '700' },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { width: '14.2857%', textAlign: 'center', color: '#71809a', fontSize: 12, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2857%', height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  dayCellSelected: { backgroundColor: '#2457d6' },
  dayText: { color: '#172033', fontSize: 15 },
  dayTextSelected: { color: '#fff', fontWeight: '700' },
  monthMenu: { marginBottom: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e5', overflow: 'hidden' },
  monthItem: { paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#eef2f8' },
  monthItemSelected: { backgroundColor: '#e8efff' },
  monthItemText: { color: '#172033', fontSize: 14 },
  monthItemTextSelected: { color: '#2457d6', fontWeight: '700' }
});
