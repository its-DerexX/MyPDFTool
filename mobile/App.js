import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import { PDFBool, PDFDocument, PDFName } from 'pdf-lib';
import pako from 'pako/dist/pako.cjs.js';
import { zipSync } from 'fflate';

const templateAsset = require('./assets/blanko.pdf');
const FORM_FONT_SIZE = 9.268;

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
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function dateKey(date) {
  return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
}

function formatPdfDate(date) {
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
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

async function createRsePdf(sourceUri, group, werkNr, selectedDate, einbauEnabled, ausbauEnabled, zusammenlegungEnabled) {
  const targetPdf = await PDFDocument.load(await readPdf(sourceUri));
  const targetForm = targetPdf.getForm();
  const fields = {
    F: einbauEnabled ? 'x' : '',
    G: ausbauEnabled ? 'x' : '',
    M: zusammenlegungEnabled ? 'x' : ''
  };
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
    if (ausbauEnabled) fields.Datum = formatPdfDate(selectedDate);
    else if (einbauEnabled) fields.Datum_2 = formatPdfDate(selectedDate);
  }

  for (const [fieldName, value] of Object.entries(fields)) {
    const field = targetForm.getTextField(fieldName);
    field.setText(value);
    field.setFontSize(FORM_FONT_SIZE);
  }

  targetForm.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  return targetPdf.save();
}

