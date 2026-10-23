import React, { useState } from 'react';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import {
  PDFBool,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  degrees,
  drawText,
  rgb
} from 'pdf-lib';
import pako from 'pako/dist/pako.cjs.js';
import { zipSync } from 'fflate';
import sourceParser from './sourceParser';

const templateAsset = require('./assets/blanko.pdf');
const FORM_FONT_SIZE = 0;
const CHECKBOX_FONT_SIZE = 9;
const PDF_CHECKBOX_FIELDS = new Set([
  'Herrn', 'Frau', 'Herrn und Frau', 'An', 'Sonderablesegebiet',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
  ...Array.from({ length: 16 }, (_, index) => String(index + 1))
]);
// All small text fields in the template are checkbox slots. They are rendered
// statically whenever the app changes them, so no viewer has to interpret a
// text-field appearance or an interactive checkbox state.
const STATIC_CHECKBOX_FIELDS = PDF_CHECKBOX_FIELDS;
const GATEWAY_2D_CODE_TYPES = ['qr', 'datamatrix', 'aztec', 'pdf417'];
const WORK_NUMBER_BARCODE_TYPES = ['ean13', 'ean8', 'code128', 'code39', 'itf14', 'upc_a', 'upc_e'];
const RSE_REMARK_PRESET = 'iMSys RSE nachgerüstet';
const DEFAULT_REMARK_PRESETS = ['Antenne außen', 'Antenne innen (Unterputzschrank)', RSE_REMARK_PRESET, 'Kaskade Z1', 'Kaskade Z2', 'Meterpay'].sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
const LEGACY_REMARK_PRESETS = new Set(['Keine Besonderheiten', 'Kunde informiert', 'Zugang nicht möglich']);
const REMARK_PRESETS_FILE = new File(Paths.document, 'MyPDFTool-Bemerkungsvorlagen.json');
const SOURCE_DIRECTORY_NAME = 'MyPDF-Quellen';
const EDIT_DIRECTORY_NAME = 'MyPDF-Ausgabe';
const FINISHED_DIRECTORY_NAME = 'MyPDF-Fertig';

