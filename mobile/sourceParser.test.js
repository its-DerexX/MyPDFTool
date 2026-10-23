const assert = require('node:assert/strict');
const {
  hasCompanyKeyword,
  hasLegalForm,
  isCompanyLine,
  parseRecipientLines,
  parseSourceData
} = require('./sourceParser');

function source(parts) {
  return parts.join('\n');
}

function testLegalForms() {
  for (const value of ['Muster GmbH', 'Muster G.m.b.H.', 'Muster AG', 'Muster A.G.', 'Muster e.V.', 'Muster e. V.', 'Muster GmbH & Co. KG', 'Muster Ltd.', 'Muster LLC', 'Muster S.à r.l.']) {
    assert.equal(hasLegalForm(value), true, `Rechtsform nicht erkannt: ${value}`);
  }
  assert.equal(hasLegalForm('Lager'), false, 'AG darf nicht in gewöhnlichen Wörtern erkannt werden');
  assert.equal(hasCompanyKeyword('Schmidt Elektrobau'), true);
  assert.equal(hasCompanyKeyword('Mustermann Immobilienverwaltung'), true);
}

function testRecipientClassification() {
  assert.deepEqual(parseRecipientLines(['Blumenservice']), { hasRecipient: true, firma: 'Blumenservice', vorname: '', name: '' });
  assert.deepEqual(parseRecipientLines(['Müller']), { hasRecipient: true, firma: 'Müller', vorname: '', name: '' });
  assert.deepEqual(parseRecipientLines(['Max Muster']), { hasRecipient: true, firma: '', vorname: 'Max', name: 'Muster' });
  assert.deepEqual(parseRecipientLines(['Anna Maria Schmidt']), { hasRecipient: true, firma: '', vorname: 'Anna Maria', name: 'Schmidt' });
  assert.deepEqual(parseRecipientLines(['Max Muster', 'Schmidt Elektrotechnik']), { hasRecipient: true, firma: 'Schmidt Elektrotechnik', vorname: 'Max', name: 'Muster' });
  assert.deepEqual(parseRecipientLines(['Klum Service Müller']), { hasRecipient: true, firma: 'Klum Service Müller', vorname: '', name: '' });
}

function testBillingPriority() {
  const values = parseSourceData(source([
    'Rechnungsadresse',
    'Rechnung Technik GmbH',
    'Rechnungsstraße 2',
    '12345 Rechnungsstadt',
    'Anschlussnehmer',
    'Max Muster',
    'Anschlussstraße 17',
    '63633 Birstein',
    'Anschlussstandort',
    'Standortweg 8',
    '63633 Kirchbracht',
    'Tiefbau'
  ]));
  assert.equal(values.Name, '');
  assert.equal(values.Vorname, '');
  assert.equal(values['Geburtsdatum bei Privatpersonen bzw RegistergerichtRegisternummer der Firma'], 'Rechnung Technik GmbH');
  assert.equal(values.Straße, 'Rechnungsstraße');
  assert.equal(values.HausNr, '2');
  assert.equal(values.Postleitzahl_2, '12345');
  assert.equal(values.Ort_2, 'Rechnungsstadt');
  assert.equal(values['Straße ggf Anschlussnutzer'], 'Standortweg');
  assert.equal(values['HausNr ggf Anschlussnutzer'], '8');
  assert.equal(values['Ortsteil  FlurstückNr  Etage'], 'Kirchbracht');
}

function testAddressOnlyBillingAndFallback() {
  const values = parseSourceData(source([
    'Rechnungsadresse',
    'Rechnungsstraße 2',
    '12345 Rechnungsstadt',
    'Anschlussnehmer',
    'Max Muster',
    'Anschlussstraße 17',
    '63633 Birstein',
    'Anschlussstandort',
    'Standortweg 8',
    '63633 Kirchbracht',
    'Tiefbau'
  ]));
  assert.equal(values.Vorname, 'Max');
  assert.equal(values.Name, 'Muster');
  assert.equal(values.Straße, 'Rechnungsstraße');
  assert.equal(values.HausNr, '2');

  const withoutBilling = parseSourceData(source([
    'Anschlussnehmer', 'Max Muster', 'Anschlussstraße 17', '63633 Birstein',
    'Anschlussstandort', 'Standortweg 8', '63633 Kirchbracht', 'Tiefbau'
  ]));
  assert.equal(withoutBilling.Straße, 'Anschlussstraße');
  assert.equal(withoutBilling.HausNr, '17');
}

testLegalForms();
testRecipientClassification();
testBillingPriority();
testAddressOnlyBillingAndFallback();
console.log('sourceParser.test.js: alle Tests bestanden');