export default function App() {
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editScreen, setEditScreen] = useState(false);
  const [selectedEditPdf, setSelectedEditPdf] = useState(null);
  const [rseEnabled, setRseEnabled] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(EEG_GROUPS[0]);
  const [werkNr, setWerkNr] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [einbauEnabled, setEinbauEnabled] = useState(false);
  const [ausbauEnabled, setAusbauEnabled] = useState(false);
  const [szwEnabled, setSzwEnabled] = useState(false);
  const [zlgEnabled, setZlgEnabled] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

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
    const hasSelection = rseEnabled || effectiveEinbau || effectiveAusbau || zlgEnabled;
    if (!selectedEditPdf || !hasSelection || (rseEnabled && (!selectedGroup || !werkNr.trim()))) return;
    setEditBusy(true);
    try {
      const outputDirectory = new Directory(Paths.document, 'MyPDF-Ausgabe');
      outputDirectory.create({ idempotent: true, intermediates: true });
      const sourceName = selectedEditPdf.name || 'Zaehlerwechselbeleg.pdf';
      const sourceBaseName = sourceName.replace(/\.pdf$/i, '');
      const outputFile = new File(outputDirectory, `${cleanFilenamePart(sourceBaseName)}_bearbeitet.pdf`);
      outputFile.write(await createRsePdf(selectedEditPdf.uri, rseEnabled ? selectedGroup : null, werkNr, selectedDate, effectiveEinbau, effectiveAusbau, zlgEnabled));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(outputFile.uri, {
          dialogTitle: 'Bearbeitete PDF Vorschau',
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf'
        });
      } else {
        Alert.alert('Gespeichert', `${selectedGroup} wurde eingetragen und in „MyPDF-Ausgabe“ gespeichert.`);
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
      setSelectedEditPdf(result.assets[0]);
      setRseEnabled(false);
      setSelectedGroup(EEG_GROUPS[0]);
      setWerkNr('');
      setEinbauEnabled(false);
      setAusbauEnabled(false);
      setSzwEnabled(false);
      setZlgEnabled(false);
      setSelectedDate(null);
      setCalendarOpen(false);
      setEditScreen(true);
    }
  }

  if (editScreen) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.editContainer}>
          <Pressable onPress={() => setEditScreen(false)} style={styles.backButton}>
            <Text style={styles.backText}>‹ Zurück</Text>
          </Pressable>
          <Text style={styles.title}>PDF bearbeiten</Text>
          <Text style={styles.subtitle}>Zählerwechselbeleg gezielt ausfüllen</Text>
          <Text style={styles.selectedFileTitle}>Ausgewählte PDF</Text>
          <Text style={styles.selectedFileName}>{selectedEditPdf?.name || 'Keine PDF ausgewählt'}</Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Datum</Text>
            <Pressable style={styles.dateButton} onPress={() => setCalendarOpen(open => !open)}>
              <Text style={styles.dateButtonText}>{selectedDate ? `Datum: ${formatPdfDate(selectedDate)}` : 'Datum auswählen'}</Text>
              <Text style={styles.dropdownArrow}>{calendarOpen ? '⌃' : '⌄'}</Text>
            </Pressable>
            {calendarOpen && <MiniCalendar value={selectedDate} onChange={date => { setSelectedDate(date); setCalendarOpen(false); }} />}
            {(einbauEnabled || ausbauEnabled || szwEnabled) && <Text style={styles.calendarHint}>Das Datum wird gemäß der Auswahl eingetragen. Bei SZW gilt SZA.</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Auswahl</Text>
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
                {EEG_GROUPS.map(group => <Pressable key={group} style={styles.dropdownItem} onPress={() => { setSelectedGroup(group); setGroupMenuOpen(false); }}>
                  <Text style={styles.dropdownItemText}>{group}</Text>
                </Pressable>)}
              </View>}

              <Text style={styles.label}>Werk Nr.</Text>
              <TextInput
                value={werkNr}
                onChangeText={setWerkNr}
                placeholder="Werknummer eingeben"
                placeholderTextColor="#8a96aa"
                style={styles.input}
                autoCapitalize="characters"
              />
              <Text style={styles.hint}>Typ: LCR 160 · Code: {`613/${String(5 + Number(selectedGroup.slice(-2))).padStart(2, '0')}`} · Verwendungsart: {selectedGroup}</Text>
            </>}
          </View>

          <Pressable style={[styles.button, styles.primary, (() => { const hasSelection = rseEnabled || einbauEnabled || ausbauEnabled || szwEnabled || zlgEnabled; return !selectedEditPdf || !hasSelection || (rseEnabled && !werkNr.trim()) || editBusy; })() && styles.disabled]} disabled={(() => { const hasSelection = rseEnabled || einbauEnabled || ausbauEnabled || szwEnabled || zlgEnabled; return !selectedEditPdf || !hasSelection || (rseEnabled && !werkNr.trim()) || editBusy; })()} onPress={fillRsePdf}>
            {editBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>PDF erstellen und speichern</Text>}
          </Pressable>
          <Text style={styles.note}>Nach dem Speichern öffnet sich die Vorschau. Die bearbeitete Kopie bleibt im iPhone-Dateien-Ordner „MyPDF-Ausgabe“ gespeichert.</Text>
        </ScrollView>
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
        <Text style={styles.version}>Update Version 1.2</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f7fb' },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 34, fontWeight: '700', color: '#172033' },
  subtitle: { fontSize: 21, marginTop: 6, color: '#3d4c68' },
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
  note: { marginTop: 28, color: '#71809a', lineHeight: 20, textAlign: 'center' },
  version: { position: 'absolute', right: 12, bottom: 8, color: '#9aa5b8', fontSize: 11 },
  editContainer: { padding: 24, paddingBottom: 40 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 18 },
  backText: { color: '#2457d6', fontSize: 17, fontWeight: '600' },
  card: { marginTop: 26, padding: 20, borderRadius: 16, backgroundColor: '#fff', shadowColor: '#172033', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  sectionTitle: { color: '#172033', fontSize: 19, fontWeight: '700', marginBottom: 18 },
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
  input: { minHeight: 50, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 14, color: '#172033', fontSize: 16, backgroundColor: '#f8fafc' },
  hint: { marginTop: 16, color: '#71809a', fontSize: 13, lineHeight: 19 },
  calendarHint: { marginBottom: 8, color: '#71809a', fontSize: 13, lineHeight: 18 },
  dateValue: { marginLeft: 'auto', color: '#2457d6', fontSize: 16, fontWeight: '600' },
  dateButton: { minHeight: 50, marginTop: 14, borderWidth: 1, borderColor: '#cbd5e5', borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc' },
  dateButtonText: { color: '#172033', fontSize: 16 },
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