function getAppDirectory(name) {
  const directory = new Directory(Paths.document, name);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function confirmFileReplacement(file) {
  if (!file.exists) return Promise.resolve(true);
  return new Promise(resolve => Alert.alert(
    'Datei bereits vorhanden',
    `Die Datei „${file.name}“ existiert bereits. Soll sie ersetzt werden?`,
    [
      { text: 'Behalten', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Ersetzen', style: 'destructive', onPress: () => resolve(true) }
    ],
    { cancelable: false }
  ));
}

function saveFileBytes(file, bytes) {
  file.parentDirectory.create({ idempotent: true, intermediates: true });
  file.create({ overwrite: true, intermediates: true });
  file.write(bytes);
}

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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePostalLocation(postal, rawLocation) {
  const area = POSTAL_AREAS[postal];
  if (!area) return { gemeinde: rawLocation, ortsteil: '' };
  const raw = String(rawLocation || '').trim();
  const normalized = normalizeLocation(raw);
  const municipality = normalizeLocation(area.gemeinde);
  const ortsteil = area.ortsteile
    .filter(value => normalizeLocation(value) !== municipality && normalized.includes(normalizeLocation(value)))
    .sort((left, right) => normalizeLocation(right).length - normalizeLocation(left).length)[0] || '';
  if (ortsteil) return { gemeinde: area.gemeinde, ortsteil };

  // Manual sources use the format "PLZ Gemeinde Ortsteil". If the district
  // is not in the lookup list, preserve the text after the municipality so it
  // can still be used in the PDF and in the generated filename.
  const remainderMatch = raw.match(new RegExp(`^${escapeRegExp(area.gemeinde)}(?:\\s+|\\s*[,;/|-]\\s*)(.+)$`, 'iu'));
  const remainder = remainderMatch?.[1]?.trim() || '';
  return {
    gemeinde: area.gemeinde,
    ortsteil: remainder && normalizeLocation(remainder) !== municipality ? remainder : ''
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

function hasCustomFilename(value, originalName) {
  const currentBaseName = removePdfExtension(value);
  const originalBaseName = removePdfExtension(originalName) || 'Zaehlerwechselbeleg';
  return Boolean(currentBaseName && currentBaseName !== originalBaseName);
}

function hasNumericStandValue(value, allowComma = false) {
  const normalized = String(value || '').trim();
  return allowComma ? /^\d+,\d$/.test(normalized) : /^\d+$/.test(normalized);
}

function sanitizeAltStandValue(value) {
  const sanitized = String(value || '').replace(/[^0-9,]/g, '');
  const commaIndex = sanitized.indexOf(',');
  if (commaIndex < 0) return sanitized;
  const wholePart = sanitized.slice(0, commaIndex);
  const decimalPart = sanitized.slice(commaIndex + 1).replace(/,/g, '').slice(0, 1);
  return `${wholePart},${decimalPart}`;
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
  const filenameSuffixes = [RSE_REMARK_PRESET, 'iMSys Kaskade Z1', 'iMSys Kaskade Z2', 'Kaskade Z1', 'Kaskade Z2', 'Meterpay'];
  return filenameSuffixes.find(suffix => normalizedRemark === suffix.toLocaleLowerCase('de-DE')) || '';
}

function getSourceFilenamePlace(values) {
  return values['Ortsteil  FlurstückNr  Etage'] || values['Ort'] || values['Ort_2'] || '';
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

function parseManualSourceData(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 3 && lines.length !== 4) {
    throw new Error('Bitte genau 3 Zeilen (Name, Adresse, PLZ/Ort) oder 4 Zeilen (mit Firma) eingeben.');
  }
  const hasCompany = lines.length === 4;
  const nameParts = lines[0].split(/\s+/).filter(Boolean);
  const customer = {
    vorname: nameParts.slice(0, -1).join(' '),
    name: nameParts[nameParts.length - 1] || '',
    firma: hasCompany ? lines[1] : '',
    strasse: '',
    hausnummer: '',
    plz: '',
    ort: ''
  };
  const addressLine = lines[hasCompany ? 2 : 1];
  const address = parseAddressLine(addressLine);
  if (address) {
    customer.strasse = address.street;
    customer.hausnummer = address.houseNumber;
  } else {
    customer.strasse = addressLine;
  }
  const postal = parsePostalLine(lines[hasCompany ? 3 : 2]);
  if (postal) {
    customer.plz = postal[1];
    customer.ort = postal[2];
  } else {
    customer.ort = lines[hasCompany ? 3 : 2];
  }
  const customerLocation = resolvePostalLocation(customer.plz, customer.ort);
  return {
    'Name': customer.name,
    'Vorname': customer.vorname,
    'Geburtsdatum bei Privatpersonen bzw RegistergerichtRegisternummer der Firma': customer.firma,
    'Straße': customer.strasse,
    'HausNr': customer.hausnummer,
    'Postleitzahl_2': customer.plz,
    'Ort_2': customer.plz ? customerLocation.gemeinde : customer.ort,
    'Telefon Fax EMail': '',
    P: '',
    Q: '',
    R: '',
    'Straße ggf Anschlussnutzer': customer.strasse,
    'HausNr ggf Anschlussnutzer': customer.hausnummer,
    'Postleitzahl': customer.plz,
    'Ort': customer.plz ? customerLocation.gemeinde : customer.ort,
    'Ortsteil  FlurstückNr  Etage': customerLocation.ortsteil
  };
}

async function createFilledPdfFromValues(values) {
  const template = await Asset.loadAsync(templateAsset);
  const targetPdf = await PDFDocument.load(await readPdf(template[0].localUri || template[0].uri));
  const targetForm = targetPdf.getForm();
  let filled = 0;

  for (const [fieldName, value] of Object.entries(values)) {
    try {
      const field = targetForm.getTextField(fieldName);
      field.setText(value || '');
      field.setFontSize(PDF_CHECKBOX_FIELDS.has(fieldName) ? CHECKBOX_FONT_SIZE : FORM_FONT_SIZE);
      filled++;
    } catch (_) {}
  }
  if (filled === 0) throw new Error('Die Quelldatei konnte nicht gelesen werden. Bitte die Antragsdaten-PDF auswählen.');

  await updateAutoSizedFormAppearances(targetPdf, targetForm);
  const outputBytes = await targetPdf.save({ updateFieldAppearances: false });
  const address = [values['Straße ggf Anschlussnutzer'], values['HausNr ggf Anschlussnutzer']]
    .filter(Boolean).join(' ');
  const place = getSourceFilenamePlace(values);
  const filename = [values.Name, address, place].map(cleanFilenamePart).filter(Boolean).join(', ') || 'Zaehlerwechselbeleg';
  return { filename: `${filename}, .pdf`, bytes: outputBytes, filled };
}

async function updateAutoSizedFormAppearances(targetPdf, targetForm) {
  const fontResources = targetPdf.context.lookup(targetForm.acroForm.dict.get(PDFName.of('DR')))?.get(PDFName.of('Font'));
  const arialRef = fontResources && targetPdf.context.lookup(fontResources).get(PDFName.of('Arial'));
  const font = arialRef
    ? PDFFont.of(arialRef, targetPdf, new StandardFontEmbedder(StandardFonts.Helvetica, 'Arial'))
    : await targetPdf.embedFont(StandardFonts.Helvetica);
  if (arialRef) font.name = 'Arial';
  // Update only fields that were actually changed. In particular, do not run
  // pdf-lib's global updater for checkbox fields: its default text-field
  // appearance redraws the widget rectangle and can alter the original page
  // artwork underneath it.
  for (const field of targetForm.getFields()) {
    if (PDF_CHECKBOX_FIELDS.has(field.getName())) continue;
    try {
      if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font);
    } catch (_) {}
  }

  // Reuse the template's embedded Arial resource for the static marks. This
  // keeps the X independent of viewer-specific symbol fonts and avoids adding
  // another, non-embedded standard font to the exported PDF.
  await drawStaticCheckboxMarks(targetPdf, targetForm, font);

  // The font resource already exists in the template. Prevent pdf-lib from
  // replacing it with a newly embedded Helvetica resource during save.
  if (arialRef) font.modified = false;
  targetForm.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
}

function bytesToPdfString(bytes) {
  return Array.from(bytes, byte => String.fromCharCode(byte)).join('');
}

function decodeAppearanceStream(stream) {
  const bytes = stream.getContents();
  const filter = stream.dict.get(PDFName.of('Filter'));
  return filter ? bytesToPdfString(pako.inflate(bytes)) : bytesToPdfString(bytes);
}

function createFrameOnlyAppearance(targetPdf, originalStream, contents) {
  const context = targetPdf.context;
  return context.flateStream(contents, {
    BBox: originalStream.dict.get(PDFName.of('BBox')),
    Matrix: originalStream.dict.get(PDFName.of('Matrix')),
    Resources: originalStream.dict.get(PDFName.of('Resources')),
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
  });
}

function removeCheckboxText(contents) {
  return contents.replace(/(\r?\n)\s*(?:\([^)]*\)|<[^>]*>)\s*Tj/g, '$1() Tj');
}

async function drawStaticCheckboxMarks(targetPdf, targetForm, staticFont) {
  const context = targetPdf.context;

  for (const fieldName of STATIC_CHECKBOX_FIELDS) {
    let field;
    try {
      field = targetForm.getTextField(fieldName);
    } catch (_) {
      continue;
    }
    if (!field.needsAppearancesUpdate()) continue;

    const marked = field.getText() === 'x';
    for (const widget of field.acroField.getWidgets()) {
      const appearance = context.lookup(widget.dict.get(PDFName.of('AP')));
      const originalRef = appearance?.get(PDFName.of('N'));
      const originalStream = originalRef ? context.lookup(originalRef) : null;
      if (originalStream?.getContents) {
        const frameOnly = createFrameOnlyAppearance(targetPdf, originalStream, removeCheckboxText(decodeAppearanceStream(originalStream)));
        widget.dict.set(PDFName.of('AP'), context.obj({ N: context.register(frameOnly) }));
        widget.dict.delete(PDFName.of('AS'));
      }

      if (marked) {
        const page = targetForm.findWidgetPage(widget);
        const { x, y, width, height } = widget.getRectangle();
        const textWidth = staticFont.widthOfTextAtSize('x', CHECKBOX_FONT_SIZE);
        const textHeight = staticFont.heightAtSize(CHECKBOX_FONT_SIZE, { descender: false });
        page.drawText('x', {
          x: x + (width - textWidth) / 2,
          y: y + (height - textHeight) / 2,
          size: CHECKBOX_FONT_SIZE,
          font: staticFont,
          color: rgb(0, 0, 0),
        });
      }
    }

    // Keep the interactive field empty. The visible X is now permanently part
    // of the page content, so no viewer has to interpret a checkbox state.
    field.setText('');
    field.markAsClean();
  }
}

async function createFilledPdf(sourceUri) {
  const values = sourceParser.parseSourceData(await extractPdfText(sourceUri));
  return createFilledPdfFromValues(values);
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
const SZE_TYPES = ['ZRZ', 'DT'];
const SZE_STAND_FIELDS = {
  ZRZ: [
    { field: 'htzst6', marker: 'zst6', label: '1.8.0' },
    { field: 'htzst7', marker: 'zst7', label: '2.8.0' }
  ],
  DT: [
    { field: 'htzst6', marker: 'zst6', label: '1.8.1' },
    { field: 'htzst7', marker: 'zst7', label: '1.8.2' },
    { field: 'htzst8', marker: 'zst8', label: '2.8.0' }
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
          <Text style={styles.monthTitle} numberOfLines={1}>{MONTH_NAMES[month]} {year}⌄</Text>
        </Pressable>
        <Pressable style={styles.calendarArrow} onPress={() => moveMonth(1)}><Text style={styles.calendarArrowText}>›</Text></Pressable>
      </View>
      {monthMenuOpen && <View style={styles.monthMenu}>
        {MONTH_NAMES.map((name, index) => <Pressable key={name} style={[styles.monthItem, index === month && styles.monthItemSelected]} onPress={() => { setVisibleMonth(new Date(year, index, 1)); setMonthMenuOpen(false); }}>
          <Text style={[styles.monthItemText, index === month && styles.monthItemTextSelected]}>{name}</Text>
        </Pressable>)}
      </View>}
      <View style={styles.weekdayRow}>{WEEKDAY_NAMES.map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
      <View style={styles.calendarGrid}>{cells.map((day, index) => {
        const isSelected = Boolean(day && dateKey(day) === dateKey(value));
        const isToday = Boolean(day && dateKey(day) === dateKey(today));
        return <Pressable key={`${index}-${day ? day.getDate() : 'empty'}`} disabled={!day} style={[styles.dayCell, isToday && styles.dayCellToday, isSelected && styles.dayCellSelected]} onPress={() => day && onChange(day)}>
          <Text style={[styles.dayText, isToday && styles.dayTextToday, isSelected && styles.dayTextSelected]}>{day ? day.getDate() : ''}</Text>
        </Pressable>;
      })}</View>
    </View>
  );
}

function GrundCheckbox({ label, checked, onPress }) {
  const compactLabel = label.length >= 13;
  return (
    <Pressable style={styles.checkboxGridItem} onPress={onPress}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked && <Text style={styles.checkmark}>✓</Text>}</View>
      <Text style={[styles.checkboxLabel, compactLabel && styles.checkboxLabelLong]} numberOfLines={1} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

function TrashIcon() {
  return (
    <View style={styles.trashIcon}>
      <View style={styles.trashHandle} />
      <View style={styles.trashLid} />
      <View style={styles.trashBody}>
        <View style={styles.trashLine} />
        <View style={styles.trashLine} />
      </View>
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

function drawRseEinbauStrike(targetPdf) {
  const page = targetPdf.getPages()[0];
  // The lower meter block's left label cell contains the static “Einbau”
  // label. It is rotated vertically in the template, so cover it with six
  // tightly spaced parallel red pen strokes instead of crossing the cell.
  const centerX = 64.2;
  // The strokes are exactly edge-to-edge: their center spacing equals their
  // thickness, leaving no visible gap between neighboring lines.
  for (const offset of [-4.2, -2.1, 0, 2.1, 4.2, 6.3]) {
    page.drawLine({
      start: { x: centerX + offset, y: 431.5 },
      end: { x: centerX + offset, y: 480.2 },
      color: rgb(0.9, 0.08, 0.08),
      thickness: 2.1
    });
  }
}

async function createRsePdf(sourceUri, group, rsePlacement, werkNr, selectedDate, einbauEnabled, ausbauEnabled, zusammenlegungEnabled, stilllegungEnabled, turnusEnabled, befundpruefungEnabled, wsdsEnabled, wpEnabled, pvEnabled, haushaltEnabled, gewerbeEnabled, baustromEnabled, allgemeinEnabled, klemmeEnabled, einbauWerkNr, ausbauWerkNr, gatewayWerkNr, gatewayType, szaType, szaStandValues, szeType, szeStandValues, bemerkungen, bildnummer) {
  const targetPdf = await PDFDocument.load(await readPdf(sourceUri));
  const targetForm = targetPdf.getForm();
  const onlyRseSelected = Boolean(group)
    && !einbauEnabled
    && !ausbauEnabled
    && !zusammenlegungEnabled
    && !stilllegungEnabled
    && !turnusEnabled
    && !befundpruefungEnabled
    && !wsdsEnabled
    && !wpEnabled
    && !pvEnabled
    && !haushaltEnabled
    && !gewerbeEnabled
    && !baustromEnabled
    && !allgemeinEnabled
    && !klemmeEnabled;
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
    L: stilllegungEnabled ? 'x' : '',
    H: turnusEnabled ? 'x' : '',
    I: befundpruefungEnabled ? 'x' : '',
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
      const standValue = String(szaStandValues?.[standField.field] || '').trim();
      if (standValue !== ',') {
        fields[standField.marker] = standValue;
        fields[standField.field] = standField.label;
      }
    }
  }
  for (let index = 6; index <= 9; index++) {
    fields[`zst${index}`] = '';
    fields[`htzst${index}`] = '';
  }
  fields.zst0 = '';
  fields.htzst0 = '';
  if (einbauWerkNr.trim() && !onlyRseSelected) {
    for (const standField of SZE_STAND_FIELDS[szeType] || []) {
      const standValue = String(szeStandValues?.[standField.field] || '').trim();
      if (standValue !== ',') {
        fields[standField.marker] = standValue;
        fields[standField.field] = standField.label;
      }
    }
  }
  if (group && werkNr.trim()) {
    const groupNumber = Number(group.slice(-2));
    const rowSuffix = rsePlacement === 'ausbau' ? 'Row1' : 'Row2';
    Object.assign(fields, {
      [`Werk Nr${rowSuffix}`]: werkNr.trim(),
      [`Typ${rowSuffix}`]: 'LCR 160',
      [`Code${rowSuffix}`]: `613/${String(5 + groupNumber).padStart(2, '0')}`,
      [`Verwendungsart${rowSuffix}`]: group
    });
  }
  if (selectedDate) {
    if (ausbauEnabled || zusammenlegungEnabled) fields.Datum = formatPdfDate(selectedDate);
    else fields.Datum_2 = formatPdfDate(selectedDate);
  }

  for (const [fieldName, value] of Object.entries(fields)) {
    const field = targetForm.getTextField(fieldName);
    field.setText(value || '');
    field.setFontSize(PDF_CHECKBOX_FIELDS.has(fieldName) ? CHECKBOX_FONT_SIZE : FORM_FONT_SIZE);
  }

  await addSavedTextField(targetPdf);
  await updateGatewayAnnotation(targetPdf, gatewayWerkNr, gatewayType);

  await updateAutoSizedFormAppearances(targetPdf, targetForm);
  if (onlyRseSelected) drawRseEinbauStrike(targetPdf);
  return targetPdf.save({ updateFieldAppearances: false });
}

export default function App() {
  useEffect(() => {
    getAppDirectory(SOURCE_DIRECTORY_NAME);
    getAppDirectory(EDIT_DIRECTORY_NAME);
    getAppDirectory(FINISHED_DIRECTORY_NAME);
  }, []);

  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [manualSourceOpen, setManualSourceOpen] = useState(false);
  const [manualSourceText, setManualSourceText] = useState('');
  const [editScreen, setEditScreen] = useState(false);
  const [selectedEditPdf, setSelectedEditPdf] = useState(null);
  const [selectedEditPdfName, setSelectedEditPdfName] = useState('');
  const [rseEnabled, setRseEnabled] = useState(false);
  const [rsePlacement, setRsePlacement] = useState('einbau');
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(EEG_GROUPS[0]);
  const [groupAutoDetected, setGroupAutoDetected] = useState(false);
  const [werkNr, setWerkNr] = useState('');
  const [einbauWerkNr, setEinbauWerkNr] = useState('');
  const [ausbauWerkNr, setAusbauWerkNr] = useState('');
  const [gatewayWerkNr, setGatewayWerkNr] = useState('');
  const [gatewayType, setGatewayType] = useState('Draht');
  const [szaType, setSzaType] = useState(null);
  const [szaStandValues, setSzaStandValues] = useState({});
  const [szeType, setSzeType] = useState('ZRZ');
  const [szeTypeSelected, setSzeTypeSelected] = useState(false);
  const [szeStandValues, setSzeStandValues] = useState({ htzst6: '0', htzst7: '0' });
  const [editBusy, setEditBusy] = useState(false);
  const [einbauEnabled, setEinbauEnabled] = useState(false);
  const [ausbauEnabled, setAusbauEnabled] = useState(false);
  const [szwEnabled, setSzwEnabled] = useState(false);
  const [zlgEnabled, setZlgEnabled] = useState(false);
  const [stilllegungEnabled, setStilllegungEnabled] = useState(false);
  const [turnusEnabled, setTurnusEnabled] = useState(false);
  const [befundpruefungEnabled, setBefundpruefungEnabled] = useState(false);
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
  const [remarkDeleteMode, setRemarkDeleteMode] = useState(false);
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

  function isOnlyRseSelected() {
    return rseEnabled
      && !einbauEnabled
      && !ausbauEnabled
      && !szwEnabled
      && !zlgEnabled
      && !stilllegungEnabled
      && !turnusEnabled
      && !befundpruefungEnabled
      && !wsdsEnabled
      && !wpEnabled
      && !pvEnabled
      && !haushaltEnabled
      && !gewerbeEnabled
      && !baustromEnabled
      && !allgemeinEnabled
      && !klemmeEnabled;
  }

  async function choosePdf() {
    const sourceDirectory = getAppDirectory(SOURCE_DIRECTORY_NAME);
    const result = await File.pickFileAsync({
      initialUri: sourceDirectory.uri,
      mimeTypes: ['application/pdf', 'application/zip', 'application/x-rar-compressed', 'application/x-rar'],
      multipleFiles: true
    });
    if (!result.canceled) setSelected(result.result);
  }

  function openManualSource() {
    setManualSourceText('');
    setManualSourceOpen(true);
  }

  async function fillManualSource() {
    let values;
    try {
      values = parseManualSourceData(manualSourceText);
    } catch (error) {
      Alert.alert('Eingabe prüfen', error.message);
      return;
    }

    setBusy(true);
    try {
      const outputDirectory = getAppDirectory(EDIT_DIRECTORY_NAME);
      const generated = await createFilledPdfFromValues(values);
      const outputFile = new File(outputDirectory, generated.filename);
      if (await confirmFileReplacement(outputFile)) {
        saveFileBytes(outputFile, generated.bytes);
        setManualSourceOpen(false);
        Alert.alert('Fertig', `Die bearbeitete Datei wurde in „${EDIT_DIRECTORY_NAME}“ gespeichert.`);
      }
    } catch (error) {
      Alert.alert('Fehler', error.message || 'Die manuelle Quelle konnte nicht verarbeitet werden.');
    } finally {
      setBusy(false);
    }
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

      const outputDirectory = getAppDirectory(EDIT_DIRECTORY_NAME);
      const sources = [];
      for (const asset of selected) sources.push(...await expandSource(asset));
      const generated = [];
      for (const source of sources) generated.push(await createFilledPdf(source.uri, outputDirectory));

      if (mode === 'zip') {
        const files = Object.fromEntries(generated.map(file => [file.filename, file.bytes]));
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const zipFile = new File(outputDirectory, `Zaehlerwechselbelege_${stamp}.zip`);
        if (await confirmFileReplacement(zipFile)) saveFileBytes(zipFile, zipSync(files));
      } else {
        for (const file of generated) {
          const outputFile = new File(outputDirectory, file.filename);
          if (await confirmFileReplacement(outputFile)) saveFileBytes(outputFile, file.bytes);
        }
      }
      Alert.alert('Fertig', `Die bearbeiteten Dateien wurden in „${EDIT_DIRECTORY_NAME}“ gespeichert.`);
    } catch (error) {
      Alert.alert('Fehler', error.message || 'Die PDF konnte nicht verarbeitet werden.');
    } finally { setBusy(false); }
  }

  async function fillRsePdf() {
    const effectiveEinbau = einbauEnabled || szwEnabled;
    const effectiveAusbau = ausbauEnabled || szwEnabled;
    const onlyRseSelected = isOnlyRseSelected();
    const hasSelection = rseEnabled || effectiveEinbau || effectiveAusbau || zlgEnabled || stilllegungEnabled || turnusEnabled || befundpruefungEnabled || wsdsEnabled || wpEnabled || pvEnabled || haushaltEnabled || gewerbeEnabled || baustromEnabled || allgemeinEnabled || klemmeEnabled;
    const ausbauTypeMissing = Boolean(ausbauWerkNr.trim() && !szaType);
    const szaStandMissing = Boolean(ausbauWerkNr.trim() && szaType && (SZA_STAND_FIELDS[szaType] || []).some(standField => !hasNumericStandValue(szaStandValues?.[standField.field], szaType === 'ALT')));
    const szeStandMissing = Boolean(!onlyRseSelected && einbauWerkNr.trim() && szeTypeSelected && (SZE_STAND_FIELDS[szeType] || []).some(standField => !hasNumericStandValue(szeStandValues?.[standField.field])));
    const rseOnlyMissingEinbauWerkNr = Boolean(onlyRseSelected && !einbauWerkNr.trim());
    const rseOnlyMissingGatewayWerkNr = Boolean(onlyRseSelected && !gatewayWerkNr.trim());
    const gatewayRequiresEinbau = gatewayWerkNr.trim() && !einbauWerkNr.trim();
    const originalSourceName = selectedEditPdf?.name || 'Zaehlerwechselbeleg.pdf';
    const filenameWasChanged = hasCustomFilename(selectedEditPdfName, originalSourceName);
    const remarkFilenameSuffix = getRemarkFilenameSuffix(bemerkungen);
    const filenameRequirementMissing = Boolean(selectedEditPdf && !filenameWasChanged && !remarkFilenameSuffix);
    if (ausbauTypeMissing) {
      Alert.alert('Ausbauart auswählen', 'Bitte wähle eine der vier Ausbauarten aus, bevor du speicherst.');
      return;
    }
    if (szaStandMissing || szeStandMissing) {
      Alert.alert('Stand fehlt', 'Bitte Stand eintragen.');
      return;
    }
    if (rseOnlyMissingEinbauWerkNr || rseOnlyMissingGatewayWerkNr) {
      Alert.alert('RSE unvollständig', 'Bei ausschließlich RSE müssen Werk Nr. Einbau und Werk Nr. Gateway eingetragen werden.');
      return;
    }
    if (gatewayRequiresEinbau) {
      Alert.alert('Werk Nr. Einbau erforderlich', 'Wenn eine Gateway-Werknummer eingetragen ist, muss auch eine Werknummer für den Einbau eingetragen werden.');
      return;
    }
    if (filenameRequirementMissing) {
      Alert.alert('Dateiname ändern', 'Bitte ändere den Dateinamen oder wähle eine passende Bemerkungsvorlage aus.');
      return;
    }
    if (!selectedEditPdf || !hasSelection || !selectedDate || !bildnummer.trim() || (rseEnabled && (!selectedGroup || !werkNr.trim()))) return;
    setEditBusy(true);
    try {
      const outputDirectory = getAppDirectory(FINISHED_DIRECTORY_NAME);
      const sourceName = ensurePdfFilename(selectedEditPdfName, originalSourceName);
      const sourceBaseName = sourceName.replace(/\.pdf$/i, '');
      const rseOnly = rseEnabled && !effectiveEinbau && !effectiveAusbau && !zlgEnabled;
      const filenameBaseWithoutTrailingComma = cleanFilenamePart(sourceBaseName).replace(/,\s*$/, '').trim();
      const outputFilename = remarkFilenameSuffix
        ? `${filenameBaseWithoutTrailingComma}, ${remarkFilenameSuffix}.pdf`
        : rseOnly
          ? `${cleanFilenamePart(sourceBaseName)}, iMSys RSE nachgerüstet.pdf`
            : filenameWasChanged
            ? `${cleanFilenamePart(sourceBaseName)}.pdf`
            : `${cleanFilenamePart(sourceBaseName)}_bearbeitet.pdf`;
      const outputFile = new File(outputDirectory, outputFilename);
      const pdfBytes = await createRsePdf(selectedEditPdf.uri, rseEnabled ? selectedGroup : null, rsePlacement, werkNr, selectedDate, effectiveEinbau, effectiveAusbau, zlgEnabled, stilllegungEnabled, turnusEnabled, befundpruefungEnabled, wsdsEnabled, wpEnabled, pvEnabled, haushaltEnabled, gewerbeEnabled, baustromEnabled, allgemeinEnabled, klemmeEnabled, einbauWerkNr, ausbauWerkNr, gatewayWerkNr, gatewayType, szaType, szaStandValues, szeType, szeStandValues, bemerkungen, bildnummer);
      if (await confirmFileReplacement(outputFile)) {
        saveFileBytes(outputFile, pdfBytes);
        Alert.alert('Gespeichert', `Die bearbeitete PDF wurde in „${FINISHED_DIRECTORY_NAME}“ gespeichert.`);
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
      setRsePlacement('einbau');
      setSelectedGroup(detectedGroup || EEG_GROUPS[0]);
      setGroupAutoDetected(Boolean(detectedGroup));
      setGroupMenuOpen(false);
      setWerkNr('');
      setEinbauEnabled(false);
      setAusbauEnabled(false);
      setSzwEnabled(false);
      setZlgEnabled(false);
      setStilllegungEnabled(false);
      setTurnusEnabled(false);
      setBefundpruefungEnabled(false);
      setWsdsEnabled(false);
      setEinbauWerkNr('');
      setAusbauWerkNr('');
      setGatewayWerkNr('');
      setGatewayType('Draht');
      setSzaType(null);
      setSzaStandValues({});
      setSzeType('ZRZ');
      setSzeTypeSelected(false);
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
      setRemarkDeleteMode(false);
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
    setRemarkDeleteMode(false);
    try {
      REMARK_PRESETS_FILE.write(JSON.stringify(nextPresets));
    } catch (_) {}
  }

  function deleteRemarkPreset(value) {
    Alert.alert(
      'Vorlage löschen',
      `Soll die eigene Vorlage „${value}“ wirklich gelöscht werden?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            const nextPresets = remarkPresets.filter(preset => preset !== value);
            setRemarkPresets(nextPresets);
            if (bemerkungen === value) {
              setBemerkungen('');
              setRseRemarkAuto(false);
            }
            try {
              REMARK_PRESETS_FILE.write(JSON.stringify(nextPresets));
            } catch (_) {}
          }
        }
      ]
    );
  }

  const originalEditPdfName = selectedEditPdf ? removePdfExtension(selectedEditPdf.name || 'Zaehlerwechselbeleg.pdf') : '';
  const filenameWasChanged = Boolean(selectedEditPdf && hasCustomFilename(selectedEditPdfName, originalEditPdfName));
  const filenameFromRemark = Boolean(getRemarkFilenameSuffix(bemerkungen));
  const filenameChangeRequired = Boolean(selectedEditPdf && !filenameWasChanged && !filenameFromRemark);
  const customRemarkPresets = remarkPresets.filter(preset => !DEFAULT_REMARK_PRESETS.includes(preset));
  const szaStandMissing = Boolean(ausbauWerkNr.trim() && szaType && (SZA_STAND_FIELDS[szaType] || []).some(standField => !hasNumericStandValue(szaStandValues?.[standField.field], szaType === 'ALT')));
  const onlyRseSelected = isOnlyRseSelected();
  const szeStandMissing = Boolean(!onlyRseSelected && einbauWerkNr.trim() && szeTypeSelected && (SZE_STAND_FIELDS[szeType] || []).some(standField => !hasNumericStandValue(szeStandValues?.[standField.field])));

  function getMissingEditRequirements() {
    const effectiveEinbau = einbauEnabled || szwEnabled;
    const effectiveAusbau = ausbauEnabled || szwEnabled;
    const hasSelection = rseEnabled || effectiveEinbau || effectiveAusbau || zlgEnabled || stilllegungEnabled || turnusEnabled || befundpruefungEnabled || wsdsEnabled || wpEnabled || pvEnabled || haushaltEnabled || gewerbeEnabled || baustromEnabled || allgemeinEnabled || klemmeEnabled;
    const missing = [];
    if (!selectedEditPdf) missing.push('PDF auswählen');
    if (!hasSelection) missing.push('mindestens einen Grund auswählen');
    if (!selectedDate) missing.push('Datum auswählen');
    if (!bildnummer.trim()) missing.push('Bildnummer eingeben');
    if (filenameChangeRequired) missing.push('Dateinamen umbenennen');
    if (rseEnabled && !werkNr.trim()) missing.push('Werk Nr. für RSE eingeben');
    if (onlyRseSelected && !einbauWerkNr.trim()) missing.push('Werk Nr. Einbau eingeben');
    if (onlyRseSelected && !gatewayWerkNr.trim()) missing.push('Werk Nr. Gateway eingeben');
    if (ausbauWerkNr.trim() && !szaType) missing.push('Ausbauart auswählen');
    if (szaStandMissing || szeStandMissing) missing.push('Stand eintragen');
    if (gatewayWerkNr.trim() && !einbauWerkNr.trim()) missing.push('Werk Nr. Einbau für das Gateway eingeben');
    return [...new Set(missing)];
  }

  const missingEditRequirements = getMissingEditRequirements();

  function handleEditSavePress() {
    const missing = getMissingEditRequirements();
    if (missing.length) {
      Alert.alert('Noch nicht bereit', `Bitte ergänze noch:\n\n${missing.map(item => `• ${item}`).join('\n')}`);
      return;
    }
    fillRsePdf();
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
          {filenameChangeRequired && <Text style={styles.requiredFieldHint}>Bitte Dateinamen umbenennen.</Text>}

          <View style={styles.card}>
            <Text style={[styles.sectionTitle, styles.compactSectionTitle]}>Datum:</Text>
            <Pressable style={styles.dateButton} onPress={() => setCalendarOpen(open => !open)}>
              <Text style={[styles.dateButtonText, selectedDate && styles.dateButtonValue]}>{selectedDate ? formatPdfDate(selectedDate) : 'Datum auswählen'}</Text>
              <Text style={styles.dateButtonArrow}>{calendarOpen ? '⌃' : '⌄'}</Text>
            </Pressable>
            {calendarOpen && <MiniCalendar value={selectedDate} onChange={date => { setSelectedDate(date); setCalendarOpen(false); }} />}
            {!selectedDate && <Text style={styles.requiredFieldHint}>Bitte Datum auswählen.</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Grund:</Text>
            <View style={styles.checkboxGrid}>
            <GrundCheckbox label="Einbau" checked={einbauEnabled} onPress={() => setEinbauEnabled(value => !value)} />
            <GrundCheckbox label="Ausbau" checked={ausbauEnabled} onPress={() => setAusbauEnabled(value => !value)} />
            <GrundCheckbox label="SZW" checked={szwEnabled} onPress={() => setSzwEnabled(value => !value)} />
            <GrundCheckbox label="Turnus" checked={turnusEnabled} onPress={() => setTurnusEnabled(value => !value)} />
            <GrundCheckbox label="Befundprüfung" checked={befundpruefungEnabled} onPress={() => setBefundpruefungEnabled(value => !value)} />
            <GrundCheckbox label="WS/DS" checked={wsdsEnabled} onPress={() => setWsdsEnabled(value => !value)} />
            <GrundCheckbox label="Stilllegung" checked={stilllegungEnabled} onPress={() => setStilllegungEnabled(value => !value)} />
            <GrundCheckbox label="Zusammenlegung" checked={zlgEnabled} onPress={() => setZlgEnabled(value => !value)} />
            <GrundCheckbox label="RSE" checked={rseEnabled} onPress={() => setRseEnabled(value => !value)} />
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
              <View style={styles.gatewayTypeRow}>
                {[
                  ['einbau', 'Einbau'],
                  ['ausbau', 'Ausbau']
                ].map(([value, label]) => <Pressable
                  key={value}
                  style={[styles.gatewayTypeButton, rsePlacement === value && styles.gatewayTypeButtonSelected]}
                  onPress={() => setRsePlacement(value)}
                >
                  <Text style={[styles.gatewayTypeText, rsePlacement === value && styles.gatewayTypeTextSelected]}>{label}</Text>
                </Pressable>)}
              </View>
              <Text style={styles.hint}>Typ: LCR 160 · Code: {`613/${String(5 + Number(selectedGroup.slice(-2))).padStart(2, '0')}`}</Text>
            </>}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Zählernummern:</Text>
            <View style={[styles.subsectionCard, styles.subsectionAusbau]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleAusbau]}>Ausbau</Text>
              <Text style={styles.label}>Werk Nr. Ausbau</Text>
              <View style={styles.scannerInputRow}>
              <TextInput value={ausbauWerkNr} onChangeText={value => { setAusbauWerkNr(value); if (!value.trim()) setSzaType(null); }} placeholder="Werknummer eingeben oder scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('ausbau')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {ausbauWerkNr.trim() && <>
                <Text style={styles.label}>Ausbauart</Text>
                <View style={styles.szaTypeRow}>
                  {SZA_TYPES.map(type => <Pressable key={type} style={[styles.gatewayTypeButton, szaType === type && styles.gatewayTypeButtonSelected]} onPress={() => setSzaType(type)}>
                    <Text style={[styles.gatewayTypeText, szaType === type && styles.gatewayTypeTextSelected]}>{type}</Text>
                  </Pressable>)}
                </View>
                {!szaType && <Text style={styles.requiredFieldHint}>Bitte Ausbauart auswählen.</Text>}
                {szaType && <View style={styles.szaStandGrid}>
                  {(SZA_STAND_FIELDS[szaType] || []).map(standField => <View key={standField.field} style={styles.szaStandItem}>
                    {standField.label ? <Text style={styles.szaStandLabel}>{standField.label}</Text> : null}
                    <TextInput
                      value={szaStandValues[standField.field] || ''}
                      onChangeText={value => setSzaStandValues(current => ({ ...current, [standField.field]: szaType === 'ALT' ? sanitizeAltStandValue(value) : value.replace(/[^0-9]/g, '') }))}
                      placeholder={standField.label ? 'Stand eingeben' : 'Stand eingeben'}
                      placeholderTextColor="#8a96aa"
                      style={styles.szaStandInput}
                      keyboardType={szaType === 'ALT' ? 'decimal-pad' : 'numeric'}
                      inputMode={szaType === 'ALT' ? 'decimal' : 'numeric'}
                    />
                  </View>)}
                </View>}
                {szaStandMissing && <Text style={styles.requiredFieldHint}>Bitte Stand eintragen.</Text>}
              </>}
            </View>

            <View style={[styles.subsectionCard, styles.subsectionEinbau]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleEinbau]}>Einbau</Text>
              <Text style={styles.label}>Werk Nr. Einbau</Text>
              <View style={styles.scannerInputRow}>
                <TextInput value={einbauWerkNr} onChangeText={setEinbauWerkNr} placeholder="Werknummer eingeben oder scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('einbau')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {onlyRseSelected && !einbauWerkNr.trim() && <Text style={styles.requiredFieldHint}>Bitte Werk Nr. Einbau eingeben.</Text>}
              {einbauWerkNr.trim() && !onlyRseSelected && <>
                <Text style={styles.label}>Einbauart</Text>
                <View style={styles.szaTypeRow}>
                  {SZE_TYPES.map(type => <Pressable key={type} style={[styles.gatewayTypeButton, szeType === type && styles.gatewayTypeButtonSelected]} onPress={() => { setSzeType(type); setSzeTypeSelected(true); }}>
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
                {szeStandMissing && <Text style={styles.requiredFieldHint}>Bitte Stand eintragen.</Text>}
              </>}
            </View>

            <View style={[styles.subsectionCard, styles.subsectionGateway]}>
              <Text style={[styles.subsectionTitle, styles.subsectionTitleGateway]}>Gateway</Text>
              <Text style={styles.label}>Werk Nr. Gateway (optional)</Text>
              <View style={styles.scannerInputRow}>
                <TextInput value={gatewayWerkNr} onChangeText={setGatewayWerkNr} placeholder="Werknummer eingeben oder QR scannen" placeholderTextColor="#8a96aa" style={[styles.input, styles.scannerInput]} autoCapitalize="characters" />
                <Pressable style={styles.scanButton} onPress={() => openScanner('gateway')}><Text style={styles.scanButtonText}>Scannen</Text></Pressable>
              </View>
              {onlyRseSelected && !gatewayWerkNr.trim() && <Text style={styles.requiredFieldHint}>Bitte Werk Nr. Gateway eingeben.</Text>}
              {gatewayWerkNr.trim() && !einbauWerkNr.trim() && <Text style={styles.gatewayRequiredHint}>Für eine Gateway-Werknummer ist auch eine Werk Nr. Einbau erforderlich.</Text>}
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
            {!bildnummer.trim() && <Text style={styles.requiredFieldHint}>Bitte Bildnummer eingeben.</Text>}
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
            <Pressable style={styles.remarkPresetToggle} onPress={() => { setRemarkMenuOpen(open => !open); setRemarkDeleteMode(false); }}>
              <Text style={styles.remarkPresetToggleText}>Bemerkung auswählen</Text>
              <View style={styles.remarkPresetArrow}><Text style={styles.remarkPresetArrowText}>{remarkMenuOpen ? '⌃' : '⌄'}</Text></View>
            </Pressable>
            {remarkMenuOpen && <View style={styles.remarkPresetMenu}>
              {remarkPresets.map(preset => <Pressable key={preset} style={styles.remarkPresetItem} onPress={() => { setBemerkungen(preset); setRseRemarkAuto(false); setRemarkMenuOpen(false); }}>
                <Text style={styles.remarkPresetText}>{preset}</Text>
              </Pressable>)}
            </View>}
            <View style={styles.remarkPresetActions}>
              {!newRemarkPresetOpen && <Pressable style={styles.savePresetButton} onPress={() => { setNewRemarkPresetOpen(true); setRemarkDeleteMode(false); }}>
                <Text style={styles.savePresetButtonText}>Neue Vorlage speichern</Text>
              </Pressable>}
              <Pressable
                style={[styles.deletePresetButton, remarkDeleteMode && styles.deletePresetButtonActive]}
                accessibilityRole="button"
                accessibilityLabel="Eigene Bemerkungsvorlagen löschen"
                onPress={() => { setRemarkDeleteMode(open => !open); setRemarkMenuOpen(false); }}
              >
                <TrashIcon />
              </Pressable>
            </View>
            {remarkDeleteMode && <View style={styles.remarkDeleteMenu}>
              {customRemarkPresets.length ? customRemarkPresets.map(preset => <View key={preset} style={styles.remarkDeleteItem}>
                <Text style={styles.remarkPresetText} numberOfLines={2}>{preset}</Text>
                <Pressable
                  style={styles.remarkDeleteItemButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Vorlage ${preset} löschen`}
                  onPress={() => deleteRemarkPreset(preset)}
                >
                  <TrashIcon />
                </Pressable>
              </View>) : <Text style={styles.remarkDeleteEmpty}>Keine eigenen Vorlagen vorhanden.</Text>}
            </View>}
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

          <Pressable style={[styles.button, styles.primary, (missingEditRequirements.length > 0 || editBusy) && styles.disabled]} disabled={editBusy} onPress={handleEditSavePress}>
            {editBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>PDF erstellen und speichern</Text>}
          </Pressable>
          <Pressable style={[styles.button, styles.bottomBackButton]} onPress={() => setEditScreen(false)}>
            <Text style={styles.buttonText}>Zurück</Text>
          </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, styles.homeSafe]}>
      <View style={[styles.container, styles.homeContainer]}>
        <View style={styles.homeBrand}>
          <View style={styles.logoHalo}>
            <View style={styles.logoGlow} />
            <Image source={require('./assets/icon.png')} style={styles.homeLogo} resizeMode="contain" />
          </View>
          <Text style={styles.homeTitle}>MyPDFTool</Text>
        </View>

        <View style={styles.homeActions}>
          <Pressable style={[styles.homeButton, styles.homeButtonPrimary]} onPress={choosePdf}>
            <View style={styles.homeButtonIcon}><Text style={styles.homeButtonIconText}>＋</Text></View>
            <View style={styles.homeButtonCopy}><Text style={styles.homeButtonTitle}>Quellen auswählen</Text></View>
            <Text style={styles.homeButtonArrow}>›</Text>
          </Pressable>
          <Pressable style={styles.homeButton} onPress={openManualSource}>
            <View style={[styles.homeButtonIcon, styles.homeButtonIconMuted]}><Text style={styles.homeButtonIconText}>✎</Text></View>
            <View style={styles.homeButtonCopy}><Text style={styles.homeButtonTitle}>Quelle manuell</Text></View>
            <Text style={styles.homeButtonArrow}>›</Text>
          </Pressable>
          {selected.length > 0 && <View style={styles.selectionPill}><View style={styles.selectionDot} /><Text style={styles.selectionText}>{selected.length} Quelle{selected.length === 1 ? '' : 'n'} ausgewählt</Text></View>}
          <Pressable style={[styles.homeButton, styles.homeButtonAccent, (!selected.length || busy) && styles.disabled]} disabled={!selected.length || busy} onPress={fillPdf}>
            <View style={[styles.homeButtonIcon, styles.homeButtonIconAccent]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.homeButtonIconText}>✓</Text>}</View>
            <View style={styles.homeButtonCopy}><Text style={styles.homeButtonTitle}>PDFs ausfüllen</Text></View>
            <Text style={styles.homeButtonArrow}>›</Text>
          </Pressable>
          <Pressable style={styles.homeButton} onPress={chooseEditPdf}>
            <View style={[styles.homeButtonIcon, styles.homeButtonIconMuted]}><Text style={styles.homeButtonIconText}>✦</Text></View>
            <View style={styles.homeButtonCopy}><Text style={styles.homeButtonTitle}>PDF bearbeiten</Text></View>
            <Text style={styles.homeButtonArrow}>›</Text>
          </Pressable>
        </View>

      </View>
      <Modal visible={manualSourceOpen} animationType="slide" transparent onRequestClose={() => setManualSourceOpen(false)}>
        <KeyboardAvoidingView style={styles.manualModalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.manualModalCard}>
            <View style={styles.manualModalHeader}>
              <View style={styles.manualModalIcon}><Text style={styles.manualModalIconText}>✎</Text></View>
              <View style={styles.manualModalHeadingCopy}>
                <Text style={styles.manualModalEyebrow}>MANUELLER IMPORT</Text>
                <Text style={styles.manualModalTitle}>Quelle manuell</Text>
              </View>
            </View>
            <Text style={styles.manualModalHint}>3 Zeilen: Name, Straße/Hausnummer, PLZ/Gemeinde/Ortsteil. Bei 4 Zeilen ist die zweite Zeile die Firma.</Text>
            <TextInput
              value={manualSourceText}
              onChangeText={setManualSourceText}
              placeholder="Name\nStraße und Hausnummer\nPLZ Gemeinde Ortsteil"
              placeholderTextColor="#8a96aa"
              multiline
              autoFocus
              scrollEnabled={false}
              textAlignVertical="top"
              style={[styles.manualSourceInput, { height: Math.min(280, Math.max(58, manualSourceText.split(/\r?\n/).length * 34 + 24)) }]}
            />
            <View style={styles.manualModalActions}>
              <Pressable style={[styles.button, styles.manualCancelButton]} onPress={() => setManualSourceOpen(false)} disabled={busy}>
                <Text style={styles.manualCancelButtonText}>Abbrechen</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.primary, styles.manualSaveButton, busy && styles.disabled]} onPress={fillManualSource} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Speichern</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  homeSafe: { backgroundColor: '#07152e' },
  keyboardAvoiding: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  homeContainer: { paddingTop: 34, paddingBottom: 18, backgroundColor: '#07152e' },
  homeBrand: { alignItems: 'center' },
  logoHalo: { width: 156, height: 156, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#102b57', borderWidth: 1, borderColor: 'rgba(126,211,255,0.45)', shadowColor: '#36b7ff', shadowOpacity: 0.32, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  logoGlow: { position: 'absolute', width: 116, height: 116, borderRadius: 58, backgroundColor: 'rgba(39,170,255,0.22)' },
  homeLogo: { width: 142, height: 142, borderRadius: 38 },
  homeTitle: { marginTop: 18, color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: -1.1 },
  homeActions: { width: '100%', gap: 12, marginTop: 28 },
  homeButton: { minHeight: 68, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  homeButtonPrimary: { backgroundColor: '#1b73d1', borderColor: '#55c8ff', shadowColor: '#229cff', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  homeButtonAccent: { backgroundColor: '#16a779', borderColor: '#5ae4b6' },
  homeButtonIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  homeButtonIconMuted: { backgroundColor: 'rgba(120,183,255,0.18)' },
  homeButtonIconAccent: { backgroundColor: 'rgba(255,255,255,0.2)' },
  homeButtonIconText: { color: '#fff', fontSize: 24, lineHeight: 26, fontWeight: '700' },
  homeButtonCopy: { flex: 1, marginLeft: 14 },
  homeButtonTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  homeButtonArrow: { color: 'rgba(255,255,255,0.8)', fontSize: 30, fontWeight: '300', marginLeft: 10 },
  selectionPill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)' },
  selectionDot: { width: 7, height: 7, borderRadius: 4, marginRight: 8, backgroundColor: '#6ee7b7' },
  selectionText: { color: '#c8d8f4', fontSize: 13, fontWeight: '600' },
  title: { fontSize: 34, fontWeight: '700', color: '#172033' },
  subtitle: { fontSize: 19, marginTop: 6, color: '#3d4c68' },
  help: { fontSize: 16, lineHeight: 24, marginTop: 28, color: '#53627b' },
  button: { minHeight: 54, borderRadius: 12, backgroundColor: '#dce4f2', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primary: { backgroundColor: '#2457d6', marginTop: 12 },
  disabled: { opacity: 0.45 },
  manualModalBackdrop: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: 'rgba(3,10,28,0.78)' },
  manualModalCard: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, borderRadius: 26, backgroundColor: '#102242', borderWidth: 1, borderColor: 'rgba(126,211,255,0.38)', shadowColor: '#229cff', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  manualModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  manualModalIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b73d1', borderWidth: 1, borderColor: '#55c8ff', marginRight: 12 },
  manualModalIconText: { color: '#fff', fontSize: 25, fontWeight: '700' },
  manualModalHeadingCopy: { flex: 1 },
  manualModalEyebrow: { color: '#7ed3ff', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  manualModalTitle: { marginTop: 2, color: '#fff', fontSize: 25, fontWeight: '800' },
  manualModalHint: { marginTop: 2, color: '#b8cae8', fontSize: 14, lineHeight: 20 },
  manualSourceInput: { marginTop: 18, minHeight: 58, borderWidth: 1, borderColor: 'rgba(126,211,255,0.45)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 16, lineHeight: 24, backgroundColor: '#091a37' },
  manualModalActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  manualCancelButton: { flex: 1, marginTop: 0, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  manualSaveButton: { flex: 1, marginTop: 0 },
  manualCancelButtonText: { color: '#d9e7ff', fontSize: 17, fontWeight: '600' },
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
  remarkPresetActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, minHeight: 48 },
  savePresetButton: { flex: 1, paddingVertical: 6 },
  savePresetButtonText: { color: '#2457d6', fontSize: 14, fontWeight: '600' },
  deletePresetButton: { width: 52, height: 48, marginLeft: 10, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  deletePresetButtonActive: { backgroundColor: '#fecaca' },
  remarkDeleteMenu: { marginTop: 4, borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff7f7' },
  remarkDeleteItem: { minHeight: 54, paddingLeft: 12, paddingRight: 6, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#fee2e2' },
  remarkDeleteItemButton: { width: 44, height: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  remarkDeleteEmpty: { paddingHorizontal: 12, paddingVertical: 13, color: '#71809a', fontSize: 14 },
  trashIcon: { width: 22, height: 25, alignItems: 'center', justifyContent: 'flex-end' },
  trashHandle: { position: 'absolute', top: 0, width: 8, height: 3, borderRadius: 2, backgroundColor: '#ef4444' },
  trashLid: { position: 'absolute', top: 3, width: 18, height: 3, borderRadius: 2, backgroundColor: '#ef4444' },
  trashBody: { width: 15, height: 17, borderWidth: 2, borderTopWidth: 0, borderColor: '#ef4444', borderBottomLeftRadius: 3, borderBottomRightRadius: 3, flexDirection: 'row', justifyContent: 'space-evenly', paddingTop: 3 },
  trashLine: { width: 1.5, height: 9, borderRadius: 1, backgroundColor: '#ef4444' },
  newPresetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  newPresetInput: { flex: 1, minHeight: 44, fontSize: 14 },
  savePresetAction: { minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#2457d6', alignItems: 'center', justifyContent: 'center' },
  savePresetActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  editContainer: { padding: 24, paddingBottom: 300 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 18 },
  bottomBackButton: { marginTop: 16, marginBottom: 24, backgroundColor: '#eef2f8', borderWidth: 1, borderColor: '#cbd5e5' },
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
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#9aa5b8', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  checkboxChecked: { backgroundColor: '#2457d6', borderColor: '#2457d6' },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 17 },
  checkboxLabel: { flex: 1, flexShrink: 1, color: '#172033', fontSize: 17, lineHeight: 21, fontWeight: '600' },
  checkboxLabelLong: { fontSize: 14, lineHeight: 18, letterSpacing: -0.1 },
  checkboxGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 2 },
  checkboxGridItem: { width: '50%', flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingRight: 6 },
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
  gatewayRequiredHint: { marginTop: 8, color: '#b45309', fontSize: 13, lineHeight: 18 },
  requiredFieldHint: { marginTop: 8, color: '#dc2626', fontSize: 13, fontWeight: '600' },
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
  calendar: { width: '100%', marginTop: 4, padding: 12, borderRadius: 16, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e1e7f0', overflow: 'hidden' },
  calendarHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  calendarArrow: { flexShrink: 0, width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#e8efff' },
  calendarArrowText: { color: '#2457d6', fontSize: 30, lineHeight: 34, fontWeight: '400' },
  monthTitleButton: { flex: 1, minWidth: 0, height: 42, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  monthTitle: { width: '100%', color: '#172033', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  weekdayRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { width: '14.2857%', textAlign: 'center', color: '#71809a', fontSize: 12, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2857%', height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  dayCellToday: { borderWidth: 2, borderColor: '#2457d6', backgroundColor: '#e8efff' },
  dayCellSelected: { backgroundColor: '#2457d6' },
  dayText: { color: '#172033', fontSize: 16, fontWeight: '400' },
  dayTextToday: { color: '#2457d6', fontWeight: '800' },
  dayTextSelected: { color: '#fff', fontWeight: '700' },
  monthMenu: { marginBottom: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e5', overflow: 'hidden' },
  monthItem: { paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#eef2f8' },
  monthItemSelected: { backgroundColor: '#e8efff' },
  monthItemText: { color: '#172033', fontSize: 16 },
  monthItemTextSelected: { color: '#2457d6', fontWeight: '700' }
});
